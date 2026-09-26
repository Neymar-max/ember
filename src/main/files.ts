/**
 * `@`-mention file suggestions: git-tracked files when cwd is a repo, otherwise
 * a bounded directory walk. Fuzzy-ranked (subsequence match, filename-first). See SPEC §2.7.
 */
import { execFile } from 'node:child_process'
import { open, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import type { FilePreview, FileSuggestion, RecentFile } from '@shared/types'
import { getChildEnv } from './env'
import { log } from './log'

const CACHE_TTL_MS = 30000
const CACHE_MAX_ENTRIES = 30
const GIT_TIMEOUT_MS = 3000
const WALK_MAX_DEPTH = 6
const WALK_MAX_ENTRIES = 20000
const RESULT_LIMIT = 50
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.venv', '__pycache__', '.next', 'out', '.cache'])

interface CacheEntry {
  entries: FileSuggestion[]
  expiresAt: number
}

// LRU of at most CACHE_MAX_ENTRIES cwds (Map iteration order = insertion order; a get/set
// re-inserts to mark an entry as most-recently-used, and the oldest is evicted over the cap).
const cache = new Map<string, CacheEntry>()

function cacheGet(cwd: string): CacheEntry | undefined {
  const entry = cache.get(cwd)
  if (!entry) return undefined
  cache.delete(cwd)
  cache.set(cwd, entry)
  return entry
}

function cacheSet(cwd: string, entry: CacheEntry): void {
  cache.delete(cwd)
  cache.set(cwd, entry)
  if (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

function gitListFiles(cwd: string, env: Record<string, string>): Promise<string[] | null> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard'],
      { cwd, env, timeout: GIT_TIMEOUT_MS, maxBuffer: 20 * 1024 * 1024 },
      (error, stdout) => {
        if (error) return resolve(null)
        resolve(stdout.split('\n').filter(Boolean))
      },
    )
  })
}

async function collectViaGit(cwd: string, env: Record<string, string>): Promise<FileSuggestion[] | null> {
  const files = await gitListFiles(cwd, env)
  if (files === null) return null
  const dirs = new Set<string>()
  for (const f of files) {
    let d = dirname(f)
    while (d && d !== '.') {
      dirs.add(d)
      d = dirname(d)
    }
  }
  const entries: FileSuggestion[] = files.map((p) => ({ path: p, isDir: false }))
  for (const d of dirs) entries.push({ path: d, isDir: true })
  return entries
}

/** BFS directory walk, yielding to the event loop between directories so it never blocks other chats' IPC. */
async function collectViaWalk(cwd: string): Promise<FileSuggestion[]> {
  const results: FileSuggestion[] = []
  const queue: Array<{ dir: string; rel: string; depth: number }> = [{ dir: cwd, rel: '', depth: 0 }]
  while (queue.length > 0 && results.length < WALK_MAX_ENTRIES) {
    const next = queue.shift()
    if (!next) break
    const { dir, rel, depth } = next
    if (depth > WALK_MAX_DEPTH) continue
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (results.length >= WALK_MAX_ENTRIES) break
      if (SKIP_DIRS.has(e.name)) continue
      const relPath = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) {
        results.push({ path: relPath, isDir: true })
        queue.push({ dir: join(dir, e.name), rel: relPath, depth: depth + 1 })
      } else if (e.isFile()) {
        results.push({ path: relPath, isDir: false })
      }
    }
    await yieldToEventLoop()
  }
  return results
}

async function collect(cwd: string): Promise<FileSuggestion[]> {
  const cached = cacheGet(cwd)
  if (cached && cached.expiresAt > Date.now()) return cached.entries
  const env = await getChildEnv()
  const viaGit = await collectViaGit(cwd, env)
  const entries = viaGit ?? (await collectViaWalk(cwd))
  cacheSet(cwd, { entries, expiresAt: Date.now() + CACHE_TTL_MS })
  return entries
}

/** Subsequence match with a filename-priority bonus. Lower score = better match. Null = no match. */
function fuzzyScore(candidate: string, query: string): number | null {
  const hay = candidate.toLowerCase()
  const needle = query.toLowerCase()
  let cursor = 0
  let score = 0
  for (const ch of needle) {
    const idx = hay.indexOf(ch, cursor)
    if (idx === -1) return null
    score += idx - cursor
    cursor = idx + 1
  }
  const base = (candidate.split('/').pop() || candidate).toLowerCase()
  if (base.startsWith(needle)) score -= 500
  else if (base.includes(needle)) score -= 250
  return score
}

function rank(entries: FileSuggestion[], query: string): FileSuggestion[] {
  if (!query) return entries.slice(0, RESULT_LIMIT)
  const scored: Array<{ entry: FileSuggestion; score: number }> = []
  for (const entry of entries) {
    const score = fuzzyScore(entry.path, query)
    if (score !== null) scored.push({ entry, score })
  }
  scored.sort((a, b) => a.score - b.score)
  return scored.slice(0, RESULT_LIMIT).map((s) => s.entry)
}

export async function suggestFiles(cwd: string, query: string): Promise<FileSuggestion[]> {
  try {
    const entries = await collect(cwd)
    return rank(entries, query)
  } catch (e) {
    log.warn(`files:suggest failed for ${cwd}: ${String(e)}`)
    return []
  }
}

const PREVIEW_MAX_BYTES = 512 * 1024

/** Read a file for the side-panel preview (first 512 KB; binaries detected by NUL bytes). */
export async function readPreview(p: string, cwd?: string): Promise<FilePreview> {
  const expanded = p.startsWith('~/') ? join(homedir(), p.slice(2)) : p.replace(/^file:\/\//, '')
  const path = isAbsolute(expanded) ? expanded : resolve(cwd || homedir(), expanded)
  try {
    const st = await stat(path)
    if (st.isDirectory()) return { path, exists: true, isDirectory: true, mtimeMs: st.mtimeMs }
    const fh = await open(path, 'r')
    try {
      const len = Math.min(st.size, PREVIEW_MAX_BYTES)
      const buf = Buffer.alloc(len)
      await fh.read(buf, 0, len, 0)
      const binary = buf.subarray(0, Math.min(len, 8000)).includes(0)
      return {
        path,
        exists: true,
        size: st.size,
        mtimeMs: st.mtimeMs,
        binary,
        content: binary ? undefined : buf.toString('utf8'),
        truncated: st.size > PREVIEW_MAX_BYTES,
      }
    } finally {
      await fh.close()
    }
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    return { path, exists: code !== 'ENOENT' && code !== 'ENOTDIR', error: code ?? String(e) }
  }
}

const RECENT_LIMIT = 200

/** Files under cwd modified at/after sinceMs (bounded walk, heavy dirs skipped), newest first. */
export async function recentFiles(cwd: string, sinceMs: number): Promise<RecentFile[]> {
  const out: RecentFile[] = []
  let visited = 0
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > WALK_MAX_DEPTH || visited > WALK_MAX_ENTRIES) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const ent of entries) {
      if (++visited > WALK_MAX_ENTRIES) return
      if (ent.name === '.DS_Store') continue
      const full = join(dir, ent.name)
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name) || ent.name.startsWith('.')) continue
        await walk(full, depth + 1)
      } else if (ent.isFile()) {
        try {
          const st = await stat(full)
          if (st.mtimeMs >= sinceMs) out.push({ rel: relative(cwd, full), path: full, size: st.size, mtimeMs: st.mtimeMs })
        } catch {
          // vanished mid-walk
        }
      }
    }
    if (visited % 500 === 0) await yieldToEventLoop()
  }
  // Never walk the whole home directory or filesystem root — too big to be useful.
  if (!cwd || cwd === '/' || cwd === homedir()) return []
  await walk(cwd, 0)
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, RECENT_LIMIT)
}
