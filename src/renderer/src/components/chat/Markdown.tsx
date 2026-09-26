/** Renders assistant/plan prose. variant 'message' = serif message font; 'ui' = sans UI font (§4.2). */
import clsx from 'clsx'
import type { ReactNode } from 'react'
import { memo, useDeferredValue } from 'react'
import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ember } from '@/lib/api'
import { CodeBlock } from './CodeBlock'
import './Markdown.css'
import { StreamingProvider } from './streamingContext'

export interface MarkdownProps {
  text: string
  variant?: 'message' | 'ui'
  /** true while text is still streaming (renderer may avoid expensive work) */
  streaming?: boolean
  className?: string
}

function extractText(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (typeof node === 'object' && 'props' in node) return extractText((node as { props?: { children?: ReactNode } }).props?.children)
  return ''
}

function langFromClassName(className?: string): string | undefined {
  return /language-(\S+)/.exec(className ?? '')?.[1]
}

// Fenced code always renders as `pre > code` in the hast tree; a bare `code` component invocation
// (no wrapping `pre`) is always an inline span — that structural fact, not the presence of a
// `language-*` class, is what tells the two apart (a fence with no info string has no class at all).
const components: Components = {
  a: ({ href, children, ...rest }) => (
    <a
      {...rest}
      href={href}
      onClick={(e) => {
        e.preventDefault()
        if (href) void ember.sys.openExternal(href)
      }}
    >
      {children}
    </a>
  ),
  pre: ({ children }) => {
    const child = Array.isArray(children) ? children[0] : children
    const codeProps = child && typeof child === 'object' && 'props' in child ? (child as { props: { className?: string; children?: ReactNode } }).props : undefined
    return <CodeBlock code={extractText(codeProps?.children).replace(/\n$/, '')} language={langFromClassName(codeProps?.className)} />
  },
  code: ({ className, children, ...rest }) => (
    <code className={clsx('em-chat-inline-code', className)} {...rest}>
      {children}
    </code>
  ),
  table: ({ children, ...rest }) => (
    <div className="em-chat-table-scroll">
      <table {...rest}>{children}</table>
    </div>
  ),
}

export const Markdown = memo(function Markdown({ text, variant = 'message', streaming, className }: MarkdownProps) {
  // Under load (many deltas/frame across several streaming chats) this lets React de-prioritize
  // re-parsing the full markdown tree so input/scroll stay responsive, instead of doing it on every
  // single delta (R3).
  const deferredText = useDeferredValue(text)
  const cls = clsx('em-chat-markdown', variant === 'ui' ? 'em-chat-markdown--ui' : 'em-chat-markdown--message', className)
  return (
    <div className={cls}>
      <StreamingProvider value={!!streaming}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
          {deferredText}
        </ReactMarkdown>
      </StreamingProvider>
    </div>
  )
})
