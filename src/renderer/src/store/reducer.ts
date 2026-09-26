/**
 * Pure reducer that turns raw SDK messages (live, via stream_event + assistant/user/system/result)
 * or replayed HistoryMessage[] into the renderer's ChatState view model. See SPEC.md §3 rules 1–11 —
 * every branch below is grounded in a real capture under docs/fixtures/*.jsonl.
 *
 * Design note: the function must stay pure (same input → same output, no module-level mutable state)
 * because it also has to replay a whole history transcript deterministically. Anything that would
 * normally be "just a local variable that survives between events" (which message id is currently
 * streaming, which content-block index maps to which part) is therefore threaded through
 * `state.streamOpen` instead of a closure/module variable.
 */
import type { HistoryMessage, PermissionMode, RawSdkMessage } from '@shared/types'
import { t } from '@/i18n'
import { uuid } from '@/lib/format'
import { cleanUserText } from '@shared/userText'
import type { BackgroundTask, ChatItem, ChatState, ImageRef, Part, TodoItem, ToolCall, ToolStatus } from './types'

const MAIN = '__main__'

const DENIED_PREFIXES = ["The user doesn't want to proceed", 'User rejected', 'Permission to use', 'denied']
const NON_TERMINAL_TOOL_STATUS = new Set<ToolStatus>(['streaming', 'pending', 'waiting-permission', 'running'])

const CMD_RE = /<command-name>([\s\S]*?)<\/command-name>[\s\S]*?<command-args>([\s\S]*?)<\/command-args>/
const STDOUT_RE = /<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/
const SYS_REMINDER_RE = /<system-reminder>[\s\S]*?<\/system-reminder>/g

export function applySdkMessage(state: ChatState, msg: RawSdkMessage, opts?: { live?: boolean }): ChatState {
  const live = opts?.live !== false
  const m = msg as Record<string, any>

  // Mutable local "draft" — reassigned (never in-place mutated) by the helpers below, then folded
  // back into a fresh ChatState at the end. Individual items/tools/parts that a given message does
  // NOT touch keep their original object identity, which is what lets React.memo skip re-rendering
  // everything except the part that actually changed while streaming.
  let items = state.items
  let tools = state.tools
  let todos = state.todos
  let backgroundTasks = state.backgroundTasks
  let streamOpen = state.streamOpen ?? {}
  const patch: Partial<ChatState> = {
    lastActivity: live ? Date.now() : parseTimestamp(m.timestamp) ?? state.lastActivity,
  }

  // ── small immutable-update helpers (closures over the `let`s above) ─────────────────────────
  function pushItem(item: ChatItem): void {
    items = [...items, item]
  }
  function pushNotice(level: 'info' | 'warning' | 'error', text: string, detail?: string): void {
    pushItem({ kind: 'notice', id: uuid(), level, text, detail })
  }
  // The assistant item currently receiving MAIN-lane content is normally the last item — except a
  // notice/command-output pushed mid-turn (api_retry, informational, local_command_output, …)
  // sits *after* it. Walk back over any of those (they never end a turn) to find it; a real turn
  // boundary (a user or result item) means there is no open assistant item to resume.
  function findMainAssistantIndex(): number {
    for (let i = items.length - 1; i >= 0; i--) {
      const kind = items[i].kind
      if (kind === 'assistant') return i
      // A compaction boundary ends the bubble: text after it starts a fresh assistant item.
      if (kind === 'notice' || kind === 'command-output') continue
      return -1
    }
    return -1
  }
  function ensureAssistantItem(model?: string): void {
    const idx = findMainAssistantIndex()
    if (idx >= 0) {
      const cur = items[idx] as Extract<ChatItem, { kind: 'assistant' }>
      if (model && !cur.model) items = replaceAt(items, idx, { ...cur, model })
      return
    }
    items = [...items, { kind: 'assistant', id: uuid(), parts: [], streaming: true, model }]
  }
  function getTargetParts(laneId: string): Part[] {
    if (laneId === MAIN) {
      const idx = findMainAssistantIndex()
      return idx >= 0 ? (items[idx] as Extract<ChatItem, { kind: 'assistant' }>).parts : []
    }
    return tools[laneId]?.children ?? []
  }
  function setTargetParts(laneId: string, next: Part[]): void {
    if (laneId === MAIN) {
      const idx = findMainAssistantIndex()
      if (idx >= 0) items = replaceAt(items, idx, { ...(items[idx] as Extract<ChatItem, { kind: 'assistant' }>), parts: next })
      return
    }
    const tc = tools[laneId]
    if (tc) tools = { ...tools, [laneId]: { ...tc, children: next } }
  }
  function updatePartById(laneId: string, partId: string, fn: (p: Part) => Part): void {
    const parts = getTargetParts(laneId)
    const idx = parts.findIndex((p) => p.id === partId)
    if (idx < 0) return
    setTargetParts(laneId, replaceAt(parts, idx, fn(parts[idx])))
  }
  function findOpenPartIndex(parts: Part[], type: 'text' | 'thinking', msgId: string): number {
    return parts.findIndex((p) => p.type === type && (p as { msgId?: string }).msgId === msgId && p.streaming !== false)
  }

  function ensureTool(id: string, name: string, input: Record<string, unknown> | undefined, parentToolUseId: string | null, streamingPartial: boolean): void {
    const existing = tools[id]
    if (!existing) {
      tools = {
        ...tools,
        [id]: {
          id,
          name,
          input: input ?? {},
          inputJson: streamingPartial ? '' : undefined,
          status: streamingPartial ? 'streaming' : 'pending',
          parentToolUseId,
          children: [],
          startedAt: Date.now(),
        },
      }
      const laneId = parentToolUseId ?? MAIN
      setTargetParts(laneId, [...getTargetParts(laneId), { type: 'tool', id: uuid(), toolUseId: id }])
      return
    }
    let next: ToolCall = { ...existing, name }
    // A definitive (non-streaming) input is authoritative — clear any leftover partial JSON so a
    // content_block_stop arriving *after* this full message can't re-parse stale deltas over it
    // (the full echo can carry fields, e.g. Edit's `replace_all`, the raw JSON deltas omitted).
    if (input && Object.keys(input).length > 0) next = { ...next, input, inputJson: streamingPartial ? next.inputJson : undefined }
    if (!streamingPartial && next.status === 'streaming') next = { ...next, status: 'pending' }
    tools = { ...tools, [id]: next }
  }

  function appendToolInputJson(toolId: string, chunk: string): void {
    if (!chunk) return
    const tc = tools[toolId]
    if (!tc) return
    tools = { ...tools, [toolId]: { ...tc, inputJson: (tc.inputJson ?? '') + chunk } }
  }
  function finalizeToolInputJson(toolId: string): void {
    const tc = tools[toolId]
    if (!tc || !tc.inputJson) return
    try {
      const parsed = JSON.parse(tc.inputJson)
      tools = { ...tools, [toolId]: { ...tc, input: parsed, inputJson: undefined, status: tc.status === 'streaming' ? 'pending' : tc.status } }
    } catch {
      // still incomplete JSON — the full assistant message that follows will finalize the input.
    }
  }

  function finalizePartsArray(parts: Part[]): Part[] {
    let changed = false
    const next = parts.map((p) => {
      if ((p.type === 'text' || p.type === 'thinking') && p.streaming) {
        changed = true
        return { ...p, streaming: false }
      }
      return p
    })
    return changed ? next : parts
  }
  function finalizeAllStreamingParts(): void {
    const idx = findMainAssistantIndex()
    if (idx >= 0) {
      const cur = items[idx] as Extract<ChatItem, { kind: 'assistant' }>
      if (cur.streaming) items = replaceAt(items, idx, { ...cur, streaming: false, parts: finalizePartsArray(cur.parts) })
    }
    let toolsChanged = false
    const next: Record<string, ToolCall> = { ...tools }
    for (const [id, tc] of Object.entries(tools)) {
      const nc = finalizePartsArray(tc.children)
      if (nc !== tc.children) {
        next[id] = { ...tc, children: nc }
        toolsChanged = true
      }
    }
    if (toolsChanged) tools = next
  }
  function markNonTerminalToolsInterrupted(): void {
    let changed = false
    const next: Record<string, ToolCall> = { ...tools }
    for (const [id, tc] of Object.entries(tools)) {
      if (NON_TERMINAL_TOOL_STATUS.has(tc.status)) {
        next[id] = { ...tc, status: 'interrupted' }
        changed = true
      }
    }
    if (changed) tools = next
  }

  function replaceAtBg(idx: number, v: BackgroundTask): void {
    backgroundTasks = replaceAt(backgroundTasks, idx, v)
  }

  // ── todos (rule 6) ────────────────────────────────────────────────────────────────────────
  function upsertTodo(patchTodo: Partial<TodoItem> & { id: string }, mergeOnly = false): void {
    const idx = todos.findIndex((td) => td.id === patchTodo.id)
    if (idx < 0) {
      if (mergeOnly) return
      todos = [...todos, { id: patchTodo.id, content: patchTodo.content ?? '', activeForm: patchTodo.activeForm, status: patchTodo.status ?? 'pending' }]
      return
    }
    const prev = todos[idx]
    todos = replaceAt(todos, idx, {
      ...prev,
      content: patchTodo.content ?? prev.content,
      activeForm: patchTodo.activeForm ?? prev.activeForm,
      status: patchTodo.status ?? prev.status,
    })
  }
  function removeTodo(id: string): void {
    todos = todos.filter((td) => td.id !== id)
  }
  function applyTodoResultEffects(tool: ToolCall, structured: any): void {
    if (tool.name === 'TaskCreate' && structured?.task?.id != null) {
      const input = tool.input as any
      upsertTodo({ id: String(structured.task.id), content: input.subject ?? structured.task.subject ?? '', activeForm: input.activeForm, status: 'pending' })
    } else if (tool.name === 'TaskUpdate') {
      const input = tool.input as any
      if (input?.taskId == null) return
      const id = String(input.taskId)
      if (input.status === 'deleted') {
        removeTodo(id)
        return
      }
      upsertTodo({ id, content: input.subject, activeForm: input.activeForm, status: structured?.statusChange?.to ?? input.status }, true)
    } else if (tool.name === 'TaskList' && Array.isArray(structured?.tasks)) {
      const prevById = new Map(todos.map((td) => [td.id, td]))
      todos = structured.tasks.map((tk: any) => ({
        id: String(tk.id),
        content: tk.subject ?? '',
        status: tk.status ?? 'pending',
        activeForm: prevById.get(String(tk.id))?.activeForm,
      }))
    }
  }

  // ── content blocks (rule 2 / 4) ───────────────────────────────────────────────────────────
  function applyFinalBlock(laneId: string, block: any, msgId: string, parentToolUseId: string | null): void {
    switch (block?.type) {
      case 'text': {
        const parts = getTargetParts(laneId)
        const idx = findOpenPartIndex(parts, 'text', msgId)
        if (idx >= 0) setTargetParts(laneId, replaceAt(parts, idx, { ...(parts[idx] as Extract<Part, { type: 'text' }>), text: block.text ?? '', streaming: false }))
        else setTargetParts(laneId, [...parts, { type: 'text', id: uuid(), text: block.text ?? '', streaming: false, msgId }])
        break
      }
      case 'thinking': {
        const parts = getTargetParts(laneId)
        const idx = findOpenPartIndex(parts, 'thinking', msgId)
        if (idx >= 0) setTargetParts(laneId, replaceAt(parts, idx, { ...(parts[idx] as Extract<Part, { type: 'thinking' }>), text: block.thinking ?? '', streaming: false }))
        else setTargetParts(laneId, [...parts, { type: 'thinking', id: uuid(), text: block.thinking ?? '', streaming: false, msgId }])
        break
      }
      case 'tool_use': {
        ensureTool(block.id, block.name, block.input, parentToolUseId, false)
        if (block.name === 'TodoWrite' && Array.isArray(block.input?.todos)) {
          todos = block.input.todos.map((td: any, i: number) => ({
            id: td.id != null ? String(td.id) : `todo-${i}`,
            content: td.content ?? '',
            activeForm: td.activeForm,
            status: td.status ?? 'pending',
          }))
        }
        break
      }
      default:
        break // redacted_thinking, server_tool_use, … — nothing to render yet.
    }
  }

  // ── message handlers, one per RawSdkMessage.type ─────────────────────────────────────────
  function handleStreamEvent(msg2: any): void {
    const ev = msg2.event
    if (!ev) return
    const parentToolUseId = (msg2.parent_tool_use_id ?? null) as string | null
    const laneId = parentToolUseId ?? MAIN
    const laneEntry = streamOpen[laneId] ?? { msgId: '', blocks: {} }

    switch (ev.type) {
      case 'message_start': {
        const msgId = ev.message?.id ?? ''
        streamOpen = { ...streamOpen, [laneId]: { msgId, blocks: {} } }
        break
      }
      case 'content_block_start': {
        const idx: number = ev.index
        const block = ev.content_block
        const msgId = laneEntry.msgId
        if (laneId === MAIN) ensureAssistantItem()
        if (block?.type === 'text') {
          const part: Part = { type: 'text', id: uuid(), text: block.text ?? '', streaming: true, msgId }
          setTargetParts(laneId, [...getTargetParts(laneId), part])
          streamOpen = { ...streamOpen, [laneId]: { ...laneEntry, blocks: { ...laneEntry.blocks, [idx]: { kind: 'text', partId: part.id } } } }
        } else if (block?.type === 'thinking') {
          const part: Part = { type: 'thinking', id: uuid(), text: block.thinking ?? '', streaming: true, msgId }
          setTargetParts(laneId, [...getTargetParts(laneId), part])
          streamOpen = { ...streamOpen, [laneId]: { ...laneEntry, blocks: { ...laneEntry.blocks, [idx]: { kind: 'thinking', partId: part.id } } } }
        } else if (block?.type === 'tool_use') {
          ensureTool(block.id, block.name, block.input, parentToolUseId, true)
          streamOpen = { ...streamOpen, [laneId]: { ...laneEntry, blocks: { ...laneEntry.blocks, [idx]: { kind: 'tool', toolId: block.id } } } }
        }
        break
      }
      case 'content_block_delta': {
        const idx: number = ev.index
        const entry = laneEntry.blocks[idx]
        if (!entry) break
        const delta = ev.delta
        if (entry.kind === 'text' && delta?.type === 'text_delta' && entry.partId) {
          updatePartById(laneId, entry.partId, (p) => ({ ...p, text: (p as any).text + (delta.text ?? '') }))
        } else if (entry.kind === 'thinking' && delta?.type === 'thinking_delta' && entry.partId) {
          updatePartById(laneId, entry.partId, (p) => {
            const next: any = { ...p, text: (p as any).text + (delta.thinking ?? '') }
            if (typeof delta.estimated_tokens === 'number') next.tokens = delta.estimated_tokens
            return next
          })
        } else if (entry.kind === 'tool' && delta?.type === 'input_json_delta' && entry.toolId) {
          appendToolInputJson(entry.toolId, delta.partial_json ?? '')
        }
        break
      }
      case 'content_block_stop': {
        const idx: number = ev.index
        const entry = laneEntry.blocks[idx]
        if (entry?.kind === 'tool' && entry.toolId) finalizeToolInputJson(entry.toolId)
        if (entry) {
          const blocks = { ...laneEntry.blocks }
          delete blocks[idx]
          streamOpen = { ...streamOpen, [laneId]: { ...laneEntry, blocks } }
        }
        break
      }
      default:
        break // message_delta / message_stop / ping — no visible state change.
    }
  }

  function handleAssistant(msg2: any): void {
    const message = msg2.message ?? {}
    // CLI-made placeholder replies (e.g. "No response requested." after /compact) — not Claude's words.
    if (message.model === '<synthetic>' && !msg2.isApiErrorMessage && !msg2.error) {
      const txt = (Array.isArray(message.content) ? message.content : []).map((b: any) => b?.text ?? '').join('').trim()
      if (txt === 'No response requested.' || txt === '') return
    }
    const parentToolUseId = (msg2.parent_tool_use_id ?? null) as string | null
    const laneId = parentToolUseId ?? MAIN
    if (laneId === MAIN) ensureAssistantItem(message.model)
    const msgId = message.id ?? ''
    const blocks: any[] = Array.isArray(message.content) ? message.content : []
    for (const block of blocks) applyFinalBlock(laneId, block, msgId, parentToolUseId)

    if (message.usage && laneId === MAIN) {
      const u = message.usage
      patch.contextTokens = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
    }
    if (msg2.error) pushNotice('error', friendlyAssistantError(msg2.error))
  }

  function handleToolResult(block: any, toolUseResult: unknown, parentToolUseId: string | null): void {
    const toolUseId = block.tool_use_id
    if (!toolUseId) return
    const existing = tools[toolUseId]
    const isError = !!block.is_error
    const text = contentToText(block.content)
    const denied = isError && DENIED_PREFIXES.some((p) => text.startsWith(p))
    const status: ToolStatus = denied ? 'denied' : isError ? 'error' : (toolUseResult as any)?.isAsync ? 'running' : 'done'
    const base: ToolCall = existing ?? { id: toolUseId, name: 'unknown', input: {}, status: 'pending', parentToolUseId, children: [] }
    const next: ToolCall = {
      ...base,
      result: { content: block.content, isError },
      structured: toolUseResult,
      status,
      deniedReason: denied ? text : undefined,
      endedAt: Date.now(),
    }
    tools = { ...tools, [toolUseId]: next }
    applyTodoResultEffects(next, toolUseResult)
  }

  function handleInterruptNotice(): void {
    finalizeAllStreamingParts()
    markNonTerminalToolsInterrupted()
    pushNotice('info', t('chat.notice.interrupted'))
  }

  function handleUser(msg2: any): void {
    const message = msg2.message ?? {}
    const parentToolUseId = (msg2.parent_tool_use_id ?? null) as string | null
    const raw = message.content
    const blocks: any[] = typeof raw === 'string' ? [{ type: 'text', text: raw }] : Array.isArray(raw) ? raw : []
    const toolResults = blocks.filter((b) => b?.type === 'tool_result')
    for (const tr of toolResults) handleToolResult(tr, msg2.tool_use_result, parentToolUseId)

    const allToolResult = blocks.length > 0 && toolResults.length === blocks.length
    if (allToolResult) return
    // Text inside a subagent's lane is the subagent's task prompt (already shown in the Agent row's
    // input), never something the user typed.
    if (parentToolUseId) return

    if (msg2.isMeta) return

    const textBlocks = blocks.filter((b) => b?.type === 'text')
    const text = textBlocks.map((b) => b.text ?? '').join('\n')
    if (text.startsWith('Caveat:')) return
    if (text.trim() === '[Request interrupted by user]') {
      handleInterruptNotice()
      return
    }

    const stdoutMatch = STDOUT_RE.exec(text)
    if (stdoutMatch) {
      const out = stripAnsi(stdoutMatch[1]).trim()
      if (out) pushItem({ kind: 'command-output', id: msg2.uuid ?? uuid(), text: out })
      return
    }

    const imageBlocks = blocks.filter((b) => b?.type === 'image')
    const images = imageBlocks.map(imageRefFromBlock).filter((x): x is ImageRef => x != null)
    const withoutReminders = text.replace(SYS_REMINDER_RE, '').trim()
    if (withoutReminders === '' && images.length === 0) return
    if (msg2.isCompactSummary || msg2.isVisibleInTranscriptOnly) return

    const id = msg2.uuid ?? uuid()
    const timestamp = parseTimestamp(msg2.timestamp)
    const cmdMatch = CMD_RE.exec(withoutReminders)
    if (cmdMatch) {
      const name = cmdMatch[1].trim().replace(/^\//, '')
      const args = cmdMatch[2].trim()
      pushItem({ kind: 'user', id, text: `/${name}${args ? ' ' + args : ''}`, command: { name, args }, images: images.length ? images : undefined, timestamp })
      return
    }
    const clean = cleanUserText(withoutReminders)
    if (clean.text === null || (clean.text === '' && images.length === 0 && clean.attachments.length === 0)) return
    pushItem({
      kind: 'user',
      id,
      text: clean.text,
      images: images.length ? images : undefined,
      attachments: clean.attachments.length ? clean.attachments : undefined,
      timestamp,
    })
  }

  function handleResult(msg2: any): void {
    const isError = !!msg2.is_error || msg2.subtype !== 'success'
    const interrupted = msg2.terminal_reason === 'aborted_streaming'
    const errorText = isError ? (typeof msg2.result === 'string' && msg2.result ? msg2.result : Array.isArray(msg2.errors) ? msg2.errors.join('\n') : undefined) : undefined
    const inputTokens = msg2.usage?.input_tokens
    const outputTokens = msg2.usage?.output_tokens
    const result = {
      subtype: msg2.subtype,
      isError,
      durationMs: msg2.duration_ms,
      costUsd: msg2.total_cost_usd,
      inputTokens,
      outputTokens,
      cacheReadTokens: msg2.usage?.cache_read_input_tokens,
      numTurns: msg2.num_turns,
      errorText,
      interrupted: interrupted || undefined,
    }
    finalizeAllStreamingParts()
    if (interrupted) markNonTerminalToolsInterrupted()
    pushItem({ kind: 'result', id: msg2.uuid ?? uuid(), result })
    patch.status = 'idle'
    patch.lastResult = result
    patch.turnStartedAt = undefined
    patch.totals = {
      // total_cost_usd is already the running total for the whole session (per SDK docs) — replacing
      // it avoids double-counting; usage.input/output_tokens are per-turn, so those DO accumulate.
      costUsd: typeof result.costUsd === 'number' ? result.costUsd : state.totals.costUsd,
      inputTokens: state.totals.inputTokens + (inputTokens ?? 0),
      outputTokens: state.totals.outputTokens + (outputTokens ?? 0),
    }
  }

  function setLastOpenThinkingTokens(tokensVal: number): void {
    const parts = getTargetParts(MAIN)
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i]
      if (p.type === 'thinking' && p.streaming) {
        setTargetParts(MAIN, replaceAt(parts, i, { ...p, tokens: tokensVal }))
        return
      }
    }
  }

  function handleBackgroundTasksChanged(msg2: any): void {
    const rawTasks: any[] = msg2.tasks ?? []
    const liveIds = new Set<string>(rawTasks.map((t) => t.task_id))
    const byId = new Map(backgroundTasks.map((t) => [t.taskId, t]))
    const next: BackgroundTask[] = rawTasks.map((t) => {
      const prev = byId.get(t.task_id)
      return prev ? { ...prev, description: t.description } : { taskId: t.task_id, description: t.description, status: 'running' }
    })
    for (const t of backgroundTasks) if (!liveIds.has(t.taskId) && t.status !== 'running') next.push(t)
    backgroundTasks = next
  }
  function handleTaskStarted(msg2: any): void {
    const idx = backgroundTasks.findIndex((t) => t.taskId === msg2.task_id)
    const entry: BackgroundTask = { taskId: msg2.task_id, description: msg2.description, toolUseId: msg2.tool_use_id, status: 'running' }
    backgroundTasks = idx >= 0 ? replaceAt(backgroundTasks, idx, entry) : [...backgroundTasks, entry]
    if (msg2.tool_use_id && tools[msg2.tool_use_id]) tools = { ...tools, [msg2.tool_use_id]: { ...tools[msg2.tool_use_id], status: 'running' } }
  }
  function handleTaskProgress(msg2: any): void {
    const idx = backgroundTasks.findIndex((t) => t.taskId === msg2.task_id)
    if (idx >= 0) replaceAtBg(idx, { ...backgroundTasks[idx], summary: msg2.summary })
    const tc = msg2.tool_use_id ? tools[msg2.tool_use_id] : undefined
    if (tc) {
      tools = {
        ...tools,
        [msg2.tool_use_id]: {
          ...tc,
          status: tc.status === 'done' || tc.status === 'error' ? tc.status : 'running',
          progress: { elapsedSeconds: msg2.usage?.duration_ms != null ? msg2.usage.duration_ms / 1000 : tc.progress?.elapsedSeconds, summary: msg2.summary, lastToolName: msg2.last_tool_name },
        },
      }
    }
  }
  function handleTaskUpdated(msg2: any): void {
    const idx = backgroundTasks.findIndex((t) => t.taskId === msg2.task_id)
    const statusMap: Record<string, BackgroundTask['status']> = { completed: 'completed', failed: 'failed', killed: 'stopped', paused: 'running', running: 'running', pending: 'running' }
    const mapped = msg2.patch?.status ? statusMap[msg2.patch.status] : undefined
    if (idx < 0) return
    const prev = backgroundTasks[idx]
    replaceAtBg(idx, { ...prev, status: mapped ?? prev.status, description: msg2.patch?.description ?? prev.description })
    if (prev.toolUseId && mapped && tools[prev.toolUseId]) {
      const toolStatus: ToolStatus = mapped === 'completed' ? 'done' : mapped === 'failed' ? 'error' : mapped === 'stopped' ? 'interrupted' : 'running'
      tools = { ...tools, [prev.toolUseId]: { ...tools[prev.toolUseId], status: toolStatus } }
    }
  }
  function handleTaskNotification(msg2: any): void {
    const idx = backgroundTasks.findIndex((t) => t.taskId === msg2.task_id)
    const status = msg2.status as BackgroundTask['status']
    if (idx >= 0) replaceAtBg(idx, { ...backgroundTasks[idx], status, summary: msg2.summary })
    else backgroundTasks = [...backgroundTasks, { taskId: msg2.task_id, description: msg2.summary ?? '', toolUseId: msg2.tool_use_id, status, summary: msg2.summary }]
    const toolUseId = msg2.tool_use_id ?? backgroundTasks.find((t) => t.taskId === msg2.task_id)?.toolUseId
    if (toolUseId && tools[toolUseId]) {
      const toolStatus: ToolStatus = status === 'completed' ? 'done' : status === 'failed' ? 'error' : 'interrupted'
      tools = { ...tools, [toolUseId]: { ...tools[toolUseId], status: toolStatus } }
    }
  }
  function handlePermissionDenied(msg2: any): void {
    if (msg2.tool_use_id && tools[msg2.tool_use_id]) {
      tools = { ...tools, [msg2.tool_use_id]: { ...tools[msg2.tool_use_id], status: 'denied', deniedReason: msg2.message } }
    }
  }

  function handleSystem(msg2: any): void {
    // A subagent's own init/status (tagged with the Agent tool's id) must not overwrite the main
    // session's id, model, cwd or permission mode.
    const fromSubagent = msg2.parent_tool_use_id != null
    if (fromSubagent && (msg2.subtype === 'init' || msg2.subtype === 'status')) return
    switch (msg2.subtype) {
      case 'init':
        patch.sessionId = msg2.session_id
        patch.activeModel = msg2.model
        if (msg2.permissionMode) patch.permissionMode = msg2.permissionMode as PermissionMode
        if (msg2.cwd) patch.cwd = msg2.cwd
        if (Array.isArray(msg2.slash_commands)) patch.slashCommands = msg2.slash_commands
        break
      case 'status':
        patch.cliStatus = msg2.status ?? null
        if (msg2.permissionMode) patch.permissionMode = msg2.permissionMode as PermissionMode
        break
      case 'thinking_tokens':
        patch.thinkingTokens = msg2.estimated_tokens
        setLastOpenThinkingTokens(msg2.estimated_tokens)
        break
      case 'compact_boundary': {
        // live stream uses compact_metadata/pre_tokens; transcripts on disk use compactMetadata/preTokens
        const meta = msg2.compact_metadata ?? msg2.compactMetadata ?? {}
        pushItem({
          kind: 'compact',
          id: typeof msg2.uuid === 'string' ? msg2.uuid : uuid(),
          preTokens: meta.pre_tokens ?? meta.preTokens,
          postTokens: meta.post_tokens ?? meta.postTokens,
          trigger: meta.trigger,
        })
        break
      }
      case 'api_retry':
        pushNotice('warning', t('chat.notice.apiRetry', { n: msg2.attempt, max: msg2.max_retries }))
        break
      case 'informational':
        pushNotice(msg2.level === 'warning' ? 'warning' : 'info', msg2.content ?? '')
        break
      case 'notification':
        pushNotice(msg2.priority === 'high' || msg2.priority === 'immediate' ? 'warning' : 'info', msg2.text ?? '')
        break
      case 'local_command_output':
        pushItem({ kind: 'command-output', id: uuid(), text: stripAnsi(msg2.content ?? '') })
        break
      case 'background_tasks_changed':
        handleBackgroundTasksChanged(msg2)
        break
      case 'task_started':
        handleTaskStarted(msg2)
        break
      case 'task_progress':
        handleTaskProgress(msg2)
        break
      case 'task_updated':
        handleTaskUpdated(msg2)
        break
      case 'task_notification':
        handleTaskNotification(msg2)
        break
      case 'permission_denied':
        handlePermissionDenied(msg2)
        break
      default:
        break // hook_*, commands_changed, session_state_changed, model_refusal_*, … — ignored (rule 9).
    }
  }

  switch (m.type) {
    case 'system':
      handleSystem(m)
      break
    case 'stream_event':
      handleStreamEvent(m)
      break
    case 'assistant':
      handleAssistant(m)
      break
    case 'user':
      handleUser(m)
      break
    case 'result':
      handleResult(m)
      break
    case 'tool_progress': {
      const tc = tools[m.tool_use_id]
      if (tc && NON_TERMINAL_TOOL_STATUS.has(tc.status)) {
        tools = { ...tools, [m.tool_use_id]: { ...tc, status: 'running', progress: { ...tc.progress, elapsedSeconds: m.elapsed_time_seconds } } }
      }
      break
    }
    case 'auth_status':
      if (m.error) pushNotice('error', m.error)
      break
    default:
      break // rate_limit_event, tool_use_summary, memory_recall, prompt_suggestion, … — ignored (rule 9).
  }

  return { ...state, ...patch, items, tools, todos, backgroundTasks, streamOpen }
}

/** Replay a loaded history transcript through the same reducer live messages go through, so the
 * two code paths can never drift. */
export function buildFromHistory(base: ChatState, messages: HistoryMessage[]): ChatState {
  let state = base
  for (const message of messages) state = applySdkMessage(state, message, { live: false })
  return state
}

// ── free helpers ─────────────────────────────────────────────────────────────────────────────

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g
function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '')
}

function replaceAt<T>(arr: T[], i: number, v: T): T[] {
  const copy = arr.slice()
  copy[i] = v
  return copy
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map((c) => (typeof c === 'string' ? c : c?.type === 'text' ? c.text ?? '' : '')).join('')
  }
  return ''
}

function imageRefFromBlock(b: any): ImageRef | null {
  const src = b?.source
  if (src?.type === 'base64' && src.data) {
    const mediaType = src.media_type ?? 'image/png'
    return { mediaType, dataUrl: `data:${mediaType};base64,${src.data}` }
  }
  return null
}

function parseTimestamp(ts: unknown): number | undefined {
  if (typeof ts !== 'string') return undefined
  const ms = Date.parse(ts)
  return Number.isNaN(ms) ? undefined : ms
}

function friendlyAssistantError(code: string): string {
  const key = `chat.error.${code}`
  const msg = t(key)
  return msg === key ? t('chat.error.unknown', { code }) : msg
}
