import type { ToolCall } from '@/store/types'
import { useT } from '@/i18n'
import { contentToText } from '../toolContent'

function formatValue(v: unknown): string {
  if (typeof v === 'string') return v.length > 400 ? v.slice(0, 400) + '…' : v
  if (v == null) return String(v)
  try {
    const s = JSON.stringify(v)
    return s.length > 400 ? s.slice(0, 400) + '…' : s
  } catch {
    return String(v)
  }
}

/** key: value listing of a tool's input — used as the permission-card preview for tools
 * without a dedicated preview, and as part of GenericBody for unknown tools. */
export function ParamList({ input }: { input: Record<string, unknown> }) {
  const entries = Object.entries(input ?? {}).filter(([k]) => !k.startsWith('_'))
  if (entries.length === 0) return null
  return (
    <dl className="em-tool-kv">
      {entries.map(([k, v]) => (
        <div key={k} className="em-tool-kv-row">
          <dt className="em-tool-kv-key">{k}</dt>
          <dd className="em-tool-kv-val">{formatValue(v)}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Fallback body for tools without a dedicated renderer (MCP tools, Skill, NotebookEdit,
 * anything future/unrecognized): show the input params and whatever text came back. */
export function GenericBody({ tool }: { tool: ToolCall }) {
  const t = useT()
  const text = contentToText(tool.result?.content)
  return (
    <div className="em-tool-generic">
      <ParamList input={tool.input} />
      {text ? <pre className="em-tool-mono-output">{text}</pre> : !tool.input || Object.keys(tool.input).length === 0 ? (
        <div className="em-tool-empty">{t('tools.generic.empty')}</div>
      ) : null}
    </div>
  )
}
