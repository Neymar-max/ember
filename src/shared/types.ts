/**
 * Shared domain types — the contract between main, preload and renderer.
 * Keep this file dependency-free (no imports from electron / node / SDK runtime)
 * so both tsconfig projects can include it.
 */

// ───────────────────────────── basics ─────────────────────────────

export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'auto' | 'dontAsk' | 'bypassPermissions'
export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
/** What the effort slider can pick: an API effort level, or Ultracode (xhigh + standing workflow orchestration). */
export type EffortChoice = EffortLevel | 'ultracode'
export type ThemeSetting = 'light' | 'dark' | 'system'
export type LanguageSetting = 'zh' | 'en' | 'system'
/** 'claude' = serif (Source Serif 4 + 宋体); 'mixed' = serif Latin + 苹方 CJK; 'sans' = Inter + 苹方 */
export type MessageFont = 'claude' | 'mixed' | 'sans'

/** A raw SDK message (SDKMessage from @anthropic-ai/claude-agent-sdk), passed through untouched.
 * Typed loosely on purpose: the renderer must ignore unknown `type`/`subtype` values. */
export type RawSdkMessage = { type: string; subtype?: string; [k: string]: unknown }

// ───────────────────────────── environment / auth ─────────────────────────────

export interface CliInfo {
  found: boolean
  /** absolute path of the `claude` executable that will be spawned */
  path?: string
  /** e.g. "2.1.283" */
  version?: string
  /** how it was found: 'settings' | 'known-path' | 'login-shell' */
  source?: string
  /** newer CLIs accept --thinking-display (readable thinking summaries); older ones reject it */
  supportsThinkingDisplay?: boolean
  error?: string
}

export interface AccountSummary {
  email?: string
  organization?: string
  /** e.g. "Claude Max", "Claude Pro" */
  subscriptionType?: string
  /** 'firstParty' | 'bedrock' | 'vertex' | ... */
  apiProvider?: string
  tokenSource?: string
  apiKeySource?: string
  /** display name from ~/.claude.json oauthAccount, if any */
  displayName?: string
}

export interface ModelOption {
  value: string // 'default' | 'opus' | 'sonnet' | full id ...
  /** concrete model id this alias currently maps to, e.g. 'claude-opus-5-5' */
  resolvedModel?: string
  displayName: string
  description: string
  supportsEffort?: boolean
  supportedEffortLevels?: EffortLevel[]
}

export interface SlashCommandInfo {
  name: string // without leading slash
  description: string
  argumentHint?: string
  aliases?: string[]
  builtin?: boolean
}

export interface EnvStatus {
  /** 'checking' while probing; 'ready' when CLI found and authenticated;
   * 'no-cli' when CLI not found; 'not-logged-in' when CLI found but no credentials; 'error' otherwise */
  state: 'checking' | 'ready' | 'no-cli' | 'not-logged-in' | 'error'
  cli: CliInfo
  account?: AccountSummary
  models: ModelOption[]
  commands: SlashCommandInfo[]
  /** CLI's configured default model from ~/.claude/settings.json (e.g. 'opus'), if any */
  defaultModel?: string
  /** effort the CLI uses when none is chosen: settings.json modelSettings[resolvedModel].effortLevel */
  modelEffortDefaults?: Record<string, EffortLevel>
  /** top-level settings.json effortLevel (applies to models without their own entry) */
  defaultEffortLevel?: EffortLevel
  error?: string
  checkedAt: number
}

export interface RateLimitWindow {
  /** 0..1 */
  utilization?: number
  /** unix seconds */
  resetsAt?: number
}

export interface RateLimitSnapshot {
  status?: 'allowed' | 'allowed_warning' | 'rejected'
  fiveHour?: RateLimitWindow
  sevenDay?: RateLimitWindow
  /** model-specific weekly windows reported by the plan, e.g. {key:'seven_day_opus', label:'Opus'} */
  weeklyByModel?: Array<{ key: string; label: string; window: RateLimitWindow }>
  /** e.g. "Max (5x)", "Pro" */
  planLabel?: string
  updatedAt: number
}

// ───────────────────────────── settings ─────────────────────────────

export interface AppSettings {
  theme: ThemeSetting
  language: LanguageSetting
  messageFont: MessageFont
  /** base font size for assistant messages, px (14–20) */
  fontSize: number
  /** 'enter' → Enter sends, Shift+Enter newline; 'cmdEnter' → ⌘Enter sends, Enter newline */
  sendKey: 'enter' | 'cmdEnter'
  /** user override for the claude executable; empty = auto-detect */
  cliPath: string
  /** default model for new chats; '' = CLI default */
  defaultModel: string
  defaultPermissionMode: PermissionMode
  /** '' = model default */
  defaultEffort: EffortChoice | ''
  notifyOnDone: boolean
  showThinking: boolean
  showCost: boolean
  sidebarCollapsed: boolean
  /** most-recent-first list of project directories */
  recentProjects: string[]
  lastProject: string
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'light',
  language: 'system',
  messageFont: 'claude',
  fontSize: 16,
  sendKey: 'enter',
  cliPath: '',
  defaultModel: '',
  defaultPermissionMode: 'default',
  defaultEffort: '',
  notifyOnDone: true,
  showThinking: true,
  showCost: false,
  sidebarCollapsed: false,
  recentProjects: [],
  lastProject: '',
}

// ───────────────────────────── history ─────────────────────────────

export interface SessionSummary {
  sessionId: string
  /** best display title: customTitle || summary || firstPrompt */
  title: string
  firstPrompt?: string
  cwd?: string
  gitBranch?: string
  createdAt?: number // ms
  lastModified: number // ms
  fileSize?: number
}

/** One transcript entry, shaped like a live SDK message so the renderer can reuse its reducer.
 * `type` is 'user' | 'assistant' | 'system'. For user entries that carried a tool result,
 * `tool_use_result` holds the structured output (enriched by main from the raw JSONL). */
export interface HistoryMessage extends RawSdkMessage {
  type: 'user' | 'assistant' | 'system'
  uuid: string
  session_id: string
  message: unknown
  parent_tool_use_id: string | null
  timestamp?: string
  tool_use_result?: unknown
  /** true for CLI-internal meta entries (caveats, command wrappers) — renderer may hide */
  isMeta?: boolean
}

export interface LoadedHistory {
  sessionId: string
  cwd?: string
  title: string
  messages: HistoryMessage[]
}

// ───────────────────────────── live sessions ─────────────────────────────

export interface ImageAttachment {
  /** e.g. 'image/png' */
  mediaType: string
  /** base64 WITHOUT the data: prefix */
  data: string
  name?: string
}

export interface StartOptions {
  /** renderer-side stable id of the conversation (uuid for new chats, sessionId for resumed ones) */
  chatId: string
  cwd: string
  /** resume an existing CLI session (history) */
  resumeSessionId?: string
  model?: string
  permissionMode?: PermissionMode
  effort?: EffortChoice
}

export interface SendPayload extends StartOptions {
  text: string
  images?: ImageAttachment[]
  /** renderer-generated uuid for optimistic rendering */
  uuid: string
}

export type LiveStatus = 'starting' | 'idle' | 'running' | 'closed' | 'error'

export interface PermissionRequest {
  requestId: string
  chatId: string
  toolName: string
  input: Record<string, unknown>
  toolUseId: string
  /** human-readable strings prepared by the CLI (prefer these over our own wording) */
  title?: string
  displayName?: string
  description?: string
  decisionReason?: string
  blockedPath?: string
  /** when true the UI must not offer a one-click approve as default focus */
  defaultToNo?: boolean
  /** when true the UI must not offer "always allow" */
  suppressAlwaysAllow?: boolean
  /** CLI-proposed permission updates for "always allow" (opaque PermissionUpdate objects) */
  suggestions?: unknown[]
  /** sub-agent id when requested from inside a subagent */
  agentId?: string
  createdAt: number
}

export interface PermissionResponse {
  requestId: string
  decision: 'allow' | 'deny'
  /** allow: pass back modified input (AskUserQuestion answers go here) */
  updatedInput?: Record<string, unknown>
  /** allow: apply the CLI's suggestions (always-allow for this session) */
  applySuggestions?: boolean
  /** ExitPlanMode approve: switch permission mode after approval */
  switchToMode?: PermissionMode
  /** deny: message fed back to Claude */
  message?: string
  /** deny: also interrupt the whole turn */
  interrupt?: boolean
}

/** Events pushed from main to renderer on channel IPC.sessionEvent */
export type SessionEvent =
  | { chatId: string; kind: 'sdk'; message: RawSdkMessage }
  | { chatId: string; kind: 'status'; status: LiveStatus; error?: string }
  | { chatId: string; kind: 'session-id'; sessionId: string }
  | { chatId: string; kind: 'permission'; request: PermissionRequest }
  | { chatId: string; kind: 'permission-cancelled'; requestId: string }
  | { chatId: string; kind: 'stderr'; text: string }

export interface SessionMeta {
  models: ModelOption[]
  commands: SlashCommandInfo[]
  account?: AccountSummary
  permissionMode?: PermissionMode
  model?: string
}

export interface ContextUsage {
  totalTokens?: number
  maxTokens?: number
  percentage?: number
  /** raw response for advanced display */
  raw?: unknown
}

// ───────────────────────────── misc ─────────────────────────────

export interface FileSuggestion {
  /** path relative to cwd, '/' separated */
  path: string
  isDir: boolean
}

export interface AppInfo {
  version: string
  platform: string
  arch: string
  locale: string
  userName: string
  homeDir: string
}

/** Menu / global shortcut commands sent from main → renderer on IPC.menuCommand */
export type MenuCommand =
  | 'new-chat'
  | 'open-settings'
  | 'toggle-sidebar'
  | 'focus-search'
  | 'focus-composer'
  | 'interrupt'
  | 'open-project'
