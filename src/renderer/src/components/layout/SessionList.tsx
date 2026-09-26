/** Grouped, searchable conversation list — the sidebar's main content (§4.5). */
import clsx from 'clsx'
import { Copy, FolderOpen, MoreHorizontal, Pencil, Terminal, Trash2 } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { ConfirmDialog } from '@/components/common/Dialog'
import { MenuItem, MenuSeparator, Popover } from '@/components/common/Popover'
import { useT } from '@/i18n'
import { ember } from '@/lib/api'
import { dateBucket, type DateBucket } from '@/lib/format'
import type { ChatRow } from './rows'
import './SessionList.css'

const BUCKET_ORDER: DateBucket[] = ['today', 'yesterday', 'previous7', 'previous30', 'older']
const BUCKET_KEY: Record<DateBucket, string> = {
  today: 'common.today',
  yesterday: 'common.yesterday',
  previous7: 'common.previous7',
  previous30: 'common.previous30',
  older: 'common.older',
}

function RowMenu({ row, onRename, onDelete }: { row: ChatRow; onRename: () => void; onDelete: () => void }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const anchorRef = useRef<HTMLButtonElement>(null)
  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        aria-label={t('common.moreActions')}
        title={t('common.moreActions')}
        className={clsx('em-ui-iconbtn em-ui-iconbtn--sm em-shell-row__more', open && 'is-open is-active')}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
        }}
      >
        <MoreHorizontal size={15} strokeWidth={1.75} />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchorRef} placement="bottom-end" width={210}>
        <MenuItem
          icon={<Pencil size={14} strokeWidth={1.75} />}
          label={t('shell.sidebar.menu.rename')}
          onSelect={() => {
            setOpen(false)
            onRename()
          }}
        />
        {row.cwd && (
          <MenuItem
            icon={<FolderOpen size={14} strokeWidth={1.75} />}
            label={t('shell.sidebar.menu.showInFinder')}
            onSelect={() => {
              setOpen(false)
              void ember.sys.showInFinder(row.cwd!)
            }}
          />
        )}
        {row.sessionId && (
          <MenuItem
            icon={<Terminal size={14} strokeWidth={1.75} />}
            label={t('shell.sidebar.menu.openInTerminal')}
            onSelect={() => {
              setOpen(false)
              void ember.sys.openInTerminal(row.cwd || '~', `claude --resume ${row.sessionId}`)
            }}
          />
        )}
        {row.sessionId && (
          <MenuItem
            icon={<Copy size={14} strokeWidth={1.75} />}
            label={copied ? t('common.copied') : t('shell.sidebar.menu.copyId')}
            onSelect={() => {
              void navigator.clipboard.writeText(row.sessionId!)
              setCopied(true)
              setTimeout(() => setCopied(false), 1200)
            }}
          />
        )}
        <MenuSeparator />
        <MenuItem
          danger
          icon={<Trash2 size={14} strokeWidth={1.75} />}
          label={t('shell.sidebar.menu.delete')}
          onSelect={() => {
            setOpen(false)
            onDelete()
          }}
        />
      </Popover>
    </>
  )
}

function Row({
  row,
  active,
  onOpen,
  onCommitRename,
  onDelete,
}: {
  row: ChatRow
  active: boolean
  onOpen: () => void
  onCommitRename: (title: string) => void
  onDelete: () => void
}) {
  const t = useT()
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(row.title)
  const [confirmDelete, setConfirmDelete] = useState(false)

  function commit() {
    const title = draft.trim()
    setRenaming(false)
    if (title && title !== row.title) onCommitRename(title)
    else setDraft(row.title)
  }

  return (
    <div className={clsx('em-shell-row', active && 'is-active')} onClick={renaming ? undefined : onOpen} role="button" tabIndex={0}>
      {row.isRunning && <span className="em-shell-row__dot" />}
      {renaming ? (
        <input
          className="em-shell-row__title-input"
          autoFocus
          value={draft}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') {
              setDraft(row.title)
              setRenaming(false)
            }
          }}
        />
      ) : (
        <span className="em-shell-row__title">{row.title}</span>
      )}
      {row.pendingCount > 0 && <span className="em-shell-row__badge">{t('shell.sidebar.needsConfirm')}</span>}
      {!renaming && (
        <RowMenu
          row={row}
          onRename={() => {
            setDraft(row.title)
            setRenaming(true)
          }}
          onDelete={() => setConfirmDelete(true)}
        />
      )}
      <ConfirmDialog
        open={confirmDelete}
        title={t('shell.sidebar.deleteTitle')}
        description={t('shell.sidebar.deleteBody', { title: row.title })}
        confirmLabel={t('common.delete')}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false)
          onDelete()
        }}
      />
    </div>
  )
}

export interface SessionListProps {
  rows: ChatRow[]
  activeChatId: string | null
  emptyLabel?: string
  onOpen: (row: ChatRow) => void
  onRename: (row: ChatRow, title: string) => void
  onDelete: (row: ChatRow) => void
  /** true when `rows` is a truncated page of a larger, already-filtered/searched result (§4.5, 1000+ sessions). */
  hasMore?: boolean
  onShowMore?: () => void
}

export function SessionList({ rows, activeChatId, emptyLabel, onOpen, onRename, onDelete, hasMore, onShowMore }: SessionListProps) {
  const t = useT()
  const now = useMemo(() => new Date(), [])

  const groups = useMemo(() => {
    const byBucket = new Map<DateBucket, ChatRow[]>()
    for (const row of rows) {
      const bucket: DateBucket = row.isNew ? 'today' : dateBucket(row.lastModified, now)
      const list = byBucket.get(bucket) ?? []
      list.push(row)
      byBucket.set(bucket, list)
    }
    for (const list of byBucket.values()) {
      list.sort((a, b) => (b.isNew ? 1 : 0) - (a.isNew ? 1 : 0) || b.lastModified - a.lastModified)
    }
    return BUCKET_ORDER.filter((b) => byBucket.has(b)).map((b) => ({ bucket: b, rows: byBucket.get(b)! }))
  }, [rows, now])

  if (rows.length === 0) {
    return <div className="em-shell-sessions__empty">{emptyLabel ?? t('shell.sidebar.noResults')}</div>
  }

  return (
    <div className="em-shell-sessions">
      {groups.map((g) => (
        <div key={g.bucket} className="em-shell-group">
          <div className="em-shell-group__title">{t(BUCKET_KEY[g.bucket])}</div>
          {g.rows.map((row) => (
            <Row
              key={row.key}
              row={row}
              active={row.chatId === activeChatId}
              onOpen={() => onOpen(row)}
              onCommitRename={(title) => onRename(row, title)}
              onDelete={() => onDelete(row)}
            />
          ))}
        </div>
      ))}
      {hasMore && (
        <button type="button" className="em-shell-showmore" onClick={onShowMore}>
          {t('shell.sidebar.showMore')}
        </button>
      )}
    </div>
  )
}
