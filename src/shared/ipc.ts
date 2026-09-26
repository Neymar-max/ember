/**
 * IPC contract. Channel names + the `window.ember` API surface exposed by preload.
 * main registers `ipcMain.handle(IPC.xxx, ...)` for every invoke channel;
 * preload wraps them 1:1 (see src/preload/index.ts).
 */
import type {
  AppInfo,
  AppSettings,
  ContextUsage,
  EffortChoice,
  EnvStatus,
  FileSuggestion,
  ImageAttachment,
  LoadedHistory,
  MenuCommand,
  PermissionMode,
  PermissionRequest,
  PermissionResponse,
  RateLimitSnapshot,
  SendPayload,
  SessionEvent,
  SessionMeta,
  SessionSummary,
  StartOptions,
} from './types'

export const IPC = {
  // env
  envGet: 'env:get', // () => EnvStatus (cached; triggers probe if never run)
  envRecheck: 'env:recheck', // () => EnvStatus (forces re-detect + re-probe)
  envChanged: 'env:changed', // main → renderer push: EnvStatus
  rateLimits: 'env:rate-limits', // main → renderer push: RateLimitSnapshot
  rateLimitsGet: 'env:rate-limits-get', // () => RateLimitSnapshot | null
  usageRefresh: 'env:usage-refresh', // () => RateLimitSnapshot | null  (fetches plan usage now; throttled)

  // settings
  settingsGet: 'settings:get', // () => AppSettings
  settingsSet: 'settings:set', // (patch: Partial<AppSettings>) => AppSettings
  settingsChanged: 'settings:changed', // main → renderer push: AppSettings

  // history
  historyList: 'history:list', // (opts?: {limit?: number}) => SessionSummary[]
  historyLoad: 'history:load', // (sessionId: string) => LoadedHistory
  historyRename: 'history:rename', // (sessionId, title) => void
  historyDelete: 'history:delete', // (sessionId) => void
  historyChanged: 'history:changed', // main → renderer push: void (list should be refetched)

  // live sessions
  sessionStart: 'session:start', // (opts: StartOptions) => {ok: true} | {ok: false, error}
  sessionSend: 'session:send', // (payload: SendPayload) => {ok: true} | {ok: false, error}
  sessionInterrupt: 'session:interrupt', // (chatId) => void
  sessionSetModel: 'session:set-model', // (chatId, model?: string) => void
  sessionSetPermissionMode: 'session:set-permission-mode', // (chatId, mode) => void
  sessionSetEffort: 'session:set-effort', // (chatId, effort: EffortChoice | null) => void
  sessionClose: 'session:close', // (chatId) => void
  sessionRespond: 'session:respond', // (resp: PermissionResponse) => void
  sessionPending: 'session:pending', // () => PermissionRequest[]  (all chats, for window reloads)
  sessionMeta: 'session:meta', // (chatId) => SessionMeta | null
  sessionContextUsage: 'session:context-usage', // (chatId) => ContextUsage | null
  sessionLiveList: 'session:live-list', // () => Array<{chatId, sessionId?, status}>
  sessionEvent: 'session:event', // main → renderer push: SessionEvent

  // files & system
  filesSuggest: 'files:suggest', // (cwd, query) => FileSuggestion[]
  pickDirectory: 'sys:pick-directory', // (defaultPath?) => string | null
  pickImages: 'sys:pick-images', // () => ImageAttachment[]
  pickExecutable: 'sys:pick-executable', // () => string | null
  openExternal: 'sys:open-external', // (url) => void   (http/https/mailto only)
  showInFinder: 'sys:show-in-finder', // (path) => void
  openInTerminal: 'sys:open-in-terminal', // (cwd, command?) => void
  openPath: 'sys:open-path', // (path) => void  (open file/folder with default app)
  notify: 'sys:notify', // (title, body, chatId?) => void  (only shows if window not focused)
  setBadge: 'sys:set-badge', // (count: number) => void
  appInfo: 'sys:app-info', // () => AppInfo
  pathExists: 'sys:path-exists', // (path) => boolean
  menuCommand: 'menu:command', // main → renderer push: MenuCommand
  notificationClicked: 'sys:notification-clicked', // main → renderer push: chatId
} as const

export type Result = { ok: true } | { ok: false; error: string }

export interface EmberAPI {
  env: {
    get(): Promise<EnvStatus>
    recheck(): Promise<EnvStatus>
    onChanged(cb: (s: EnvStatus) => void): () => void
    getRateLimits(): Promise<RateLimitSnapshot | null>
    /** Ask the CLI for current plan usage (5h / weekly windows); resolves with the fresh snapshot. */
    refreshUsage(): Promise<RateLimitSnapshot | null>
    onRateLimits(cb: (r: RateLimitSnapshot) => void): () => void
  }
  settings: {
    get(): Promise<AppSettings>
    set(patch: Partial<AppSettings>): Promise<AppSettings>
    onChanged(cb: (s: AppSettings) => void): () => void
  }
  history: {
    list(opts?: { limit?: number }): Promise<SessionSummary[]>
    load(sessionId: string): Promise<LoadedHistory>
    rename(sessionId: string, title: string): Promise<void>
    delete(sessionId: string): Promise<void>
    onChanged(cb: () => void): () => void
  }
  session: {
    start(opts: StartOptions): Promise<Result>
    send(payload: SendPayload): Promise<Result>
    interrupt(chatId: string): Promise<void>
    setModel(chatId: string, model?: string): Promise<void>
    setPermissionMode(chatId: string, mode: PermissionMode): Promise<void>
    setEffort(chatId: string, effort: EffortChoice | null): Promise<void>
    close(chatId: string): Promise<void>
    respond(resp: PermissionResponse): Promise<void>
    pending(): Promise<PermissionRequest[]>
    meta(chatId: string): Promise<SessionMeta | null>
    contextUsage(chatId: string): Promise<ContextUsage | null>
    liveList(): Promise<Array<{ chatId: string; sessionId?: string; status: string; cwd?: string }>>
    onEvent(cb: (e: SessionEvent) => void): () => void
  }
  files: {
    suggest(cwd: string, query: string): Promise<FileSuggestion[]>
    /** Absolute filesystem path of a dropped/pasted File ('' if it has none). Synchronous, preload-only. */
    pathForFile(file: File): string
  }
  sys: {
    pickDirectory(defaultPath?: string): Promise<string | null>
    pickImages(): Promise<ImageAttachment[]>
    pickExecutable(): Promise<string | null>
    openExternal(url: string): Promise<void>
    showInFinder(path: string): Promise<void>
    openInTerminal(cwd: string, command?: string): Promise<void>
    openPath(path: string): Promise<void>
    notify(title: string, body: string, chatId?: string): Promise<void>
    setBadge(count: number): Promise<void>
    appInfo(): Promise<AppInfo>
    pathExists(path: string): Promise<boolean>
    onMenuCommand(cb: (cmd: MenuCommand) => void): () => void
    onNotificationClicked(cb: (chatId: string) => void): () => void
  }
}
