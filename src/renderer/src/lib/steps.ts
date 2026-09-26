/** One-line summary of a run of tool calls, Claude-app style ("Ran 2 commands", "Created a.py,
 * ran 2 commands +85 -0"). Pure — the component supplies `t` and the diff counts. */
import type { ToolCall } from '@/store/types'

type T = (key: string, vars?: Record<string, string | number>) => string

const base = (p: unknown): string => (typeof p === 'string' ? p.split('/').filter(Boolean).pop() ?? p : '')

export function summarizeSteps(tools: ToolCall[], t: T): string {
  const bucket = new Map<string, ToolCall[]>()
  const order: string[] = []
  for (const tc of tools) {
    const k =
      tc.name === 'Bash' || tc.name === 'BashOutput' || tc.name === 'PowerShell' ? 'bash'
      : tc.name === 'Read' || tc.name === 'NotebookRead' ? 'read'
      : tc.name === 'Write' ? 'write'
      : tc.name === 'Edit' || tc.name === 'MultiEdit' || tc.name === 'NotebookEdit' ? 'edit'
      : tc.name === 'Grep' || tc.name === 'Glob' || tc.name === 'ToolSearch' ? 'search'
      : tc.name === 'WebFetch' || tc.name === 'WebSearch' ? 'web'
      : tc.name === 'Agent' || tc.name === 'Task' ? 'agent'
      : tc.name.startsWith('Task') || tc.name === 'TodoWrite' ? 'todo'
      : 'other'
    if (!bucket.has(k)) { bucket.set(k, []); order.push(k) }
    bucket.get(k)!.push(tc)
  }
  const files = (list: ToolCall[]) => [...new Set(list.map((tc) => base(tc.input?.file_path ?? tc.input?.notebook_path)))].filter(Boolean)
  const phrases = order.map((k, i) => {
    const list = bucket.get(k)!
    const n = list.length
    const f = files(list)
    const key = (s: string) => `chat.steps.${s}${i === 0 ? '' : '.cont'}`
    switch (k) {
      case 'bash': return t(key('bash'), { n })
      case 'read': return f.length === 1 ? t(key('readOne'), { f: f[0] }) : t(key('read'), { n: f.length || n })
      case 'write': return f.length === 1 ? t(key('writeOne'), { f: f[0] }) : t(key('write'), { n: f.length || n })
      case 'edit': return f.length === 1 ? t(key('editOne'), { f: f[0] }) : t(key('edit'), { n: f.length || n })
      case 'search': return t(key('search'), { n })
      case 'web': return t(key('web'), { n })
      case 'agent': return t(key('agent'), { n })
      case 'todo': return t(key('todo'))
      default: return t(key('other'), { n })
    }
  })
  return phrases.join(t('chat.steps.sep'))
}
