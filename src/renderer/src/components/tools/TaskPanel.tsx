import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { Check, ChevronDown, ChevronUp } from 'lucide-react'
import { useChat } from '@/store/chats'
import type { TodoItem } from '@/store/types'
import { useT } from '@/i18n'
import { Spinner } from '@/components/common/Spinner'
import './TaskPanel.css'

function StatusDot({ status }: { status: TodoItem['status'] }) {
  if (status === 'completed') return <Check size={12} strokeWidth={2.5} />
  if (status === 'in_progress') return <Spinner size={11} />
  return <span className="em-tool-taskpanel-dot-empty" />
}

/** Compact todo/task progress panel docked above the composer (SPEC 4.3). Auto-collapses to
 * a one-line "✓ all N done" 5s after the last item completes; returns null with no todos. */
export function TaskPanel({ chatId }: { chatId: string }) {
  const t = useT()
  const chat = useChat(chatId)
  const todos = chat?.todos ?? []
  const [listOpen, setListOpen] = useState(true)
  const [autoCollapsed, setAutoCollapsed] = useState(false)

  const total = todos.length
  const done = todos.filter((x) => x.status === 'completed').length
  const allDone = total > 0 && done === total

  useEffect(() => {
    if (!allDone) {
      setAutoCollapsed(false)
      return
    }
    const timer = setTimeout(() => setAutoCollapsed(true), 5000)
    return () => clearTimeout(timer)
  }, [allDone, total, done])

  if (total === 0) return null

  if (autoCollapsed) {
    return (
      <button type="button" className="em-tool-taskpanel em-tool-taskpanel--collapsed" onClick={() => setAutoCollapsed(false)}>
        <Check size={13} strokeWidth={2.5} />
        <span>{t('tools.tasks.allDone', { n: total })}</span>
      </button>
    )
  }

  return (
    <div className="em-tool-taskpanel">
      <button type="button" className="em-tool-taskpanel-head" onClick={() => setListOpen((o) => !o)} aria-expanded={listOpen}>
        <span className="em-tool-taskpanel-title">{t('tools.tasks.title', { done, total })}</span>
        <span className="em-tool-taskpanel-bar">
          <span className="em-tool-taskpanel-bar-fill" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
        </span>
        {listOpen ? <ChevronUp size={14} strokeWidth={1.75} /> : <ChevronDown size={14} strokeWidth={1.75} />}
      </button>
      {listOpen && (
        <ul className="em-tool-taskpanel-list">
          {todos.map((td) => (
            <li key={td.id} className={clsx('em-tool-taskpanel-item', `is-${td.status}`)}>
              <span className="em-tool-taskpanel-dot">
                <StatusDot status={td.status} />
              </span>
              <span className="em-tool-taskpanel-text">{td.status === 'in_progress' ? td.activeForm || td.content : td.content}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
