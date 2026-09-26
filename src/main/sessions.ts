/**
 * SessionManager: one live CLI child process ("LiveSession") per chatId, streaming
 * input, canUseTool bridging, status pushes, and cleanup. See SPEC §2.5.
 */
import { appendFileSync } from 'node:fs'
import { query, type CanUseTool, type Options, type PermissionResult, type PermissionUpdate, type Query, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { randomUUID, type UUID } from 'node:crypto'
import type { Result } from '@shared/ipc'
import type {
  ContextUsage,
  EffortChoice,
  ImageAttachment,
  PermissionMode,
  PermissionRequest,
  PermissionResponse,
  RateLimitSnapshot,
  RawSdkMessage,
  SendPayload,
  SessionEvent,
  SessionMeta,
  StartOptions,
} from '@shared/types'
import { getCachedCliInfo } from './probe'
import { getChildEnv } from './env'
import { log } from './log'
import { killAllTrackedSync, killIfAlive, makeSpawner, waitForExit } from './spawnProcess'

const MAX_LIVE_SESSIONS = 8
const STDERR_RING_SIZE = 200

/** Minimal async-iterable queue fed by `send()`, consumed by the SDK's `query()`. Not an SDK API — our own plumbing (see docs/research/sdk-integration.md §1.2). */
class AsyncMessageQueue implements AsyncIterable<SDKUserMessage> {
  private queue: SDKUserMessage[] = []
  private resolvers: Array<(v: IteratorResult<SDKUserMessage>) => void> = []
  private closed = false

  push(msg: SDKUserMessage): void {
    if (this.closed) return
    const resolve = this.resolvers.shift()
    if (resolve) resolve({ value: msg, done: false })
    else this.queue.push(msg)
  }

  end(): void {
    this.closed = true
    for (const resolve of this.resolvers.splice(0)) {
      resolve({ value: undefined, done: true })
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: (): Promise<IteratorResult<SDKUserMessage>> => {
        if (this.queue.length > 0) return Promise.resolve({ value: this.queue.shift() as SDKUserMessage, done: false })
        if (this.closed) return Promise.resolve({ value: undefined, done: true })
        return new Promise((resolve) => this.resolvers.push(resolve))
      },
    }
  }
}

interface LiveSession {
  chatId: string
  /** Unique per spawn — distinguishes this session from a later one reusing the same chatId (see spawnProcess.ts). */
  generation: string
  q: Query
  input: AsyncMessageQueue
  abortController: AbortController
  cwd: string
  status: 'starting' | 'idle' | 'running' | 'closed' | 'error'
  sessionId?: string
  lastPermissionMode?: PermissionMode
  lastModel?: string
  lastUsed: number
  stderrRing: string[]
}

interface PendingEntry {
  chatId: string
  request: PermissionRequest
  resolve: (r: PermissionResult) => void
}

export interface SessionManagerCallbacks {
  onEvent(e: SessionEvent): void
  onRateLimits(r: RateLimitSnapshot): void
  onHistoryChanged(): void
  notify(title: string, body: string, chatId?: string): void
  setBadge(count: number): void
}

const sessions = new Map<string, LiveSession>()
const lastSessionIdByChat = new Map<string, string>()
const pendingAll = new Map<string, PendingEntry>()
let latestRateLimits: RateLimitSnapshot | null = null
let historyChangedTimer: NodeJS.Timeout | null = null

let cb: SessionManagerCallbacks = {
  onEvent: () => {},
  onRateLimits: () => {},
  onHistoryChanged: () => {},
  notify: () => {},
  setBadge: () => {},
}

export function configureSessionManager(callbacks: SessionManagerCallbacks): void {
  cb = callbacks
}

function pushStatus(session: LiveSession, status: LiveSession['status'], error?: string): void {
  session.status = status
  cb.onEvent({ chatId: session.chatId, kind: 'status', status, error })
}

function scheduleHistoryChanged(): void {
  if (historyChangedTimer) return
  historyChangedTimer = setTimeout(() => {
    historyChangedTimer = null
    cb.onHistoryChanged()
  }, 1000)
}

function updateBadge(): void {
  cb.setBadge(pendingAll.size)
}

// ─────────────────────────── rate limits ───────────────────────────

type UnifiedWindows = { five_hour?: { utilization?: number; resetsAt?: number }; seven_day?: { utilization?: number; resetsAt?: number } }

function normalizeUtilization(u: number | undefined): number | undefined {
  if (u === undefined) return undefined
  return u > 1 ? u / 100 : u
}

function handleRateLimitEvent(info: { status?: string; rateLimitType?: string; utilization?: number; resetsAt?: number; unifiedWindows?: UnifiedWindows }): void {
  const uw = info.unifiedWindows
  const next: RateLimitSnapshot = {
    status: info.status as RateLimitSnapshot['status'],
    updatedAt: Date.now(),
    fiveHour: latestRateLimits?.fiveHour,
    sevenDay: latestRateLimits?.sevenDay,
    weeklyByModel: latestRateLimits?.weeklyByModel,
    planLabel: latestRateLimits?.planLabel,
  }
  if (uw?.five_hour) next.fiveHour = { utilization: uw.five_hour.utilization, resetsAt: uw.five_hour.resetsAt }
  else if (info.rateLimitType === 'five_hour') next.fiveHour = { utilization: normalizeUtilization(info.utilization), resetsAt: info.resetsAt }
  if (uw?.seven_day) next.sevenDay = { utilization: uw.seven_day.utilization, resetsAt: uw.seven_day.resetsAt }
  else if (info.rateLimitType === 'seven_day') next.sevenDay = { utilization: normalizeUtilization(info.utilization), resetsAt: info.resetsAt }
  latestRateLimits = next
  cb.onRateLimits(next)
}

/** Seed plan usage fetched at startup (probe); live rate_limit_event data always wins once it arrives. */
export function seedRateLimits(snapshot: RateLimitSnapshot): void {
  if (latestRateLimits && latestRateLimits.updatedAt > snapshot.updatedAt) return
  latestRateLimits = { ...snapshot, status: latestRateLimits?.status ?? snapshot.status, planLabel: snapshot.planLabel ?? latestRateLimits?.planLabel }
  cb.onRateLimits(latestRateLimits)
}

/** Any live CLI query (prefer an idle one) — lets usage refreshes reuse a running process. */
export function getAnyLiveQuery(): Query | undefined {
  let fallback: Query | undefined
  for (const s of sessions.values()) {
    if (s.status === 'idle') return s.q
    fallback ??= s.q
  }
  return fallback
}

export function getLatestRateLimits(): RateLimitSnapshot | null {
  return latestRateLimits
}

// ─────────────────────────── canUseTool ───────────────────────────

function makeCanUseTool(chatId: string): CanUseTool {
  return (toolName, input, opts) =>
    new Promise<PermissionResult>((resolve) => {
      const requestId = randomUUID()
      const request: PermissionRequest = {
        requestId,
        chatId,
        toolName,
        input,
        toolUseId: opts.toolUseID,
        title: opts.title,
        displayName: opts.displayName,
        description: opts.description,
        decisionReason: opts.decisionReason,
        blockedPath: opts.blockedPath,
        defaultToNo: opts.defaultToNo,
        suppressAlwaysAllow: opts.suppressAlwaysAllowRule,
        suggestions: opts.suggestions,
        agentId: opts.agentID,
        createdAt: Date.now(),
      }
      pendingAll.set(requestId, { chatId, request, resolve })
      updateBadge()
      record(chatId, { permission: request })
      cb.onEvent({ chatId, kind: 'permission', request })
      cb.notify('Claude 需要你的确认', request.title || request.displayName || toolName, chatId)

      opts.signal.addEventListener(
        'abort',
        () => {
          if (!pendingAll.has(requestId)) return
          pendingAll.delete(requestId)
          updateBadge()
          cb.onEvent({ chatId, kind: 'permission-cancelled', requestId })
          resolve({ behavior: 'deny', message: 'Cancelled.' })
        },
        { once: true },
      )
    })
}

export function respondPermission(resp: PermissionResponse): void {
  const entry = pendingAll.get(resp.requestId)
  if (!entry) return
  record(entry.chatId, { response: resp })
  pendingAll.delete(resp.requestId)
  updateBadge()

  if (resp.decision === 'allow') {
    let updatedPermissions: PermissionUpdate[] | undefined = resp.applySuggestions
      ? (entry.request.suggestions as PermissionUpdate[] | undefined)
      : undefined
    if (resp.switchToMode) {
      const setMode: PermissionUpdate = { type: 'setMode', mode: resp.switchToMode, destination: 'session' }
      updatedPermissions = updatedPermissions ? [...updatedPermissions, setMode] : [setMode]
    }
    entry.resolve({ behavior: 'allow', updatedInput: resp.updatedInput ?? entry.request.input, updatedPermissions })
  } else {
    entry.resolve({ behavior: 'deny', message: resp.message || 'The user denied this action.', interrupt: resp.interrupt })
  }
}

export function listPending(): PermissionRequest[] {
  return Array.from(pendingAll.values()).map((e) => e.request)
}

// ─────────────────────────── message handling ───────────────────────────

const STDERR_LOG_LINE_MAX = 300
const CREDENTIAL_PATTERNS: RegExp[] = [
  /sk-ant-[\w-]+/gi,
  /Bearer\s+\S+/gi,
  /Authorization\s*:\s*\S+/gi,
  /(api[_-]?key|token|secret|password)["'=:\s]+\S+/gi,
]

/** Redacts credential-looking substrings before stderr is written to the on-disk log (SPEC: never log secrets). */
function redactCredentials(text: string): string {
  let out = text
  for (const re of CREDENTIAL_PATTERNS) out = out.replace(re, '[redacted]')
  return out
}

function appendStderr(session: LiveSession, data: string): void {
  session.stderrRing.push(data)
  if (session.stderrRing.length > STDERR_RING_SIZE) session.stderrRing.shift()
  log.error(`[${session.chatId}] stderr: ${redactCredentials(data).slice(0, STDERR_LOG_LINE_MAX)}`)
  cb.onEvent({ chatId: session.chatId, kind: 'stderr', text: data })
}

// Test/debug aid: EMBER_RECORD=/path/file.jsonl records every raw SDK message (never enabled in normal use).
const RECORD_FILE = process.env.EMBER_RECORD
function record(chatId: string, entry: unknown): void {
  if (!RECORD_FILE) return
  try {
    appendFileSync(RECORD_FILE, JSON.stringify({ t: Date.now(), chatId, ...(entry as object) }) + '\n')
  } catch {
    // best effort
  }
}

function handleMessage(session: LiveSession, m: SDKMessage): void {
  record(session.chatId, { sdk: m })
  cb.onEvent({ chatId: session.chatId, kind: 'sdk', message: m as unknown as RawSdkMessage })

  if (m.type === 'system' && m.subtype === 'init') {
    const first = !session.sessionId
    session.sessionId = m.session_id
    session.lastPermissionMode = m.permissionMode
    session.lastModel = m.model
    lastSessionIdByChat.set(session.chatId, m.session_id)
    if (first) cb.onEvent({ chatId: session.chatId, kind: 'session-id', sessionId: m.session_id })
    // Don't flicker running→idle→running: a fresh/resumed spawn's first message is this
    // init event, which can arrive after the caller already pushed 'running' for send().
    if (session.status !== 'running') pushStatus(session, 'idle')
    return
  }
  if (m.type === 'rate_limit_event') {
    handleRateLimitEvent(m.rate_limit_info)
    return
  }
  if (m.type === 'result') {
    pushStatus(session, 'idle')
    scheduleHistoryChanged()
    return
  }
  if ((m.type === 'stream_event' || m.type === 'assistant') && session.status === 'idle') {
    pushStatus(session, 'running')
  }
}

async function consumeLoop(session: LiveSession): Promise<void> {
  // `sessions.get(chatId) === session` guards every path below: LRU eviction can close this
  // session and a new one can be created for the same chatId while this loop's `for await`
  // is still unwinding (a stale iterator resolving late), and this loop must never touch the
  // NEW session's map entry, pending permissions, or status.
  try {
    for await (const m of session.q) {
      handleMessage(session, m)
    }
    if (sessions.get(session.chatId) === session) {
      sessions.delete(session.chatId)
      pushStatus(session, 'closed')
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    const tail = session.stderrRing.slice(-20).join('\n')
    if (sessions.get(session.chatId) === session) {
      sessions.delete(session.chatId)
      pushStatus(session, 'error', tail ? `${message}\n${tail}` : message)
      for (const [id, entry] of pendingAll) {
        if (entry.chatId === session.chatId) {
          pendingAll.delete(id)
          entry.resolve({ behavior: 'deny', message: 'Session ended unexpectedly.' })
          cb.onEvent({ chatId: session.chatId, kind: 'permission-cancelled', requestId: id })
        }
      }
      updateBadge()
    }
  }
}

// ─────────────────────────── lifecycle ───────────────────────────

function evictOldestIdleIfFull(): void {
  if (sessions.size < MAX_LIVE_SESSIONS) return
  let oldest: LiveSession | undefined
  for (const s of sessions.values()) {
    if (s.status !== 'idle') continue
    if (!oldest || s.lastUsed < oldest.lastUsed) oldest = s
  }
  if (oldest) void closeSession(oldest.chatId)
}

// Built loosely and cast at the call site — typing this against the SDK's precise
// discriminated `ContentBlockParam` union runs into contextual-typing dead ends for a
// mixed image+text array (see report for details).
function buildContent(text: string, images?: ImageAttachment[]): unknown {
  if (!images || images.length === 0) return text
  return [
    ...images.map((img) => ({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } })),
    { type: 'text', text },
  ]
}

async function createSession(opts: StartOptions): Promise<LiveSession> {
  const cli = getCachedCliInfo()
  if (!cli.found || !cli.path) throw new Error('Claude Code CLI not found. Run env recheck first.')

  evictOldestIdleIfFull()

  const childEnv = await getChildEnv()
  const abortController = new AbortController()
  const input = new AsyncMessageQueue()
  const resumeId = opts.resumeSessionId ?? lastSessionIdByChat.get(opts.chatId)
  const generation = randomUUID()
  const spawner = makeSpawner(generation)

  const options: Options = {
    pathToClaudeCodeExecutable: cli.path,
    cwd: opts.cwd,
    env: childEnv,
    systemPrompt: { type: 'preset', preset: 'claude_code' },
    settingSources: ['user', 'project', 'local'],
    includePartialMessages: true,
    forwardSubagentText: true,
    agentProgressSummaries: true,
    toolConfig: { askUserQuestion: { previewFormat: 'html' } },
    // Display-only: return readable thinking summaries (what `claude` shows in transcript mode) instead of empty blocks.
    ...(cli.supportsThinkingDisplay ? { extraArgs: { 'thinking-display': 'summarized' } } : {}),
    canUseTool: makeCanUseTool(opts.chatId),
    stderr: (data: string) => appendStderr(session, data),
    abortController,
    spawnClaudeCodeProcess: spawner,
    ...(resumeId ? { resume: resumeId } : {}),
    ...(opts.model ? { model: opts.model } : {}),
    ...(opts.permissionMode
      ? { permissionMode: opts.permissionMode, ...(opts.permissionMode === 'bypassPermissions' ? { allowDangerouslySkipPermissions: true } : {}) }
      : {}),
    // Ultracode = xhigh effort plus standing workflow orchestration, enabled through the flag settings layer.
    ...(opts.effort === 'ultracode' ? { effort: 'xhigh' as const, settings: { ultracode: true } } : opts.effort ? { effort: opts.effort } : {}),
  }

  const q = query({ prompt: input, options })
  const session: LiveSession = {
    chatId: opts.chatId,
    generation,
    q,
    input,
    abortController,
    cwd: opts.cwd,
    status: 'starting',
    lastUsed: Date.now(),
    stderrRing: [],
  }
  sessions.set(opts.chatId, session)
  cb.onEvent({ chatId: session.chatId, kind: 'status', status: 'starting' })
  void consumeLoop(session)
  return session
}

export async function startSession(opts: StartOptions): Promise<Result> {
  try {
    if (!sessions.has(opts.chatId)) await createSession(opts)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function sendMessage(payload: SendPayload): Promise<Result> {
  try {
    let session = sessions.get(payload.chatId)
    if (!session) session = await createSession(payload)
    session.lastUsed = Date.now()
    session.input.push({
      type: 'user',
      message: { role: 'user', content: buildContent(payload.text, payload.images) as SDKUserMessage['message']['content'] },
      parent_tool_use_id: null,
      uuid: payload.uuid as UUID,
      session_id: '',
    })
    pushStatus(session, 'running')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function interruptSession(chatId: string): Promise<void> {
  const session = sessions.get(chatId)
  if (!session) return
  try {
    await session.q.interrupt()
  } catch {
    // session may already be gone
  }
}

export async function setModel(chatId: string, model?: string): Promise<void> {
  const session = sessions.get(chatId)
  if (!session) return
  try {
    await session.q.setModel(model)
  } catch {
    // ignore
  }
}

export async function setPermissionMode(chatId: string, mode: PermissionMode): Promise<void> {
  const session = sessions.get(chatId)
  if (!session) return
  try {
    await session.q.setPermissionMode(mode)
  } catch {
    // ignore
  }
}

export async function setEffort(chatId: string, effort: EffortChoice | null): Promise<void> {
  const session = sessions.get(chatId)
  if (!session) return
  try {
    if (effort === 'ultracode') await session.q.applyFlagSettings({ ultracode: true, effortLevel: 'xhigh' })
    // null clears the flag layer: ultracode off (effort kept), then the chosen level or the model default.
    else await session.q.applyFlagSettings({ ultracode: null, effortLevel: effort })
  } catch {
    // ignore
  }
}

/** Closes a chat's live process without making the caller wait for it to exit (UI actions). */
export async function closeSession(chatId: string): Promise<void> {
  void closeSessionAndWait(chatId)
}

/** Closes every live process attached to a CLI session (by chatId or sessionId) and waits for them to exit. */
export async function closeSessionsForSessionIdAndWait(sessionId: string): Promise<void> {
  const chatIds = Array.from(sessions.values())
    .filter((s) => s.chatId === sessionId || s.sessionId === sessionId)
    .map((s) => s.chatId)
  await Promise.all(chatIds.map((id) => closeSessionAndWait(id)))
}

/** Closes a chat's live process and resolves once it exited (or was SIGKILLed after ~2s) — used on quit. */
async function closeSessionAndWait(chatId: string): Promise<void> {
  const session = sessions.get(chatId)
  if (!session) return
  const { generation } = session
  for (const [id, entry] of pendingAll) {
    if (entry.chatId === chatId) {
      pendingAll.delete(id)
      entry.resolve({ behavior: 'deny', message: 'Session closed.' })
      cb.onEvent({ chatId, kind: 'permission-cancelled', requestId: id })
    }
  }
  updateBadge()
  session.input.end()
  try {
    session.q.close()
  } catch {
    // ignore
  }
  sessions.delete(chatId)
  pushStatus(session, 'closed')
  // Give the child a moment to exit on its own (polled by pid, not by a fixed timer), then
  // SIGKILL this exact generation's process if it's still alive.
  await waitForExit(generation, 2000)
  killIfAlive(generation)
}

/** Closes every live session, racing against `timeoutMs` (used by before-quit). */
export async function closeAllSessions(timeoutMs: number): Promise<void> {
  const chatIds = Array.from(sessions.keys())
  const closeAll = Promise.all(chatIds.map((id) => closeSessionAndWait(id)))
  await Promise.race([closeAll, new Promise((resolve) => setTimeout(resolve, timeoutMs))])
}

/** Synchronous last resort after `closeAllSessions`' race — SIGKILLs any process still tracked. */
export function killAllOrphanProcesses(): void {
  killAllTrackedSync()
}

export async function getSessionMeta(chatId: string): Promise<SessionMeta | null> {
  const session = sessions.get(chatId)
  if (!session) return null
  try {
    const init = await session.q.initializationResult()
    return {
      models: init.models.map((m) => ({
        value: m.value,
        displayName: m.displayName,
        description: m.description,
        supportsEffort: m.supportsEffort,
        supportedEffortLevels: m.supportedEffortLevels,
      })),
      commands: init.commands.map((c) => ({ name: c.name, description: c.description, argumentHint: c.argumentHint, aliases: c.aliases, builtin: c.builtin })),
      account: init.account
        ? {
            email: init.account.email,
            organization: init.account.organization,
            subscriptionType: init.account.subscriptionType,
            apiProvider: init.account.apiProvider,
            tokenSource: init.account.tokenSource,
            apiKeySource: init.account.apiKeySource,
          }
        : undefined,
      permissionMode: session.lastPermissionMode,
      model: session.lastModel,
    }
  } catch {
    return null
  }
}

export async function getContextUsage(chatId: string): Promise<ContextUsage | null> {
  const session = sessions.get(chatId)
  if (!session) return null
  try {
    const raw = await session.q.getContextUsage({ detail: 'summary' })
    return { totalTokens: raw.totalTokens, maxTokens: raw.maxTokens, percentage: raw.percentage, raw }
  } catch {
    return null
  }
}

export function liveList(): Array<{ chatId: string; sessionId?: string; status: string; cwd: string }> {
  return Array.from(sessions.values()).map((s) => ({ chatId: s.chatId, sessionId: s.sessionId, status: s.status, cwd: s.cwd }))
}

/** Drops any chatId→sessionId auto-resume mapping pointing at a now-deleted session (called from history.deleteHistory). */
export function forgetSessionId(sessionId: string): void {
  for (const [chatId, sid] of lastSessionIdByChat) {
    if (sid === sessionId) lastSessionIdByChat.delete(chatId)
  }
}
