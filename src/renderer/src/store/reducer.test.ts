/**
 * Replays every docs/fixtures/*.jsonl capture through applySdkMessage and checks the behaviours
 * SPEC.md §5 calls out for WP-B, plus a live-vs-history parity check.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { HistoryMessage, RawSdkMessage } from '@shared/types'
import { applySdkMessage, buildFromHistory } from './reducer'
import type { ChatItem, ChatState, ToolCall } from './types'

const FIXTURES_DIR = join(process.cwd(), 'docs/fixtures')

function loadFixture(name: string): RawSdkMessage[] {
  const raw = readFileSync(join(FIXTURES_DIR, name), 'utf8')
  return raw
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line))
    .filter((m) => !('__canUseTool' in m) && !('__interrupt' in m) && !('__error' in m))
}

function initialState(chatId = 'c1', cwd = '/tmp/ember-test'): ChatState {
  return {
    chatId,
    cwd,
    title: '',
    permissionMode: 'default',
    status: 'new',
    items: [],
    tools: {},
    pendingPermissions: [],
    todos: [],
    backgroundTasks: [],
    totals: { costUsd: 0, inputTokens: 0, outputTokens: 0 },
    historyLoaded: false,
    draft: '',
    lastActivity: 0,
  }
}

function replay(messages: RawSdkMessage[], live = true): ChatState {
  let state = initialState()
  for (const m of messages) state = applySdkMessage(state, m, { live })
  return state
}

// Sanity check that every fixture actually exists and this test doesn't silently skip any of them.
const FIXTURE_NAMES = readdirSync(FIXTURES_DIR)
  .filter((f) => f.endsWith('.jsonl'))
  .sort()

describe('fixtures are present', () => {
  it('found all seven capture scenarios', () => {
    expect(FIXTURE_NAMES).toEqual(['ask.jsonl', 'interrupt.jsonl', 'markdown.jsonl', 'plan.jsonl', 'subagent.jsonl', 'todo.jsonl', 'tools.jsonl'])
  })
})

describe('tools.jsonl — rules 1/2/4/8', () => {
  const state = replay(loadFixture('tools.jsonl'))

  it('merges the whole multi-tool-call turn into one assistant item (rule 1)', () => {
    const assistantItems = state.items.filter((i) => i.kind === 'assistant')
    expect(assistantItems).toHaveLength(1)
  })

  it('does not duplicate streamed text once the full message arrives (rule 2)', () => {
    const texts = state.items.flatMap((i) => (i.kind === 'assistant' ? i.parts.filter((p) => p.type === 'text').map((p) => p.text) : []))
    expect(texts).toContain("I'll work through these tasks in sequence.")
    expect(
      texts.some((t) => t.includes("I'll work through these tasks in sequenceI'll work through these tasks in sequence")),
    ).toBe(false)
    expect(texts).toContain(
      'Done. Package.json has `"name": "demo"` and `"version": "1.0.0"`. Created notes.txt with "hi", edited it to "hello world", and grep found the name field in package.json.',
    )
  })

  it('registers Read/Bash/Write/Edit/Bash and marks them all done (rule 4)', () => {
    const names = Object.values(state.tools).map((tc) => tc.name)
    expect(names).toEqual(['Read', 'Bash', 'Write', 'Edit', 'Bash'])
    expect(Object.values(state.tools).every((tc) => tc.status === 'done')).toBe(true)
  })

  it('captures the Edit structured patch and Read line-numbered file content', () => {
    const edit = Object.values(state.tools).find((tc) => tc.name === 'Edit')
    expect((edit?.structured as { structuredPatch?: unknown[] })?.structuredPatch?.length).toBeGreaterThan(0)
    const read = Object.values(state.tools).find((tc) => tc.name === 'Read')
    expect((read?.structured as { file?: { totalLines?: number } })?.file?.totalLines).toBe(4)
  })

  it('ends idle with a successful result and accumulated totals (rule 8)', () => {
    expect(state.status).toBe('idle')
    const result = state.items.filter((i): i is Extract<ChatItem, { kind: 'result' }> => i.kind === 'result').pop()
    expect(result?.result.isError).toBe(false)
    expect(result?.result.numTurns).toBeGreaterThan(0)
    expect(state.totals.outputTokens).toBeGreaterThan(0)
  })
})

describe('todo.jsonl — rule 6', () => {
  const state = replay(loadFixture('todo.jsonl'))

  it('ends the scenario with all 3 todos completed', () => {
    expect(state.todos).toHaveLength(3)
    expect(state.todos.map((t) => t.status)).toEqual(['completed', 'completed', 'completed'])
  })

  it('marks TaskCreate/TaskUpdate/TaskList tool calls done', () => {
    const byName = Object.values(state.tools).filter((tc) => ['TaskCreate', 'TaskUpdate', 'TaskList'].includes(tc.name))
    expect(byName.length).toBeGreaterThan(0)
    expect(byName.every((tc) => tc.status === 'done')).toBe(true)
  })
})

describe('ask.jsonl — AskUserQuestion tool state', () => {
  const state = replay(loadFixture('ask.jsonl'))

  it('resolves the question tool as done with the chosen answer echoed back', () => {
    const ask = Object.values(state.tools).find((tc) => tc.name === 'AskUserQuestion')
    expect(ask?.status).toBe('done')
    expect(String(ask?.result?.content)).toContain('Python')
  })
})

describe('plan.jsonl — ExitPlanMode denial', () => {
  const state = replay(loadFixture('plan.jsonl'))

  it('marks the rejected plan as denied with the CLI-reported reason', () => {
    const plan = Object.values(state.tools).find((tc) => tc.name === 'ExitPlanMode')
    expect(plan?.status).toBe('denied')
    expect(plan?.deniedReason).toContain('User rejected')
  })

  it('still marks the plan-file Write as done', () => {
    const write = Object.values(state.tools).find((tc) => tc.name === 'Write')
    expect(write?.status).toBe('done')
  })
})

describe('subagent.jsonl — rule 5', () => {
  const state = replay(loadFixture('subagent.jsonl'))

  it('routes the subagent turn into the parent Agent tool call, not the top-level item', () => {
    const agent = Object.values(state.tools).find((tc) => tc.name === 'Agent')
    expect(agent).toBeDefined()
    expect(agent!.status).toBe('running') // async_launched / task_started — never finishes in this capture
    expect(agent!.children.length).toBeGreaterThan(0)
    expect(agent!.children.some((p) => p.type === 'thinking')).toBe(true)
    // the subagent's own thinking must NOT leak into the top-level assistant item's parts
    const topLevelHasSubagentThinking = state.items.some(
      (i) => i.kind === 'assistant' && i.parts.some((p) => p.type === 'thinking' && agent!.children.includes(p)),
    )
    expect(topLevelHasSubagentThinking).toBe(false)
  })

  it('tracks the background task started for the subagent', () => {
    expect(state.backgroundTasks.some((t) => t.status === 'running')).toBe(true)
  })
})

describe('markdown.jsonl — streamed prose stays intact', () => {
  const state = replay(loadFixture('markdown.jsonl'))

  it('keeps the streamed markdown text non-duplicated', () => {
    const text = state.items.flatMap((i) => (i.kind === 'assistant' ? i.parts.filter((p) => p.type === 'text').map((p) => p.text) : [])).join('')
    expect(text.match(/Markdown 示例文档/g)).toHaveLength(1)
    expect(text).toContain('```python')
  })
})

describe('mid-turn notice does not split the assistant item (R2)', () => {
  // Synthesized: text block, then a system/api_retry notice pushed mid-turn, then another
  // assistant text block under a *different* message id (as a real retried turn would send).
  const state = replay([
    { type: 'assistant', message: { id: 'm1', model: 'claude-x', content: [{ type: 'text', text: 'Hello' }] } },
    { type: 'system', subtype: 'api_retry', attempt: 1, max_retries: 3 },
    { type: 'assistant', message: { id: 'm2', model: 'claude-x', content: [{ type: 'text', text: 'World' }] } },
  ] as unknown as RawSdkMessage[])

  it('keeps the whole turn as a single assistant item with both text parts', () => {
    const assistantItems = state.items.filter((i): i is Extract<ChatItem, { kind: 'assistant' }> => i.kind === 'assistant')
    expect(assistantItems).toHaveLength(1)
    expect(assistantItems[0].parts.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text)).toEqual(['Hello', 'World'])
  })

  it('still records the api_retry notice, after the assistant item', () => {
    const notices = state.items.filter((i): i is Extract<ChatItem, { kind: 'notice' }> => i.kind === 'notice')
    expect(notices).toHaveLength(1)
    expect(state.items.indexOf(notices[0])).toBeGreaterThan(state.items.findIndex((i) => i.kind === 'assistant'))
  })
})

describe('interrupt.jsonl — rule 7/8', () => {
  const state = replay(loadFixture('interrupt.jsonl'))

  it('produces an "interrupted" notice', () => {
    const notice = state.items.find((i): i is Extract<ChatItem, { kind: 'notice' }> => i.kind === 'notice' && i.level === 'info')
    expect(notice).toBeDefined()
  })

  it('marks the trailing result as interrupted', () => {
    const result = state.items.filter((i): i is Extract<ChatItem, { kind: 'result' }> => i.kind === 'result').pop()
    expect(result?.result.interrupted).toBe(true)
    expect(result?.result.isError).toBe(true)
  })
})

// ── live vs. history parity ─────────────────────────────────────────────────────────────────

function normalizeItems(items: ChatItem[]): unknown[] {
  return items
    .filter((i) => i.kind === 'assistant' || i.kind === 'user')
    .map((i) =>
      i.kind === 'assistant'
        ? { kind: 'assistant', parts: i.parts.map((p) => (p.type === 'tool' ? { type: 'tool', toolUseId: p.toolUseId } : { type: p.type, text: p.text })) }
        : { kind: 'user', text: i.text, command: i.command },
    )
}

function normalizeTools(tools: Record<string, ToolCall>): unknown {
  return Object.fromEntries(Object.entries(tools).map(([id, tc]) => [id, { name: tc.name, status: tc.status, input: tc.input }]))
}

describe('buildFromHistory parity with the live replay', () => {
  it('yields the same items/tools as the live stream_event-driven replay (ignoring streaming flags)', () => {
    const raw = loadFixture('tools.jsonl')
    const live = replay(raw, true)

    // A persisted transcript never contains stream_event or result entries (HistoryMessage['type']
    // is 'user' | 'assistant' | 'system') — only the messages that were actually written to disk.
    const historyMessages = raw.filter((m) => m.type === 'assistant' || m.type === 'user' || m.type === 'system') as unknown as HistoryMessage[]
    const history = buildFromHistory(initialState(), historyMessages)

    expect(normalizeItems(history.items)).toEqual(normalizeItems(live.items))
    expect(normalizeTools(history.tools)).toEqual(normalizeTools(live.tools))
  })
})


describe('subagent lane isolation', () => {
  it('does not turn a subagent prompt into a user bubble or let subagent init change the chat', () => {
    let st = initialState()
    st = applySdkMessage(st, { type: 'system', subtype: 'init', session_id: 'S', model: 'm', permissionMode: 'default', cwd: '/p' } as any)
    st = applySdkMessage(st, { type: 'user', message: { role: 'user', content: 'hello' }, parent_tool_use_id: null, uuid: 'u1' } as any)
    st = applySdkMessage(st, { type: 'assistant', message: { id: 'm1', role: 'assistant', content: [{ type: 'tool_use', id: 'T1', name: 'Agent', input: { prompt: 'do it', description: 'd' } }] }, parent_tool_use_id: null, uuid: 'a1' } as any)
    st = applySdkMessage(st, { type: 'user', message: { role: 'user', content: 'Run this exact Bash command' }, parent_tool_use_id: 'T1', uuid: 'u2' } as any)
    st = applySdkMessage(st, { type: 'system', subtype: 'init', session_id: 'SUB', model: 'x', permissionMode: 'bypassPermissions', cwd: '/other' , parent_tool_use_id: 'T1' } as any)
    st = applySdkMessage(st, { type: 'system', subtype: 'status', status: null, permissionMode: 'bypassPermissions', parent_tool_use_id: 'T1' } as any)
    const users = st.items.filter((i) => i.kind === 'user')
    expect(users.map((u) => (u as any).text)).toEqual(['hello'])
    expect(st.permissionMode).toBe('default')
    expect(st.sessionId).toBe('S')
    expect(st.cwd).toBe('/p')
  })
})
