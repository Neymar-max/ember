/**
 * Session history: list/load/rename/delete, backed by the SDK's session-store
 * functions plus raw-JSONL enrichment (tool_use_result / isMeta / timestamp
 * by uuid — the SDK's `getSessionMessages()` doesn't carry those). See SPEC §2.6.
 */
import { deleteSession, getSessionInfo, getSessionMessages, listSessions, renameSession } from '@anthropic-ai/claude-agent-sdk'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { HistoryMessage, LoadedHistory, SessionSummary } from '@shared/types'
import { log } from './log'
import { closeSessionsForSessionIdAndWait, forgetSessionId } from './sessions'
import { cleanUserText } from '@shared/userText'

const PROJECTS_DIR = join(homedir(), '.claude/projects')
const MAX_ENRICH_BYTES = 50 * 1024 * 1024
const TITLE_MAX_LEN = 120
const DEFAULT_LIST_LIMIT = 5000
// `listSessions()` reads+parses every session file on the main thread (~1ms/session measured
// locally); a short cache avoids re-paying that on every sidebar mount/focus while still
// picking up new/renamed/deleted sessions within a few seconds (or immediately via `invalidateListCache`).
const LIST_CACHE_TTL_MS = 3000

let projectDirCache: string[] | null = null

function listProjectDirs(forceRefresh = false): string[] {
  if (projectDirCache && !forceRefresh) return projectDirCache
  try {
    projectDirCache = readdirSync(PROJECTS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
  } catch {
    projectDirCache = []
  }
  return projectDirCache
}

function findJsonlPath(sessionId: string): string | null {
  for (const dir of listProjectDirs()) {
    const p = join(PROJECTS_DIR, dir, `${sessionId}.jsonl`)
    if (existsSync(p)) return p
  }
  // project dir list may be stale if this session's project was just created
  for (const dir of listProjectDirs(true)) {
    const p = join(PROJECTS_DIR, dir, `${sessionId}.jsonl`)
    if (existsSync(p)) return p
  }
  return null
}

interface ListCacheEntry {
  limit: number
  expiresAt: number
  value: SessionSummary[]
}

let listCache: ListCacheEntry | null = null
// Bumped on every invalidation so a listSessions() call that started before a rename/delete can't
// write its stale result back into the cache.
let listCacheGen = 0

/** Drops the cached `history:list` result — call whenever sessions may have changed (result completed, renamed, deleted). */
export function invalidateListCache(): void {
  listCacheGen++
  listCache = null
}

/**
 * The raw JSONL line, keyed by uuid. `getSessionMessages()` only returns
 * {type, uuid, session_id, message, parent_tool_use_id, parent_agent_id} — for a
 * `system` row that strips everything CLI-subtype-specific (`subtype`,
 * `compact_metadata`, ...), not just `toolUseResult`/`isMeta`. We keep the whole
 * parsed line so `loadHistory` can overlay it wholesale.
 */
const ENRICH_YIELD_EVERY = 2000

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

/** Async + chunked so parsing a large (up to 50MB) JSONL file doesn't block other chats' IPC. */
async function buildEnrichment(path: string): Promise<Map<string, Record<string, unknown>>> {
  const map = new Map<string, Record<string, unknown>>()
  try {
    if (statSync(path).size > MAX_ENRICH_BYTES) return map
    const content = await readFile(path, 'utf-8')
    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (line.trim()) {
        try {
          const obj = JSON.parse(line) as Record<string, unknown>
          if (typeof obj.uuid === 'string') map.set(obj.uuid, obj)
        } catch {
          // skip malformed line
        }
      }
      if ((i + 1) % ENRICH_YIELD_EVERY === 0) await yieldToEventLoop()
    }
  } catch (e) {
    log.warn(`history enrichment read failed for ${path}: ${String(e)}`)
  }
  return map
}

function truncateTitle(raw: string): string {
  // firstPrompt is the raw first message — drop reminders, vault/IDE context, pasted wrappers…
  const cmd = /<command-name>\/?([^<]*)<\/command-name>/.exec(raw)
  const typed = cmd ? `/${cmd[1].trim()}` : (cleanUserText(raw).text ?? '')
  const cleaned = typed.replace(/\r?\n/g, ' ').trim()
  return cleaned.length > TITLE_MAX_LEN ? cleaned.slice(0, TITLE_MAX_LEN) : cleaned
}

export async function listHistory(opts?: { limit?: number }): Promise<SessionSummary[]> {
  const limit = opts?.limit ?? DEFAULT_LIST_LIMIT
  if (listCache && listCache.limit === limit && listCache.expiresAt > Date.now()) return listCache.value
  const gen = listCacheGen

  const infos = await listSessions({ limit })
  const value = infos
    // Metadata-only stubs (no transcript, hence no cwd) are leftovers of deleted sessions — hide them.
    .filter((s) => !!s.cwd)
    .map((s) => ({
      sessionId: s.sessionId,
      title: truncateTitle(s.customTitle || s.summary || s.firstPrompt || ''), // renderer localizes an empty title
      firstPrompt: s.firstPrompt,
      cwd: s.cwd,
      gitBranch: s.gitBranch,
      createdAt: s.createdAt,
      lastModified: s.lastModified,
      fileSize: s.fileSize,
    }))
    .sort((a, b) => b.lastModified - a.lastModified)

  if (gen === listCacheGen) listCache = { limit, expiresAt: Date.now() + LIST_CACHE_TTL_MS, value }
  return value
}

export async function loadHistory(sessionId: string): Promise<LoadedHistory> {
  const [raw, info] = await Promise.all([getSessionMessages(sessionId, { includeSystemMessages: true }), getSessionInfo(sessionId)])
  const jsonlPath = findJsonlPath(sessionId)
  const enrichment = jsonlPath ? await buildEnrichment(jsonlPath) : new Map<string, Record<string, unknown>>()

  const messages: HistoryMessage[] = raw.map((m) => {
    const rawLine = enrichment.get(m.uuid)
    // Overlay the raw JSONL line first (subtype, compact_metadata, and anything else
    // the CLI wrote to disk), then re-assert the SDK's own fields as authoritative,
    // and finally normalize toolUseResult (camelCase on disk) → tool_use_result.
    return {
      ...(rawLine ?? {}),
      type: m.type,
      uuid: m.uuid,
      session_id: m.session_id,
      message: m.message,
      parent_tool_use_id: m.parent_tool_use_id,
      timestamp: typeof rawLine?.timestamp === 'string' ? rawLine.timestamp : undefined,
      tool_use_result: rawLine?.toolUseResult,
      isMeta: typeof rawLine?.isMeta === 'boolean' ? rawLine.isMeta : undefined,
    }
  })

  return {
    sessionId,
    cwd: info?.cwd,
    title: truncateTitle(info?.customTitle || info?.summary || info?.firstPrompt || '未命名'),
    messages,
  }
}

export async function renameHistory(sessionId: string, title: string): Promise<void> {
  await renameSession(sessionId, title)
  invalidateListCache()
}

export async function deleteHistory(sessionId: string): Promise<void> {
  // The CLI writes title/cost metadata when it exits; if the transcript were deleted first, that
  // write would recreate a stub file and the chat would come back as a ghost. Wait for exit first,
  // then sweep once more shortly after in case a straggling write still lands.
  await closeSessionsForSessionIdAndWait(sessionId)
  await deleteSession(sessionId)
  setTimeout(() => {
    void deleteSession(sessionId)
      .catch(() => {})
      .finally(() => invalidateListCache())
  }, 4000)
  // A brand-new chat's chatId differs from its CLI sessionId until the first history reload,
  // but once a session is deleted, nothing should ever try to `resume:` it again.
  forgetSessionId(sessionId)
  invalidateListCache()
}
