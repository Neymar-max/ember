/** Top title bar: rename-in-place chat title, project chip, open-in-terminal, context-usage ring (§4.1). */
import clsx from 'clsx'
import { Folder, Terminal } from 'lucide-react'
import { useState } from 'react'
import { useT } from '@/i18n'
import { ember } from '@/lib/api'
import { basename } from '@/lib/format'
import { useChats } from '@/store/chats'
import './Header.css'

export function Header({ chatId, sidebarCollapsed }: { chatId: string | null; sidebarCollapsed: boolean }) {
  const t = useT()
  // Narrowed to primitives (S9) instead of subscribing to the whole ChatState, so a streamed
  // token elsewhere in the chat doesn't re-render the header.
  const status = useChats((s) => (chatId ? s.chats[chatId]?.status : undefined))
  const chatTitle = useChats((s) => (chatId ? s.chats[chatId]?.title : undefined))
  const cwd = useChats((s) => (chatId ? s.chats[chatId]?.cwd : undefined))
  const sessionId = useChats((s) => (chatId ? s.chats[chatId]?.sessionId : undefined))
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState('')

  const title = status !== undefined && status !== 'new' ? chatTitle || t('shell.header.newChatTitle') : t('shell.header.newChatTitle')

  function startRename() {
    if (!chatId || status === undefined || status === 'new') return
    setDraft(chatTitle ?? '')
    setRenaming(true)
  }

  async function commitRename() {
    setRenaming(false)
    const next = draft.trim()
    if (!chatId || !next || next === chatTitle) return
    if (sessionId) await ember.history.rename(sessionId, next)
    useChats.getState().setTitle(chatId, next)
  }

  return (
    <div className={clsx('em-shell-header em-drag', sidebarCollapsed && 'em-shell-header--rail')}>
      <div className="em-shell-header__title">
        {renaming ? (
          <input
            className="em-shell-header__title-input"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void commitRename()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void commitRename()
              if (e.key === 'Escape') setRenaming(false)
            }}
          />
        ) : (
          <button type="button" className="em-shell-header__title-btn" title={t('shell.header.rename')} onClick={startRename}>
            {title}
          </button>
        )}
      </div>
      <div className="em-shell-header__right">
        {cwd && (
          <>
            <button type="button" className="em-shell-header__chip" title={cwd} onClick={() => void ember.sys.showInFinder(cwd)}>
              <Folder size={13} strokeWidth={1.75} />
              <span>{basename(cwd)}</span>
            </button>
            <button
              type="button"
              className="em-shell-header__chip"
              title={t('shell.header.openInTerminal')}
              onClick={() => void ember.sys.openInTerminal(cwd, sessionId ? `claude --resume ${sessionId}` : 'claude')}
            >
              <Terminal size={13} strokeWidth={1.75} />
              <span>{t('shell.header.openInTerminal')}</span>
            </button>
          </>
        )}
      </div>
    </div>
  )
}
