/**
 * Global app store (OWNER: app-shell work package).
 * Wires the `ember.env` / `ember.settings` / `ember.history` IPC surface into a zustand store.
 */
import { create } from 'zustand'
import { DEFAULT_SETTINGS } from '@shared/types'
import type { AppInfo, AppSettings, EnvStatus, RateLimitSnapshot, SessionSummary } from '@shared/types'
import { ember } from '@/lib/api'
import { useChats } from './chats'

export interface AppStore {
  ready: boolean
  env: EnvStatus | null
  settings: AppSettings
  appInfo: AppInfo | null
  sessions: SessionSummary[]
  sessionsLoading: boolean
  rateLimits: RateLimitSnapshot | null
  settingsOpen: boolean
  searchQuery: string
  /** null = all projects */
  projectFilter: string | null

  init(): Promise<void>
  recheckEnv(): Promise<void>
  refreshSessions(): Promise<void>
  updateSettings(patch: Partial<AppSettings>): Promise<void>
  setSettingsOpen(open: boolean): void
  setSearchQuery(q: string): void
  setProjectFilter(p: string | null): void
  /** Remember a project dir as most-recent (updates settings.recentProjects/lastProject). */
  touchProject(dir: string): Promise<void>
}

let initStarted = false

export const useApp = create<AppStore>((set, get) => ({
  ready: false,
  env: null,
  settings: DEFAULT_SETTINGS,
  appInfo: null,
  sessions: [],
  sessionsLoading: false,
  rateLimits: null,
  settingsOpen: false,
  searchQuery: '',
  projectFilter: null,

  init: async () => {
    // App.tsx effects can run more than once in dev; init() itself must stay idempotent.
    if (initStarted) return
    initStarted = true

    ember.env.onChanged((env) => set({ env }))
    ember.settings.onChanged((settings) => set({ settings }))
    ember.env.onRateLimits((rateLimits) => set({ rateLimits }))
    ember.history.onChanged(() => {
      void get().refreshSessions()
    })

    try {
      const [settings, appInfo, env, rateLimits] = await Promise.all([
        ember.settings.get(),
        ember.sys.appInfo(),
        ember.env.get(),
        ember.env.getRateLimits(),
      ])
      // Pushes may have landed while env.get() was waiting on the probe — never overwrite newer data
      // with the (possibly stale) snapshots fetched at the start.
      set((s) => ({
        settings,
        appInfo,
        env: s.env && s.env.checkedAt > env.checkedAt ? s.env : env,
        rateLimits: s.rateLimits && (!rateLimits || s.rateLimits.updatedAt >= rateLimits.updatedAt) ? s.rateLimits : rateLimits,
        ready: true,
      }))
    } catch (err) {
      // Surface as an error env state rather than leaving the UI stuck on "checking".
      set({
        ready: true,
        env: { state: 'error', cli: { found: false }, models: [], commands: [], error: String(err), checkedAt: Date.now() },
      })
    }
    void get().refreshSessions()
  },

  recheckEnv: async () => {
    const cur = get().env
    if (cur) set({ env: { ...cur, state: 'checking' } })
    const env = await ember.env.recheck()
    set({ env })
  },

  refreshSessions: async () => {
    set({ sessionsLoading: true })
    try {
      const sessions = await ember.history.list()
      set({ sessions, sessionsLoading: false })
      // Pick up the titles the CLI generates (or renames made in the terminal) for chats open in memory.
      const chats = useChats.getState()
      const byId = new Map(sessions.map((x) => [x.sessionId, x.title]))
      for (const c of Object.values(chats.chats)) {
        const title = c.sessionId ? byId.get(c.sessionId) : undefined
        if (title && title !== c.title) chats.setTitle(c.chatId, title)
      }
    } catch {
      set({ sessionsLoading: false })
    }
  },

  updateSettings: async (patch) => {
    // Optimistic merge so toggles (theme, sidebar…) feel instant; the round-trip confirms it.
    set({ settings: { ...get().settings, ...patch } })
    const settings = await ember.settings.set(patch)
    set({ settings })
  },

  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setSearchQuery: (q) => set({ searchQuery: q }),
  setProjectFilter: (p) => set({ projectFilter: p }),

  touchProject: async (dir) => {
    const rest = get().settings.recentProjects.filter((d) => d !== dir)
    await get().updateSettings({ recentProjects: [dir, ...rest].slice(0, 12), lastProject: dir })
  },
}))
