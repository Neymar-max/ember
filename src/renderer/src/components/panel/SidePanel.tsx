/** Right-hand panel, Claude-app style: live status of subagents / workflows / background commands,
 * the files this chat touched (plus anything else that changed in the folder), and a file preview. */
import clsx from 'clsx'
import { Bot, CheckCircle2, ChevronRight, FileText, MinusCircle, Terminal, Workflow, X, XCircle } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Spinner } from '@/components/common/Spinner'
import { ToolRow } from '@/components/tools/ToolRow'
import { editLineChangeCount } from '@/components/tools/toolDisplay'
import { useT } from '@/i18n'
import { ember } from '@/lib/api'
import { basename, dirname, displayPath, formatTokens } from '@/lib/format'
import { buildTaskRows, changedFiles, type TaskRowModel } from '@/lib/tasks'
import { formatElapsed } from '@/components/chat/RunningIndicator'
import { useChat, useChats } from '@/store/chats'
import { usePanel } from '@/store/panel'
import type { RecentFile } from '@shared/types'
import { FilePreviewPane } from './FilePreviewPane'
import './SidePanel.css'

/** Re-render every second while something is running (for live elapsed times). */
function useTicker(active: boolean): void {
  const [, bump] = useState(0)
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => bump((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [active])
}

export function useTaskRows(chatId: string | null): TaskRowModel[] {
  const tools = useChats((s) => (chatId ? s.chats[chatId]?.tools : undefined))
  const bg = useChats((s) => (chatId ? s.chats[chatId]?.backgroundTasks : undefined))
  return useMemo(() => (tools ? buildTaskRows(tools, bg ?? []) : []), [tools, bg])
}

function StatusIcon({ status }: { status: TaskRowModel['status'] }) {
  if (status === 'running') return <Spinner size={13} className="em-panel-task__spin" />
  if (status === 'done') return <CheckCircle2 size={14} strokeWidth={1.9} className="em-panel-task__ok" />
  if (status === 'failed') return <XCircle size={14} strokeWidth={1.9} className="em-panel-task__bad" />
  return <MinusCircle size={14} strokeWidth={1.9} className="em-panel-task__muted" />
}

const KIND_ICON = { agent: Bot, workflow: Workflow, shell: Terminal, other: Bot }

function TaskRow({ chatId, row }: { chatId: string; row: TaskRowModel }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const tool = useChats((s) => (row.toolUseId ? s.chats[chatId]?.tools[row.toolUseId] : undefined))
  const children = (tool?.children ?? []).filter((p) => p.type === 'tool')
  const Icon = KIND_ICON[row.kind]
  const end = row.status === 'running' ? Date.now() : row.endedAt
  const elapsed = row.startedAt && end ? Math.max(0, Math.round((end - row.startedAt) / 1000)) : undefined
  const meta = [
    t(`shell.panel.kind.${row.kind}`) + (row.detail ? ` · ${row.detail}` : ''),
    elapsed != null ? formatElapsed(elapsed) : null,
    row.toolUses ? t('shell.panel.toolUses', { n: row.toolUses }) : null,
    row.tokens ? `${formatTokens(row.tokens)} tokens` : null,
  ].filter(Boolean)

  return (
    <div className={clsx('em-panel-task', `is-${row.status}`, open && 'is-open')}>
      <button type="button" className="em-panel-task__head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <StatusIcon status={row.status} />
        <span className="em-panel-task__main">
          <span className="em-panel-task__title">
            <Icon size={13} strokeWidth={1.75} className="em-panel-task__kind" />
            {row.title}
          </span>
          <span className="em-panel-task__meta">{meta.join(' · ')}</span>
          {row.activity && <span className="em-panel-task__activity">{row.activity.replace(/[*_`#>]+/g, '').trim()}</span>}
        </span>
        {children.length > 0 && <ChevronRight size={14} strokeWidth={1.75} className="em-panel-task__chev" />}
      </button>
      {open && children.length > 0 && (
        <div className="em-panel-task__steps">
          {children.length > 30 && <div className="em-panel-hint">{t('shell.panel.earlierSteps', { n: children.length - 30 })}</div>}
          {children.slice(-30).map((p) => (p.type === 'tool' ? <ToolRow key={p.id} chatId={chatId} toolUseId={p.toolUseId} /> : null))}
        </div>
      )}
    </div>
  )
}

function TasksTab({ chatId }: { chatId: string }) {
  const t = useT()
  const rows = useTaskRows(chatId)
  useTicker(rows.some((r) => r.status === 'running'))
  if (rows.length === 0) return <div className="em-panel-empty">{t('shell.panel.noTasks')}</div>
  return (
    <div className="em-panel-list">
      {rows.map((r) => (
        <TaskRow key={r.id} chatId={chatId} row={r} />
      ))}
    </div>
  )
}

function FileRow({ path, cwd, badge, extra, onOpen }: { path: string; cwd?: string; badge?: string; extra?: React.ReactNode; onOpen: () => void }) {
  const dir = dirname(displayPath(path, cwd))
  return (
    <button type="button" className="em-panel-file" onClick={onOpen} title={path}>
      <FileText size={14} strokeWidth={1.75} className="em-panel-file__icon" />
      <span className="em-panel-file__main">
        <span className="em-panel-file__name">
          {basename(path)}
          {badge && <span className="em-panel-file__badge">{badge}</span>}
        </span>
        {dir && dir !== '.' && dir !== '/' && <span className="em-panel-file__dir">{dir}</span>}
      </span>
      {extra}
    </button>
  )
}

function FilesTab({ chatId }: { chatId: string }) {
  const t = useT()
  const chat = useChat(chatId)
  const openFile = usePanel((s) => s.openFile)
  const [recent, setRecent] = useState<RecentFile[] | null>(null)
  const changed = useMemo(() => (chat ? changedFiles(chat.tools, editLineChangeCount) : []), [chat?.tools])
  const cwd = chat?.cwd
  const status = chat?.status
  // Folder changes since this chat began (catches files made by shell commands, scripts, subagents…).
  const since = useMemo(() => {
    const first = chat?.items.find((it) => it.kind === 'user' && it.timestamp)
    return first && first.kind === 'user' && first.timestamp ? first.timestamp - 60_000 : Date.now() - 3600_000
  }, [chat?.items])

  useEffect(() => {
    if (!cwd || status === 'running') return
    let alive = true
    void ember.files.recent(cwd, since).then((r) => alive && setRecent(r))
    return () => {
      alive = false
    }
  }, [cwd, since, status])

  const changedSet = new Set(changed.map((f) => f.path))
  const others = (recent ?? []).filter((f) => !changedSet.has(f.path))

  if (!chat) return null
  return (
    <div className="em-panel-list">
      <div className="em-panel-section">{t('shell.panel.changedByClaude')}</div>
      {changed.length === 0 && <div className="em-panel-hint">{t('shell.panel.noChanged')}</div>}
      {changed.map((f) => (
        <FileRow
          key={f.path}
          path={f.path}
          cwd={cwd}
          badge={f.created ? t('shell.panel.new') : undefined}
          onOpen={() => openFile(f.path)}
          extra={
            <span className="em-panel-file__diff">
              <span className="is-add">+{f.add}</span>
              <span className="is-del">-{f.del}</span>
            </span>
          }
        />
      ))}
      <div className="em-panel-section">{t('shell.panel.changedInFolder')}</div>
      {recent === null ? (
        <div className="em-panel-hint">{t('shell.panel.scanning')}</div>
      ) : others.length === 0 ? (
        <div className="em-panel-hint">{t('shell.panel.noOthers')}</div>
      ) : (
        others.slice(0, 100).map((f) => <FileRow key={f.path} path={f.path} cwd={cwd} onOpen={() => openFile(f.path)} />)
      )}
    </div>
  )
}

export function SidePanel({ chatId }: { chatId: string }) {
  const t = useT()
  const { tab, preview, setTab, setOpen } = usePanel()
  const rows = useTaskRows(chatId)
  const running = rows.filter((r) => r.status === 'running').length
  const cwd = useChats((s) => s.chats[chatId]?.cwd)

  return (
    <aside className="em-panel" aria-label={t('shell.panel.title')}>
      <div className="em-panel__bar">
        <div className="em-panel__tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'tasks'} className={clsx('em-panel__tab', tab === 'tasks' && 'is-active')} onClick={() => setTab('tasks')}>
            {t('shell.panel.tasks')}
            {running > 0 && <span className="em-panel__count">{running}</span>}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'files'} className={clsx('em-panel__tab', tab === 'files' && 'is-active')} onClick={() => setTab('files')}>
            {t('shell.panel.files')}
          </button>
        </div>
        <button type="button" className="em-panel__close" aria-label={t('shell.panel.close')} title={t('shell.panel.close')} onClick={() => setOpen(false)}>
          <X size={15} strokeWidth={1.75} />
        </button>
      </div>
      <div className="em-panel__body">
        {tab === 'files' && preview ? <FilePreviewPane path={preview} cwd={cwd} /> : tab === 'tasks' ? <TasksTab chatId={chatId} /> : <FilesTab chatId={chatId} />}
      </div>
    </aside>
  )
}
