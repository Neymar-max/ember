import { useState } from 'react'
import clsx from 'clsx'
import { ChevronRight, Clock, XCircle } from 'lucide-react'
import { useChats } from '@/store/chats'
import type { ToolCall } from '@/store/types'
import { useT } from '@/i18n'
import { Spinner } from '@/components/common/Spinner'
import { formatDuration } from '@/lib/format'
import { describeTool, editLineChangeCount } from './toolDisplay'
import { PlanResultCard } from './bodies/PlanResultCard'
import { BashBody } from './bodies/BashBody'
import { ReadBody } from './bodies/ReadBody'
import { EditBody } from './bodies/EditBody'
import { WriteBody } from './bodies/WriteBody'
import { GrepBody, GlobBody, WebSearchBody, WebFetchBody } from './bodies/SearchBody'
import { AgentBody } from './bodies/AgentBody'
import { AskUserQuestionBody } from './bodies/AskUserQuestionBody'
import { GenericBody } from './bodies/GenericBody'
import './ToolRow.css'

function defaultExpanded(tool: ToolCall): boolean {
  // "Edit rows default to expanded when the change is small" — SPEC 4.3
  if (tool.name !== 'Edit') return false
  const { add, del } = editLineChangeCount(tool)
  const changed = add + del
  return changed > 0 && changed <= 40
}

function ToolStatusBadge({ tool }: { tool: ToolCall }) {
  const t = useT()
  switch (tool.status) {
    case 'streaming':
    case 'pending':
    case 'running':
      return (
        <span className="em-tool-status em-tool-status--running">
          <Spinner size={12} />
          {tool.progress?.elapsedSeconds != null && <span>{Math.round(tool.progress.elapsedSeconds)}s</span>}
        </span>
      )
    case 'waiting-permission':
      return (
        <span className="em-tool-status em-tool-status--waiting">
          <Clock size={12} strokeWidth={1.75} />
          {t('tools.status.waiting')}
        </span>
      )
    case 'done': {
      if (tool.startedAt == null || tool.endedAt == null) return null
      const dur = tool.endedAt - tool.startedAt
      return dur > 0 ? <span className="em-tool-status em-tool-status--done">{formatDuration(dur)}</span> : null
    }
    case 'error':
      return (
        <span className="em-tool-status em-tool-status--error">
          <XCircle size={13} strokeWidth={1.75} />
        </span>
      )
    case 'denied':
      return <span className="em-tool-status em-tool-status--denied">{t('tools.status.denied')}</span>
    case 'interrupted':
      return <span className="em-tool-status em-tool-status--denied">{t('tools.status.interrupted')}</span>
    default:
      return null
  }
}

function ToolBody({ tool, chatId, cwd, depth }: { tool: ToolCall; chatId: string; cwd?: string; depth: number }) {
  switch (tool.name) {
    case 'Bash':
      return <BashBody tool={tool} />
    case 'Read':
      return <ReadBody tool={tool} />
    case 'Edit':
    case 'MultiEdit':
      return <EditBody tool={tool} cwd={cwd} />
    case 'Write':
      return <WriteBody tool={tool} cwd={cwd} />
    case 'Grep':
      return <GrepBody tool={tool} />
    case 'Glob':
      return <GlobBody tool={tool} />
    case 'WebSearch':
      return <WebSearchBody tool={tool} />
    case 'WebFetch':
      return <WebFetchBody tool={tool} />
    case 'Agent':
    case 'Task':
      return <AgentBody tool={tool} chatId={chatId} depth={depth} />
    case 'AskUserQuestion':
      return <AskUserQuestionBody tool={tool} />
    default:
      return <GenericBody tool={tool} />
  }
}

/** One collapsible tool-call row inside an assistant response (SPEC 4.3). Also used
 * recursively (depth+1) for subagent children rendered by AgentBody. */
export function ToolRow({ chatId, toolUseId, depth = 0 }: { chatId: string; toolUseId: string; depth?: number }) {
  // Narrow selectors: a streaming delta elsewhere in the chat must not re-render every tool row.
  const tool = useChats((s) => s.chats[chatId]?.tools[toolUseId])
  const cwd = useChats((s) => s.chats[chatId]?.cwd)
  // null = follow the default (which can change once the structured patch arrives); boolean = user choice
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null)
  const expanded = userExpanded ?? (tool ? defaultExpanded(tool) : false)

  // Defensive: a tool part can reference an id we never saw a matching tool_use for
  // (e.g. a truncated/odd history entry) — render nothing rather than crash.
  if (!tool) return null

  const line = describeTool(tool, cwd)
  const indent = depth * 18

  if (line.kind === 'plan') {
    return <PlanResultCard tool={tool} />
  }

  if (line.kind === 'minimal') {
    const MinimalIcon = line.Icon
    return (
      <div className="em-tool-minimal" style={{ marginLeft: indent }}>
        <MinimalIcon size={13} strokeWidth={1.75} />
        <span>{line.verb}</span>
      </div>
    )
  }

  const RowIcon = line.Icon
  return (
    <div className="em-tool-wrap" style={{ marginLeft: indent }}>
      <button
        type="button"
        className={clsx('em-tool-row', expanded && 'is-expanded')}
        onClick={() => setUserExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <RowIcon size={15} strokeWidth={1.75} className="em-tool-icon" />
        <span className="em-tool-verb">{line.verb}</span>
        {line.target && <span className={clsx('em-tool-target', line.mono && 'em-tool-target--mono')}>{line.target}</span>}
        {line.extra && <span className="em-tool-extra">{line.extra}</span>}
        <span className="em-tool-spacer" />
        <ToolStatusBadge tool={tool} />
        <ChevronRight size={14} strokeWidth={1.75} className="em-tool-chevron" />
      </button>
      {expanded && (
        <div className="em-tool-body">
          <ToolBody tool={tool} chatId={chatId} cwd={cwd} depth={depth} />
        </div>
      )}
    </div>
  )
}
