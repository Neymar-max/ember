/** Left rail: brand, new-chat, search, project filter, conversation list, account card (§4.5). */
import { ChevronDown, Folder, PanelLeftClose, Plus, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { IconButton } from '@/components/common/Button'
import { MenuItem, MenuSeparator, Popover } from '@/components/common/Popover'
import { EmberMark } from '@/components/common/Spinner'
import { useT } from '@/i18n'
import { ember } from '@/lib/api'
import { basename, dirname, tildify } from '@/lib/format'
import { useApp } from '@/store/app'
import { useChats } from '@/store/chats'
import { AccountCard } from './AccountCard'
import { buildRows, type ChatRow } from './rows'
import { SessionList } from './SessionList'
import './Sidebar.css'

/** How many rows to render at once — search/filter still run over the full set (§4.5, S10). */
const PAGE_SIZE = 150

export function Sidebar() {
  const t = useT()
  const settings = useApp((s) => s.settings)
  const sessions = useApp((s) => s.sessions)
  const searchQuery = useApp((s) => s.searchQuery)
  const setSearchQuery = useApp((s) => s.setSearchQuery)
  const projectFilter = useApp((s) => s.projectFilter)
  const setProjectFilter = useApp((s) => s.setProjectFilter)
  const homeDir = useApp((s) => s.appInfo?.homeDir)
  // A raw `s.chats` subscription re-renders the sidebar on every streamed token (any chat
  // mutation, not just the title/status/pending fields a row shows). Subscribe to a signature
  // string built from just those primitives instead, and only re-derive `rows` when it changes.
  const chatsSignature = useChats((s) => {
    const list = Object.values(s.chats)
    list.sort((a, b) => a.chatId.localeCompare(b.chatId))
    // lastActivity changes on every streamed delta — bucket it (30s) so ordering stays fresh without
    // re-rendering the whole list each frame.
    return list
      .map((c) => `${c.chatId}:${c.sessionId ?? ''}:${c.title}:${c.status}:${c.pendingPermissions.length}:${c.cwd}:${c.items.length === 0}:${Math.floor(c.lastActivity / 30000)}`)
      .join('|')
  })
  const activeChatId = useChats((s) => s.activeChatId)

  const searchRef = useRef<HTMLInputElement>(null)
  const filterAnchor = useRef<HTMLButtonElement>(null)
  const [filterOpen, setFilterOpen] = useState(false)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  useEffect(() => {
    const onFocusSearch = () => searchRef.current?.focus()
    document.addEventListener('ember:focus-search', onFocusSearch)
    return () => document.removeEventListener('ember:focus-search', onFocusSearch)
  }, [])

  const rows = useMemo(
    // eslint-disable-next-line react-hooks/exhaustive-deps
    () => buildRows(useChats.getState().chats, sessions, t('shell.sidebar.untitled'), activeChatId),
    [chatsSignature, sessions, t, activeChatId],
  )

  const projectOptions = useMemo(() => {
    const lastUsed = new Map<string, number>()
    for (const r of rows) if (r.cwd) lastUsed.set(r.cwd, Math.max(lastUsed.get(r.cwd) ?? 0, r.lastModified))
    return [...lastUsed.entries()].sort((a, b) => b[1] - a[1]).map(([cwd]) => cwd)
  }, [rows])

  // Search/filter run over every row; only rendering is paged.
  const filtered = useMemo(() => {
    let list = rows
    if (projectFilter) list = list.filter((r) => r.cwd === projectFilter)
    const q = searchQuery.trim().toLowerCase()
    if (q) list = list.filter((r) => r.title.toLowerCase().includes(q) || r.cwd?.toLowerCase().includes(q))
    return [...list].sort((a, b) => b.lastModified - a.lastModified)
  }, [rows, projectFilter, searchQuery])

  // A narrower result shouldn't start scrolled past its own end.
  useEffect(() => setVisibleCount(PAGE_SIZE), [projectFilter, searchQuery])

  const visibleRows = filtered.slice(0, visibleCount)

  function handleOpen(row: ChatRow) {
    if (row.chatId) useChats.getState().setActive(row.chatId)
    else if (row.summary) void useChats.getState().openHistory(row.summary)
  }

  async function handleRename(row: ChatRow, title: string) {
    if (row.sessionId) await ember.history.rename(row.sessionId, title)
    const id = row.chatId ?? row.sessionId
    if (id) useChats.getState().setTitle(id, title)
  }

  async function handleDelete(row: ChatRow) {
    if (row.chatId) await useChats.getState().closeChat(row.chatId)
    if (row.sessionId) await ember.history.delete(row.sessionId)
    const id = row.chatId ?? row.sessionId
    if (id) useChats.getState().forgetChat(id)
    void useApp.getState().refreshSessions()
  }

  return (
    <aside className="em-shell-sidebar">
      <div className="em-shell-sidebar__topbar em-drag">
        <IconButton label={t('shell.sidebar.collapse')} onClick={() => void useApp.getState().updateSettings({ sidebarCollapsed: true })}>
          <PanelLeftClose size={16} strokeWidth={1.75} />
        </IconButton>
      </div>

      <div className="em-shell-sidebar__brand">
        <EmberMark size={20} />
        <span>Ember</span>
      </div>

      <div className="em-shell-sidebar__section">
        <button
          type="button"
          className="em-shell-newchat"
          onClick={() => {
            const cwd = settings.lastProject || homeDir || ''
            if (cwd) useChats.getState().newChat(cwd)
          }}
        >
          <span className="em-shell-newchat__icon">
            <Plus size={13} strokeWidth={2.25} />
          </span>
          <span className="em-shell-newchat__label">{t('shell.sidebar.newChat')}</span>
          <span className="em-shell-newchat__hint">⌘N</span>
        </button>

        <label className="em-shell-search">
          <Search size={14} strokeWidth={1.75} />
          <input
            ref={searchRef}
            className="em-selectable"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('shell.sidebar.search')}
          />
        </label>

        {projectOptions.length > 1 && (
          <>
            <button ref={filterAnchor} type="button" className="em-shell-filter-chip" onClick={() => setFilterOpen((o) => !o)}>
              <span>{projectFilter ? basename(projectFilter) : t('shell.sidebar.allProjects')}</span>
              <ChevronDown size={11} strokeWidth={1.75} />
            </button>
            <Popover open={filterOpen} onClose={() => setFilterOpen(false)} anchorRef={filterAnchor} width={240}>
              <MenuItem label={t('shell.sidebar.allProjects')} active={!projectFilter} onSelect={() => { setProjectFilter(null); setFilterOpen(false) }} />
              <MenuSeparator />
              {projectOptions.map((cwd) => (
                <MenuItem
                  key={cwd}
                  icon={<Folder size={14} strokeWidth={1.75} />}
                  label={basename(cwd)}
                  description={tildify(dirname(cwd), homeDir)}
                  active={cwd === projectFilter}
                  onSelect={() => {
                    setProjectFilter(cwd)
                    setFilterOpen(false)
                  }}
                />
              ))}
            </Popover>
          </>
        )}
      </div>

      <SessionList
        rows={visibleRows}
        activeChatId={activeChatId}
        emptyLabel={searchQuery || projectFilter ? t('shell.sidebar.noResults') : undefined}
        onOpen={handleOpen}
        onRename={(row, title) => void handleRename(row, title)}
        onDelete={(row) => void handleDelete(row)}
        hasMore={filtered.length > visibleRows.length}
        onShowMore={() => setVisibleCount((n) => n + PAGE_SIZE)}
      />

      <AccountCard />
    </aside>
  )
}
