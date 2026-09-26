/** Side-panel task list: subagents (Agent tool calls), workflows and background commands, merged
 * from the chat's tool calls and the CLI's background-task events. Pure. */
import type { BackgroundTask, ToolCall } from '@/store/types'

export type TaskKind = 'agent' | 'workflow' | 'shell' | 'other'
export type TaskStatus = 'running' | 'done' | 'failed' | 'stopped'

export interface TaskRowModel {
  id: string
  kind: TaskKind
  title: string
  /** subagent type / workflow name / command */
  detail?: string
  status: TaskStatus
  startedAt?: number
  endedAt?: number
  toolUses?: number
  tokens?: number
  /** one-line "what it's doing now" (progress summary or last tool) */
  activity?: string
  toolUseId?: string
}

const AGENT_TOOLS = new Set(['Agent', 'Task'])

function kindOf(taskType?: string, toolName?: string): TaskKind {
  if (toolName && AGENT_TOOLS.has(toolName)) return 'agent'
  if (toolName === 'Workflow') return 'workflow'
  if (!taskType) return 'other'
  if (taskType.includes('agent')) return 'agent'
  if (taskType.includes('workflow')) return 'workflow'
  if (taskType.includes('bash') || taskType === 'shell') return 'shell'
  return 'other'
}

function fromToolStatus(tc: ToolCall): TaskStatus {
  if (tc.status === 'done') return 'done'
  if (tc.status === 'error') return 'failed'
  if (tc.status === 'denied' || tc.status === 'interrupted') return 'stopped'
  return 'running'
}

function fromBgStatus(s: BackgroundTask['status']): TaskStatus {
  return s === 'completed' ? 'done' : s
}

export function buildTaskRows(tools: Record<string, ToolCall>, bg: BackgroundTask[]): TaskRowModel[] {
  const rows: TaskRowModel[] = []
  const bgByTool = new Map(bg.filter((b) => b.toolUseId).map((b) => [b.toolUseId as string, b]))
  const used = new Set<string>()

  for (const tc of Object.values(tools)) {
    if (!AGENT_TOOLS.has(tc.name) && tc.name !== 'Workflow') continue
    const b = bgByTool.get(tc.id)
    if (b) used.add(b.taskId)
    const inp = tc.input ?? {}
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
    rows.push({
      id: tc.id,
      kind: kindOf(b?.taskType, tc.name),
      title: str(inp.description) ?? b?.description ?? str(inp.name) ?? tc.name,
      detail: b?.workflowName ?? str(inp.subagent_type) ?? b?.subagentType ?? (tc.name === 'Workflow' ? str(inp.name) : undefined),
      // A background agent's tool call returns at once ("launched"); the task's own status is the truth.
      status: b ? fromBgStatus(b.status) : fromToolStatus(tc),
      startedAt: b?.startedAt ?? tc.startedAt,
      endedAt: b?.endedAt ?? tc.endedAt,
      toolUses: b?.usage?.toolUses,
      tokens: b?.usage?.totalTokens,
      activity: b?.summary ?? tc.progress?.summary ?? b?.lastToolName ?? tc.progress?.lastToolName,
      toolUseId: tc.id,
    })
  }
  for (const b of bg) {
    if (used.has(b.taskId) || b.ambient) continue
    rows.push({
      id: b.taskId,
      kind: b.toolUseId && tools[b.toolUseId]?.name === 'Bash' ? 'shell' : kindOf(b.taskType),
      title: b.description || b.taskId,
      detail: b.workflowName ?? b.subagentType,
      status: fromBgStatus(b.status),
      startedAt: b.startedAt,
      endedAt: b.endedAt,
      toolUses: b.usage?.toolUses,
      tokens: b.usage?.totalTokens,
      activity: b.summary ?? b.lastToolName,
      toolUseId: b.toolUseId,
    })
  }
  // Running first, then newest first.
  return rows.sort((a, b) => (a.status === 'running' ? 0 : 1) - (b.status === 'running' ? 0 : 1) || (b.startedAt ?? 0) - (a.startedAt ?? 0))
}

export interface ChangedFile {
  path: string
  created: boolean
  add: number
  del: number
  lastAt?: number
}

/** Files Claude (or its subagents) wrote or edited in this chat, newest first. */
export function changedFiles(tools: Record<string, ToolCall>, countLines: (tc: ToolCall) => { add: number; del: number }): ChangedFile[] {
  const map = new Map<string, ChangedFile>()
  for (const tc of Object.values(tools)) {
    if (!['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(tc.name)) continue
    if (tc.status === 'error' || tc.status === 'denied') continue
    const path = (tc.input?.file_path ?? tc.input?.notebook_path) as string | undefined
    if (!path) continue
    let { add, del } = countLines(tc)
    const structured = tc.structured as { type?: string } | undefined
    const created = tc.name === 'Write' && (structured?.type === 'create' || (add + del === 0))
    if (tc.name === 'Write' && add + del === 0 && typeof tc.input?.content === 'string') add = tc.input.content.replace(/\n$/, '').split('\n').length
    const prev = map.get(path)
    map.set(path, {
      path,
      created: prev ? prev.created : created,
      add: (prev?.add ?? 0) + add,
      del: (prev?.del ?? 0) + del,
      lastAt: Math.max(prev?.lastAt ?? 0, tc.endedAt ?? tc.startedAt ?? 0),
    })
  }
  return [...map.values()].sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0))
}
