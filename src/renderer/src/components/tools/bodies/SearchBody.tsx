import type { ToolCall } from '@/store/types'
import { Markdown } from '@/components/chat/Markdown'
import { useT } from '@/i18n'
import { contentToText, groupGrepByFile } from '../toolContent'

interface GrepStructured {
  filenames?: string[]
  content?: string
}
interface GlobStructured {
  filenames?: string[]
}

export function GrepBody({ tool }: { tool: ToolCall }) {
  const t = useT()
  const structured = tool.structured as GrepStructured | undefined
  const text = structured?.content ?? contentToText(tool.result?.content)
  const groups = groupGrepByFile(text)
  if (groups && groups.length > 0) {
    return (
      <div className="em-tool-grep-groups">
        {groups.map((g) => (
          <div key={g.file} className="em-tool-grep-group">
            <div className="em-tool-grep-file">{g.file}</div>
            <pre className="em-tool-grep-lines">{g.lines.join('\n')}</pre>
          </div>
        ))}
      </div>
    )
  }
  const fallback = text || (structured?.filenames ?? []).join('\n')
  return fallback ? <pre className="em-tool-mono-output">{fallback}</pre> : <div className="em-tool-empty">{t('tools.generic.empty')}</div>
}

export function GlobBody({ tool }: { tool: ToolCall }) {
  const t = useT()
  const structured = tool.structured as GlobStructured | undefined
  const files = structured?.filenames ?? contentToText(tool.result?.content).split('\n').filter(Boolean)
  return files.length > 0 ? <pre className="em-tool-mono-output">{files.join('\n')}</pre> : <div className="em-tool-empty">{t('tools.generic.empty')}</div>
}

export function WebSearchBody({ tool }: { tool: ToolCall }) {
  const text = contentToText(tool.result?.content)
  return <Markdown text={text} variant="ui" className="em-tool-web" />
}

export function WebFetchBody({ tool }: { tool: ToolCall }) {
  const text = contentToText(tool.result?.content)
  return <Markdown text={text} variant="ui" className="em-tool-web" />
}
