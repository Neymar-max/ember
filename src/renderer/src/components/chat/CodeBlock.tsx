/** Syntax-highlighted code block used both by Markdown (fenced code) and tool bodies (Read/Write/…).
 * Highlighting is done directly with highlight.js (not via a rehype pipeline) so this component can
 * be reused outside of react-markdown with the exact same header/copy/line-number/collapse chrome. */
import clsx from 'clsx'
import hljs from 'highlight.js'
import { useMemo, useState } from 'react'
import { CopyButton } from '@/components/common/CopyButton'
import { useT } from '@/i18n'
import './CodeBlock.css'
import './highlight-theme.css'
import { useIsStreaming } from './streamingContext'

export interface CodeBlockProps {
  code: string
  language?: string
  /** show line numbers starting at this number (omit = no numbers) */
  startLine?: number
  /** max visible lines before a "show all" toggle (omit = unlimited) */
  maxLines?: number
  /** hide the header bar (for embedding in tool bodies) */
  bare?: boolean
  className?: string
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'))
}

export function CodeBlock({ code, language, startLine, maxLines, bare, className }: CodeBlockProps) {
  const t = useT()
  const [expanded, setExpanded] = useState(false)
  // While the enclosing Markdown is still streaming, skip hljs entirely — re-running it on the
  // whole code block for every delta is the expensive part (R3). Falls back to plain escaped text
  // and re-highlights once (memoized below) the instant streaming ends.
  const isStreaming = useIsStreaming()

  const lineCount = useMemo(() => (code.length === 0 ? 1 : code.split('\n').length), [code])
  const collapsible = maxLines != null && lineCount > maxLines
  const collapsed = collapsible && !expanded

  const highlighted = useMemo(() => {
    if (isStreaming) return escapeHtml(code)
    try {
      if (language && hljs.getLanguage(language)) return hljs.highlight(code, { language, ignoreIllegals: true }).value
      return hljs.highlightAuto(code).value
    } catch {
      return escapeHtml(code)
    }
  }, [code, language, isStreaming])

  return (
    <div className={clsx('em-chat-codeblock', bare && 'em-chat-codeblock--bare', className)}>
      {!bare && (
        <div className="em-chat-codeblock__header">
          <span className="em-chat-codeblock__lang">{language || t('chat.code.plainText')}</span>
          <CopyButton text={code} />
        </div>
      )}
      <div className="em-chat-codeblock__viewport" style={collapsed ? { maxHeight: `${maxLines! * 1.6 + 1.6}em` } : undefined}>
        <div className="em-chat-codeblock__row">
          {startLine != null && (
            <div className="em-chat-codeblock__gutter" aria-hidden>
              {Array.from({ length: lineCount }, (_, i) => (
                <div key={i}>{startLine + i}</div>
              ))}
            </div>
          )}
          <pre className="em-chat-codeblock__pre">
            <code className="hljs em-mono" dangerouslySetInnerHTML={{ __html: highlighted }} />
          </pre>
        </div>
        {collapsed && <div className="em-chat-codeblock__fade" aria-hidden />}
      </div>
      {collapsible && (
        <button type="button" className="em-chat-codeblock__toggle" onClick={() => setExpanded((v) => !v)}>
          {expanded ? t('common.showLess') : t('chat.code.showAllLines', { n: lineCount })}
        </button>
      )}
    </div>
  )
}
