/**
 * Renderer-side view model for a conversation. Built by the reducer in `store/reducer.ts`
 * from raw SDK messages (live) or HistoryMessage[] (history) — the SAME reducer handles both.
 */
import type { EffortChoice, PermissionMode, PermissionRequest } from '@shared/types'

export type ChatStatus =
  | 'new' // created locally, nothing sent yet, no process
  | 'loading' // loading history transcript
  | 'idle' // has content; process may or may not be alive; ready for input
  | 'starting' // spawning CLI
  | 'running' // a turn is in progress
  | 'error' // last start/turn failed (see ChatState.error); still allows retry

/** A single renderable block inside an assistant response. */
export type Part =
  // `msgId` (SDK message.id) is reducer-internal bookkeeping: it lets a later *complete* assistant
  // message find & finalize the streamed part it corresponds to instead of appending a duplicate.
  | { type: 'text'; id: string; text: string; streaming?: boolean; msgId?: string }
  | { type: 'thinking'; id: string; text: string; streaming?: boolean; tokens?: number; msgId?: string }
  | { type: 'tool'; id: string; toolUseId: string }

export interface ImageRef {
  mediaType: string
  /** data: URL ready for <img src> */
  dataUrl: string
}

export type ChatItem =
  | {
      kind: 'user'
      id: string // uuid
      text: string
      images?: ImageRef[]
      /** context files the client attached (vault / IDE selections), shown as chips */
      attachments?: string[]
      /** optimistic message not yet acknowledged by the CLI */
      pending?: boolean
      /** set when the user message was a slash command, e.g. {name: 'compact', args: ''} */
      command?: { name: string; args: string }
      timestamp?: number
    }
  | {
      /** One assistant *turn*: all assistant messages between two real user prompts are merged
       * into a single item so text and tool rows flow as one response (Claude-app style). */
      kind: 'assistant'
      id: string
      parts: Part[]
      streaming: boolean
      model?: string
    }
  | { kind: 'notice'; id: string; level: 'info' | 'warning' | 'error'; text: string; detail?: string }
  | { kind: 'result'; id: string; result: TurnResult }
  | { kind: 'compact'; id: string; preTokens?: number; postTokens?: number; trigger?: string }
  | { kind: 'command-output'; id: string; text: string }

export type ToolStatus =
  | 'streaming' // input JSON still streaming in
  | 'pending' // input complete, waiting for execution / result
  | 'waiting-permission' // blocked on a PermissionRequest
  | 'running' // executing (tool_progress seen) or subagent active
  | 'done'
  | 'error' // tool_result.is_error
  | 'denied' // permission denied
  | 'interrupted'

export interface ToolCall {
  id: string // tool_use id
  name: string // e.g. 'Bash', 'Read', 'Edit', 'mcp__server__tool'
  input: Record<string, unknown>
  /** partial JSON while streaming */
  inputJson?: string
  status: ToolStatus
  /** tool_result content as sent to the model (string or content blocks) */
  result?: { content: unknown; isError: boolean }
  /** structured tool output (SDK `tool_use_result`), e.g. Edit → {structuredPatch,...}; may be absent */
  structured?: unknown
  parentToolUseId: string | null
  /** nested parts for Agent/Task subagent calls (text / thinking / tool rows produced by the subagent) */
  children: Part[]
  progress?: { elapsedSeconds?: number; summary?: string; lastToolName?: string }
  /** permission-denied / auto-denied reason */
  deniedReason?: string
  startedAt?: number
  endedAt?: number
}

export interface TurnResult {
  subtype: string // 'success' | 'error_during_execution' | ...
  isError: boolean
  durationMs?: number
  costUsd?: number
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  numTurns?: number
  errorText?: string
  interrupted?: boolean
}

export interface TodoItem {
  id: string
  content: string
  activeForm?: string
  status: 'pending' | 'in_progress' | 'completed'
}

export interface BackgroundTask {
  taskId: string
  description: string
  toolUseId?: string
  status: 'running' | 'completed' | 'failed' | 'stopped'
  summary?: string
}

export interface ChatState {
  chatId: string
  sessionId?: string
  cwd: string
  title: string
  /** user's model choice for this chat; undefined = CLI default */
  model?: string
  /** model actually reported by the CLI (system/init) */
  activeModel?: string
  permissionMode: PermissionMode
  effort?: EffortChoice
  status: ChatStatus
  items: ChatItem[]
  tools: Record<string, ToolCall>
  pendingPermissions: PermissionRequest[]
  todos: TodoItem[]
  backgroundTasks: BackgroundTask[]
  /** live estimate while the model is thinking */
  thinkingTokens?: number
  /** CLI status message: 'requesting' | 'compacting' | null */
  cliStatus?: string | null
  turnStartedAt?: number
  lastResult?: TurnResult
  totals: { costUsd: number; inputTokens: number; outputTokens: number }
  /** latest context size estimate (input + cache tokens of the last API call) */
  contextTokens?: number
  /** context window size reported by the CLI (getContextUsage), e.g. 200000 or 1000000 */
  contextMax?: number
  error?: string
  historyLoaded: boolean
  draft: string
  lastActivity: number
  /** slash command names reported by system/init for this session */
  slashCommands?: string[]
  /** Reducer-internal: tracks the in-flight stream_event message per "lane" ('__main__' or a
   * parent_tool_use_id) so deltas/stops can be routed back to the right part/tool across separate
   * applySdkMessage calls without any module-level mutable state (the reducer stays a pure function). */
  streamOpen?: Record<string, { msgId: string; blocks: Record<number, { kind: 'text' | 'thinking' | 'tool'; partId?: string; toolId?: string }> }>
}
