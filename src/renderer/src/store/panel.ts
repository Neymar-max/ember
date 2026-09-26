/** Right-hand side panel (tasks / files / file preview). UI-only state; the open/closed choice is
 * remembered per viewer so the panel comes back the way it was left. */
import { create } from 'zustand'

export type PanelTab = 'tasks' | 'files'

interface PanelState {
  open: boolean
  tab: PanelTab
  /** file shown in the preview pane (absolute or cwd-relative path) */
  preview: string | null
  setOpen(open: boolean): void
  toggle(tab?: PanelTab): void
  setTab(tab: PanelTab): void
  openFile(path: string): void
  closeFile(): void
}

const KEY = 'ember.panel'
function load(): Partial<PanelState> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}')
  } catch {
    return {}
  }
}
function save(s: Pick<PanelState, 'open' | 'tab'>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ open: s.open, tab: s.tab }))
  } catch {
    // storage unavailable — fine
  }
}

const initial = load()

export const usePanel = create<PanelState>((set, get) => ({
  open: initial.open ?? false,
  tab: initial.tab === 'files' ? 'files' : 'tasks',
  preview: null,
  setOpen: (open) => {
    set({ open })
    save(get())
  },
  toggle: (tab) => {
    const s = get()
    const open = tab && s.open && s.tab !== tab ? true : !s.open
    set({ open, tab: tab ?? s.tab, preview: open ? s.preview : null })
    save(get())
  },
  setTab: (tab) => {
    set({ tab, preview: null })
    save(get())
  },
  openFile: (path) => {
    set({ open: true, tab: 'files', preview: path })
    save(get())
  },
  closeFile: () => set({ preview: null }),
}))
