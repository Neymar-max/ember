/**
 * Root layout (OWNER: app-shell work package).
 * Wires IPC subscriptions once, applies theme/font/lang to <html>, and routes between
 * SetupScreen (CLI not ready) and the main Sidebar + Header + ChatView + dock layout.
 */
import { PanelLeftOpen } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { IconButton } from '@/components/common/Button'
import { InteractionDock } from '@/components/interactive/InteractionDock'
import { Composer } from '@/components/composer/Composer'
import { EmptyState } from '@/components/layout/EmptyState'
import { Header } from '@/components/layout/Header'
import { Sidebar } from '@/components/layout/Sidebar'
import { SettingsDialog } from '@/components/settings/SettingsDialog'
import { SetupScreen } from '@/components/setup/SetupScreen'
import { ChatView } from '@/components/chat/ChatView'
import { SidePanel } from '@/components/panel/SidePanel'
import { usePanel } from '@/store/panel'
import { TaskPanel } from '@/components/tools/TaskPanel'
import { resolveLang, useLang, useT } from '@/i18n'
import { ember } from '@/lib/api'
import { setHomeDir } from '@/lib/format'
import { useApp } from '@/store/app'
import { useChats } from '@/store/chats'
import type { MenuCommand } from '@shared/types'
import './App.css'

/** Menu / notification commands never touch React state directly — they act on store singletons
 * so the handler stays stable across renders and can run before the store's own effects mount. */
function handleMenuCommand(cmd: MenuCommand) {
  const app = useApp.getState()
  const chats = useChats.getState()
  switch (cmd) {
    case 'new-chat': {
      const cwd = app.settings.lastProject || app.appInfo?.homeDir || ''
      if (cwd) chats.newChat(cwd)
      break
    }
    case 'open-settings':
      app.setSettingsOpen(true)
      break
    case 'toggle-sidebar':
      void app.updateSettings({ sidebarCollapsed: !app.settings.sidebarCollapsed })
      break
    case 'focus-search':
      document.dispatchEvent(new CustomEvent('ember:focus-search'))
      break
    case 'focus-composer':
      document.dispatchEvent(new CustomEvent('ember:focus-composer'))
      break
    case 'interrupt':
      if (chats.activeChatId) void chats.interrupt(chats.activeChatId)
      break
    case 'open-project':
      void (async () => {
        const dir = await ember.sys.pickDirectory()
        if (!dir) return
        await app.touchProject(dir)
        chats.newChat(dir)
      })()
      break
  }
}

export function App() {
  const t = useT()
  const env = useApp((s) => s.env)
  const settings = useApp((s) => s.settings)
  const panelOpen = usePanel((s) => s.open)
  const appInfo = useApp((s) => s.appInfo)
  useEffect(() => setHomeDir(appInfo?.homeDir), [appInfo?.homeDir])
  const settingsOpen = useApp((s) => s.settingsOpen)
  const setSettingsOpen = useApp((s) => s.setSettingsOpen)
  const activeChatId = useChats((s) => s.activeChatId)
  // Narrowed to a primitive: subscribing to the whole ChatState would re-render the shell on
  // every streamed token, not just when a chat starts existing / leaves 'new' (S9).
  const activeChatStatus = useChats((s) => (activeChatId ? s.chats[activeChatId]?.status : undefined))
  const mounted = useRef(false)

  // ── one-time IPC wiring ──────────────────────────────────────────────
  useEffect(() => {
    if (mounted.current) return
    mounted.current = true

    // Subscribe before init() resolves so nothing emitted during startup (e.g. a live session
    // that survived a reload) is missed.
    const offEvent = ember.session.onEvent((e) => useChats.getState().ingest(e))
    void ember.session.pending().then((reqs) => {
      for (const r of reqs) useChats.getState().ingest({ chatId: r.chatId, kind: 'permission', request: r })
    })
    // Reattach to any live CLI process that survived a reload (chat-engine's own responsibility;
    // typed loosely + optional-chained so this compiles and no-ops before that store method lands).
    void useChats.getState().restoreLive()

    void useApp.getState().init()

    const offMenu = ember.sys.onMenuCommand(handleMenuCommand)
    const offNotif = ember.sys.onNotificationClicked((chatId) => useChats.getState().setActive(chatId))
    return () => {
      offEvent()
      offMenu()
      offNotif()
    }
  }, [])

  // ── theme / font / language application (§4.9) ───────────────────────
  useEffect(() => {
    const root = document.documentElement
    if (settings.theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      const apply = () => root.setAttribute('data-theme', mq.matches ? 'dark' : 'light')
      apply()
      mq.addEventListener('change', apply)
      return () => mq.removeEventListener('change', apply)
    }
    root.setAttribute('data-theme', settings.theme)
    return undefined
  }, [settings.theme])

  useEffect(() => {
    document.documentElement.setAttribute('data-msgfont', settings.messageFont)
  }, [settings.messageFont])

  useEffect(() => {
    document.documentElement.style.setProperty('--msg-font-size', `${settings.fontSize}px`)
  }, [settings.fontSize])

  useEffect(() => {
    useLang.getState().setLang(resolveLang(settings.language))
  }, [settings.language])

  // ── make sure there is always a chat to type into once the CLI is ready ──
  useEffect(() => {
    if (env?.state !== 'ready') return
    const chats = useChats.getState()
    if (chats.activeChatId || Object.keys(chats.chats).length > 0) return
    const cwd = settings.lastProject || appInfo?.homeDir
    if (cwd) chats.newChat(cwd)
  }, [env?.state, settings.lastProject, appInfo?.homeDir])

  // ── Esc = interrupt the running turn, unless a permission card owns Esc right now ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const id = useChats.getState().activeChatId
      if (!id) return
      const c = useChats.getState().chats[id]
      if (!c) return
      if (c.pendingPermissions.length > 0) return // InteractionDock handles Esc while a card is showing
      if (c.status === 'running' || c.status === 'starting') void useChats.getState().interrupt(id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!env || env.state !== 'ready') {
    return <SetupScreen env={env} />
  }

  const sidebarCollapsed = settings.sidebarCollapsed
  const showChat = activeChatStatus !== undefined && activeChatStatus !== 'new'

  return (
    <div className="em-app">
      {!sidebarCollapsed && <Sidebar />}
      <main className="em-app-main">
        {sidebarCollapsed && (
          <div className="em-app-collapsed-rail">
            <IconButton label={t('shell.sidebar.expand')} onClick={() => void useApp.getState().updateSettings({ sidebarCollapsed: false })}>
              <PanelLeftOpen size={17} strokeWidth={1.75} />
            </IconButton>
          </div>
        )}
        <Header chatId={activeChatId} sidebarCollapsed={sidebarCollapsed} />
        <div className="em-app-main__body">
          {showChat && activeChatId ? (
            <>
              <ChatView chatId={activeChatId} />
              <div className="em-app-dock">
                {/* keyed by chatId so per-chat UI state (slash/mention menus, task-panel collapse) resets on chat switch (S4) */}
                <TaskPanel chatId={activeChatId} key={activeChatId} />
                <InteractionDock chatId={activeChatId} />
                <Composer chatId={activeChatId} variant="docked" key={activeChatId} />
              </div>
            </>
          ) : (
            <EmptyState chatId={activeChatId} />
          )}
        </div>
      </main>
      {panelOpen && showChat && activeChatId && <SidePanel chatId={activeChatId} key={activeChatId} />}
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}
