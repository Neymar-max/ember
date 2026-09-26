import type { ToolCall } from '@/store/types'
import { DiffView, type DiffHunk } from '../DiffView'
import { useT } from '@/i18n'

interface EditStructured {
  structuredPatch?: DiffHunk[]
  oldString?: string
  newString?: string
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/** Edit body: prefer the CLI's own structuredPatch (diffed against the real full file).
 * MultiEdit body: same, or — lacking a whole-file structuredPatch — one snippet diff per edit. */
export function EditBody({ tool, cwd }: { tool: ToolCall; cwd?: string }) {
  const t = useT()
  const input = tool.input ?? {}
  const structured = tool.structured as EditStructured | undefined
  const filePath = str(input.file_path)

  if (structured?.structuredPatch && structured.structuredPatch.length > 0) {
    return <DiffView hunks={structured.structuredPatch} path={filePath} cwd={cwd} />
  }

  if (tool.name === 'MultiEdit') {
    const edits = Array.isArray(input.edits) ? (input.edits as { old_string?: unknown; new_string?: unknown }[]) : []
    if (edits.length === 0) return <div className="em-tool-empty">{t('tools.generic.empty')}</div>
    return (
      <div className="em-tool-multiedit">
        {edits.map((e, i) => (
          <div key={i} className="em-tool-multiedit-item">
            <div className="em-tool-multiedit-label">{t('tools.edit.editN', { n: i + 1, total: edits.length })}</div>
            <DiffView oldText={str(e.old_string)} newText={str(e.new_string)} />
          </div>
        ))}
      </div>
    )
  }

  const oldStr = str(input.old_string) || str(structured?.oldString)
  const newStr = str(input.new_string) || str(structured?.newString)
  return <DiffView oldText={oldStr} newText={newStr} path={filePath} cwd={cwd} />
}
