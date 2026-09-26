/**
 * Conversation store (OWNER: chat-engine work package).
 * Wires the `ember.session` / `ember.history` IPC surface into a zustand store, driving every
 * ChatState update through the pure reducer in `./reducer` (live SDK events) or `buildFromHistory`
 * (loading a transcript from disk).
 */
import { create } from 'zustand'
import type { EffortChoice, ImageAttachment, PermissionMode, PermissionResponse, RawSdkMessage, SessionEvent, SessionSummary } from '@shared/types'
import { t } from '@/i18n'
import { ember } from '@/lib/api'
import { currentModel, effortStops, nearestStop } from '@/lib/effort'
import { uuid } from '@/lib/format'
import { useApp } from './app'
import { applySdkMessage, buildFromHistory } from './reducer'
import type { ChatItem, ChatState, ChatStatus, ImageRef } from './types'

export interface ChatsStore {
  chats: Record<string, ChatState>
  activeChatId: string | null

  /** Create an empty local chat for `cwd` (status 'new'), make it active, return its chatId. */
  newChat(cwd: string): string
  /** Open a history session: load transcript into a ChatState keyed by sessionId (if not already loaded) and activate it. */
  openHistory(summary: SessionSummary): Promise<void>
  setActive(chatId: string | null): void
  /** Close the live CLI process of a chat (keeps the transcript in memory). */
  closeChat(chatId: string): Promise<void>
  /** Remove a chat from memory entirely (e.g. after the history entry was deleted). */
  forgetChat(chatId: string): void

  send(chatId: string, text: string, images?: ImageAttachment[]): Promise<void>
  interrupt(chatId: string): Promise<void>
  setModel(chatId: string, model: string | undefined): Promise<void>
  setPermissionMode(chatId: string, mode: PermissionMode): Promise<void>
  setEffort(chatId: string, effort: EffortChoice | undefined): Promise<void>
  /** Record the CLI's own context measurement (live sessions only). */
  setContextUsage(chatId: string, totalTokens: number | undefined, maxTokens: number | undefined): void
  /** Change the working directory — only allowed while status === 'new'. */
  setCwd(chatId: string, cwd: string): void
  setDraft(chatId: string, text: string): void
  setTitle(chatId: string, title: string): void
  respondPermission(resp: PermissionResponse): Promise<void>

  /** Feed one main-process event into the store (wired once in App). */
  ingest(event: SessionEvent): void

  /** Reattach to CLI sessions that are still alive in main but not in memory here (e.g. right after
   * a renderer reload): creates a placeholder chat for each and, when a sessionId is known, loads
   * its transcript so prior messages show up. Idempotent — safe to call more than once, and safe to
   * call before or after the `session:pending` permission restoration in App init. */
  restoreLive(): Promise<void>
}

function mapLiveStatus(status: string): ChatStatus {
  return status === 'closed' ? 'idle' : (status as ChatStatus)
}

function emptyChatState(chatId: string, cwd: string): ChatState {
  const settings = useApp.getState().settings
  return {
    chatId,
    cwd,
    title: '',
    model: settings.defaultModel || undefined,
    permissionMode: settings.defaultPermissionMode,
    effort: settings.defaultEffort || undefined,
    status: 'new',
    items: [],
    tools: {},
    pendingPermissions: [],
    todos: [],
    backgroundTasks: [],
    totals: { costUsd: 0, inputTokens: 0, outputTokens: 0 },
    historyLoaded: false,
    draft: '',
    lastActivity: Date.now(),
  }
}

function attachmentToImageRef(img: ImageAttachment): ImageRef {
  return { mediaType: img.mediaType, dataUrl: `data:${img.mediaType};base64,${img.data}` }
}

/** The CLI never echoes the user message we just sent (verified against the fixtures), so the
 * optimistic item stays `pending: true` until *any* live event for this chat arrives. */
function clearPendingUserItems(state: ChatState): ChatState {
  if (!state.items.some((it) => it.kind === 'user' && it.pending)) return state
  return { ...state, items: state.items.map((it) => (it.kind === 'user' && it.pending ? { ...it, pending: false } : it)) }
}

function lastAssistantText(items: ChatItem[]): string {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    if (it.kind === 'assistant') {
      const last = [...it.parts].reverse().find((p) => p.type === 'text')
      if (last && last.type === 'text') return last.text
    }
  }
  return ''
}

/** Fires the "turn finished" system notification when the window isn't focused, per SPEC §3. */
function maybeNotifyOnResult(chatId: string, prevItemCount: number, next: ChatState): void {
  const last = next.items[next.items.length - 1]
  if (!last || last.kind !== 'result' || next.items.length === prevItemCount) return
  const settings = useApp.getState().settings
  if (!settings.notifyOnDone || document.hasFocus()) return
  void ember.sys.notify(t('chat.notify.title'), lastAssistantText(next.items).slice(0, 100), chatId)
}


/** Clamp a chat's effort to what its model supports (e.g. a global Ultracode default on Haiku → none). */
function effortForModel(effort: EffortChoice | undefined, model: string | undefined): EffortChoice | undefined {
  if (!effort) return undefined
  const env = useApp.getState().env
  if (!env?.models.length) return effort
  const stops = effortStops(currentModel(env.models, model, env.defaultModel))
  return stops.length ? nearestStop(stops, effort) : undefined
}

export const useChats = create<ChatsStore>((set, get) => ({
  chats: {},
  activeChatId: null,

  newChat: (cwd) => {
    const chatId = uuid()
    set((s) => ({ chats: { ...s.chats, [chatId]: emptyChatState(chatId, cwd) }, activeChatId: chatId }))
    return chatId
  },

  openHistory: async (summary) => {
    const chatId = summary.sessionId
    if (get().chats[chatId]) {
      set({ activeChatId: chatId })
      return
    }
    set((s) => ({
      chats: { ...s.chats, [chatId]: { ...emptyChatState(chatId, summary.cwd ?? ''), sessionId: chatId, title: summary.title, status: 'loading' } },
      activeChatId: chatId,
    }))
    try {
      const loaded = await ember.history.load(chatId)
      set((s) => {
        const base = s.chats[chatId]
        if (!base) return s
        const built = buildFromHistory(base, loaded.messages)
        return { chats: { ...s.chats, [chatId]: { ...built, cwd: loaded.cwd || built.cwd, title: loaded.title || built.title, status: 'idle', historyLoaded: true } } }
      })
    } catch (err) {
      set((s) => {
        const base = s.chats[chatId]
        if (!base) return s
        return { chats: { ...s.chats, [chatId]: { ...base, status: 'error', error: String(err) } } }
      })
    }
  },

  setActive: (chatId) => set({ activeChatId: chatId }),

  closeChat: async (chatId) => {
    await ember.session.close(chatId)
    set((s) => {
      const c = s.chats[chatId]
      if (!c) return s
      return { chats: { ...s.chats, [chatId]: { ...c, status: 'idle' } } }
    })
  },

  forgetChat: (chatId) =>
    set((s) => {
      // Late events for a deleted chat must not resurrect it as a ghost "untitled" row.
      forgottenChats.add(chatId)
      sdkQueue.delete(chatId)
      if (!(chatId in s.chats)) return s
      const chats = { ...s.chats }
      delete chats[chatId]
      return { chats, activeChatId: s.activeChatId === chatId ? null : s.activeChatId }
    }),

  send: async (chatId, text, images) => {
    const chat = get().chats[chatId]
    if (!chat) return
    const id = uuid()
    // Sent while Claude is mid-turn: the CLI queues it until the current step finishes.
    const busy = chat.status === 'running' || chat.status === 'starting'
    const userItem: ChatItem = { kind: 'user', id, text, images: images?.map(attachmentToImageRef), pending: true, timestamp: Date.now(), ...(busy ? { delivery: 'queued' as const } : {}) }
    set((s) => {
      const c = s.chats[chatId]
      if (!c) return s
      // Provisional title from the first prompt until the CLI's own session title arrives via history refresh.
      const title = c.title || text.trim().split('\n')[0].slice(0, 60)
      if (busy) return { chats: { ...s.chats, [chatId]: { ...c, title, queued: [...(c.queued ?? []), userItem as Extract<ChatItem, { kind: 'user' }>] } } }
      return { chats: { ...s.chats, [chatId]: { ...c, title, items: [...c.items, userItem], status: 'running', turnStartedAt: Date.now(), error: undefined } } }
    })
    try {
      const res = await ember.session.send({
        chatId,
        cwd: chat.cwd,
        resumeSessionId: chat.sessionId,
        model: chat.model,
        permissionMode: chat.permissionMode,
        effort: effortForModel(chat.effort, chat.model),
        text,
        images,
        uuid: id,
      })
      if (!res.ok) failTurn(chatId, res.error)
    } catch (err) {
      failTurn(chatId, String(err))
    }
  },

  interrupt: async (chatId) => {
    await ember.session.interrupt(chatId)
  },

  setModel: async (chatId, model) => {
    set((s) => {
      const c = s.chats[chatId]
      if (!c) return s
      return { chats: { ...s.chats, [chatId]: { ...c, model } } }
    })
    await ember.session.setModel(chatId, model)
  },

  setPermissionMode: async (chatId, mode) => {
    set((s) => {
      const c = s.chats[chatId]
      if (!c) return s
      return { chats: { ...s.chats, [chatId]: { ...c, permissionMode: mode } } }
    })
    await ember.session.setPermissionMode(chatId, mode)
  },

  setContextUsage: (chatId, totalTokens, maxTokens) =>
    set((s) => {
      const c = s.chats[chatId]
      if (!c) return s
      const contextTokens = totalTokens ?? c.contextTokens
      const contextMax = maxTokens ?? c.contextMax
      if (contextTokens === c.contextTokens && contextMax === c.contextMax) return s
      return { chats: { ...s.chats, [chatId]: { ...c, contextTokens, contextMax } } }
    }),

  setEffort: async (chatId, effort) => {
    set((s) => {
      const c = s.chats[chatId]
      if (!c) return s
      return { chats: { ...s.chats, [chatId]: { ...c, effort } } }
    })
    await ember.session.setEffort(chatId, effort ?? null)
  },

  setCwd: (chatId, cwd) =>
    set((s) => {
      const c = s.chats[chatId]
      if (!c || c.status !== 'new') return s
      return { chats: { ...s.chats, [chatId]: { ...c, cwd } } }
    }),

  setDraft: (chatId, text) =>
    set((s) => {
      const c = s.chats[chatId]
      if (!c) return s
      return { chats: { ...s.chats, [chatId]: { ...c, draft: text } } }
    }),

  setTitle: (chatId, title) =>
    set((s) => {
      const c = s.chats[chatId]
      if (!c) return s
      return { chats: { ...s.chats, [chatId]: { ...c, title } } }
    }),

  respondPermission: async (resp) => {
    await ember.session.respond(resp)
    set((s) => {
      let touched = false
      const chats = { ...s.chats }
      for (const id of Object.keys(chats)) {
        const c = chats[id]
        if (c.pendingPermissions.some((p) => p.requestId === resp.requestId)) {
          chats[id] = { ...c, pendingPermissions: c.pendingPermissions.filter((p) => p.requestId !== resp.requestId) }
          touched = true
        }
      }
      return touched ? { chats } : s
    })
  },

  restoreLive: async () => {
    const live = await ember.session.liveList()
    for (const l of live) {
      const before = get().chats[l.chatId]
      // Already fully restored (by an earlier restoreLive() call, or by a live event that arrived
      // first) — skip so we never reload the transcript or clobber newer state.
      if (before?.sessionId || before?.historyLoaded) continue
      set((s) => {
        if (s.chats[l.chatId]?.sessionId || s.chats[l.chatId]?.historyLoaded) return s
        const base = s.chats[l.chatId] ?? emptyChatState(l.chatId, l.cwd ?? '')
        return { chats: { ...s.chats, [l.chatId]: { ...base, cwd: base.cwd || l.cwd || '', sessionId: l.sessionId, status: mapLiveStatus(l.status) } } }
      })
      if (!l.sessionId) continue
      try {
        const loaded = await ember.history.load(l.sessionId)
        set((s) => {
          const base = s.chats[l.chatId]
          if (!base || base.historyLoaded) return s
          // Build the past transcript on a clean slate, then keep whatever live events already landed
          // in the placeholder while we were loading (dedup by item id) — never fold history onto them.
          const built = buildFromHistory({ ...base, items: [], tools: {}, todos: [], streamOpen: undefined }, loaded.messages)
          const known = new Set(built.items.map((i) => i.id))
          const liveItems = base.items.filter((i) => !known.has(i.id))
          return {
            chats: {
              ...s.chats,
              [l.chatId]: {
                ...built,
                items: [...built.items, ...liveItems],
                tools: { ...built.tools, ...base.tools },
                todos: base.todos.length ? base.todos : built.todos,
                streamOpen: base.streamOpen,
                pendingPermissions: base.pendingPermissions,
                cwd: loaded.cwd || base.cwd || built.cwd,
                title: base.title || loaded.title || built.title,
                status: base.status,
                historyLoaded: true,
              },
            },
          }
        })
      } catch {
        // best-effort — the chat still works live even if its past transcript can't be loaded.
      }
    }
  },

  // `sdk` events are handled outside this `set()` entirely — see `queueSdkEvent` — because a
  // streaming turn fires many of them per second and each needs its own requestAnimationFrame
  // batch, not one zustand commit apiece.
  ingest: (event) => {
    if (event.kind === 'sdk') {
      queueSdkEvent(event.chatId, event.message)
      return
    }
    set((s) => {
      let chat = s.chats[event.chatId]
      if (!chat) {
        // A chat not in memory yet (e.g. right after a renderer reload, before restoreLive() has
        // run) would otherwise silently drop this event — create a placeholder so the pending
        // permission / live session stays reachable (SPEC §3 "ingest").
        if (event.kind !== 'permission' && event.kind !== 'status' && event.kind !== 'session-id') return s
        if (forgottenChats.has(event.chatId)) return s
        chat = emptyChatState(event.chatId, '')
      }
      let next = chat
      switch (event.kind) {
        case 'status':
          next = { ...chat, status: event.status === 'closed' ? 'idle' : event.status, error: event.error ?? (event.status === 'error' ? chat.error : undefined) }
          break
        case 'session-id':
          next = { ...chat, sessionId: event.sessionId }
          break
        case 'permission': {
          const already = chat.pendingPermissions.some((p) => p.requestId === event.request.requestId)
          const tools = chat.tools[event.request.toolUseId]
          next = {
            ...chat,
            pendingPermissions: already ? chat.pendingPermissions : [...chat.pendingPermissions, event.request],
            tools: tools ? { ...chat.tools, [event.request.toolUseId]: { ...tools, status: 'waiting-permission' } } : chat.tools,
          }
          break
        }
        case 'permission-cancelled': {
          const removed = chat.pendingPermissions.find((p) => p.requestId === event.requestId)
          const tc = removed ? chat.tools[removed.toolUseId] : undefined
          next = {
            ...chat,
            pendingPermissions: chat.pendingPermissions.filter((p) => p.requestId !== event.requestId),
            tools: tc && tc.status === 'waiting-permission' ? { ...chat.tools, [removed!.toolUseId]: { ...tc, status: 'pending' } } : chat.tools,
          }
          break
        }
        case 'stderr':
        default:
          return s // stderr is only surfaced via main's log file, not the transcript.
      }
      return { chats: { ...s.chats, [event.chatId]: next } }
    })
  },
}))

// ── requestAnimationFrame batching for the dense `sdk` event stream (SPEC §3 "ingest") ─────────
// Module-level (not component/store state) on purpose: this is scheduling plumbing, not data: it
// never needs to be read, and coalescing must survive across every `ingest` call regardless of
// which component happens to be mounted.
const sdkQueue = new Map<string, RawSdkMessage[]>()
const sdkFlushScheduled = new Set<string>()
const forgottenChats = new Set<string>()

function queueSdkEvent(chatId: string, message: RawSdkMessage): void {
  if (forgottenChats.has(chatId)) return
  const queue = sdkQueue.get(chatId)
  if (queue) queue.push(message)
  else sdkQueue.set(chatId, [message])

  if (sdkFlushScheduled.has(chatId)) return
  sdkFlushScheduled.add(chatId)
  requestAnimationFrame(() => {
    sdkFlushScheduled.delete(chatId)
    const batch = sdkQueue.get(chatId)
    sdkQueue.delete(chatId)
    if (!batch || batch.length === 0 || forgottenChats.has(chatId)) return
    useChats.setState((s) => {
      // Same reasoning as `ingest`: an sdk event for a chat not in memory yet (reload race) must
      // not be dropped — create a placeholder so the live session stays reachable.
      const chat = s.chats[chatId] ?? emptyChatState(chatId, '')
      const prevItemCount = chat.items.length
      let next: ChatState = chat
      for (const message of batch) next = applySdkMessage(next, message)
      next = clearPendingUserItems(next)
      maybeNotifyOnResult(chatId, prevItemCount, next)
      return { chats: { ...s.chats, [chatId]: next } }
    })
  })
}

function failTurn(chatId: string, error: string): void {
  useChats.setState((s) => {
    const c = s.chats[chatId]
    if (!c) return s
    return {
      chats: {
        ...s.chats,
        [chatId]: { ...c, status: 'error', error, items: [...c.items, { kind: 'notice', id: uuid(), level: 'error', text: error }] },
      },
    }
  })
}

/** Convenience selector hook for one chat. */
export function useChat(chatId: string | null | undefined): ChatState | undefined {
  return useChats((s) => (chatId ? s.chats[chatId] : undefined))
}
