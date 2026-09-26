import { useState } from 'react'
import { Brain } from 'lucide-react'
import type { Part, ToolCall } from '@/store/types'
import { Markdown } from '@/components/chat/Markdown'
import { Spinner } from '@/components/common/Spinner'
import { useT } from '@/i18n'
// NOTE: intentionally circular with ToolRow (Agent bodies render nested ToolRows, ToolRow
// renders AgentBody for Agent/Task tools). Both are function declarations only referenced
// from JSX, so the cycle resolves fine at module-eval time under Vite/ESM.
import { ToolRow } from '../ToolRow'

interface AgentStructured {
  isAsync?: boolean
  status?: string
}

function ThinkingLine({ part }: { part: Extract<Part, { type: 'thinking' }> }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const hasText = part.text.trim().length > 0
  // Same rule as the main reply: an empty, finished thinking block adds nothing.
  if (!hasText && !part.streaming) return null
  return (
    <div className="em-tool-agent-thinking">
      <button
        type="button"
        className="em-tool-agent-thinking-head"
        onClick={() => hasText && setOpen((o) => !o)}
        disabled={!hasText}
      >
        <Brain size={12} strokeWidth={1.75} />
        <span>{hasText ? t('tools.agent.thought') : t('tools.agent.thoughtEmpty', { n: part.tokens ?? 0 })}</span>
      </button>
      {open && hasText && <div className="em-tool-agent-thinking-text">{part.text}</div>}
    </div>
  )
}

function AgentPart({ part, chatId, depth }: { part: Part; chatId: string; depth: number }) {
  if (part.type === 'tool') return <ToolRow chatId={chatId} toolUseId={part.toolUseId} depth={depth + 1} />
  if (part.type === 'text') return part.text ? <Markdown text={part.text} variant="ui" className="em-tool-agent-text" /> : null
  if (part.type === 'thinking') return <ThinkingLine part={part} />
  return null
}

/** Body for Agent/Task subagent calls: recursively renders the subagent's own parts
 * (text / thinking / nested tool rows), plus a "running in background" indicator while
 * it hasn't finished yet (subagents default to async — SPEC §3.5). */
export function AgentBody({ tool, chatId, depth }: { tool: ToolCall; chatId: string; depth: number }) {
  const t = useT()
  const structured = tool.structured as AgentStructured | undefined
  const stillRunning = tool.status !== 'done' && tool.status !== 'error' && tool.status !== 'denied' && tool.status !== 'interrupted'

  return (
    <div className="em-tool-agent">
      {structured?.isAsync && stillRunning && (
        <div className="em-tool-agent-async">
          <Spinner size={12} />
          <span>{t('tools.agent.background')}</span>
          {tool.progress?.summary && <span className="em-tool-agent-summary"> · {tool.progress.summary}</span>}
        </div>
      )}
      {tool.children.length > 0 ? (
        <div className="em-tool-agent-children">
          {tool.children.map((part) => (
            <AgentPart key={part.id} part={part} chatId={chatId} depth={depth} />
          ))}
        </div>
      ) : (
        !structured?.isAsync && <div className="em-tool-empty">{t('tools.generic.empty')}</div>
      )}
    </div>
  )
}
