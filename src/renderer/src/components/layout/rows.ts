/** Sidebar row model: merges in-memory ChatState with on-disk SessionSummary (§4.5 dedupe rule). */
import type { ChatState } from '@/store/types'
import type { SessionSummary } from '@shared/types'

export interface ChatRow {
  key: string
  chatId?: string
  sessionId?: string
  title: string
  cwd?: string
  lastModified: number
  isNew: boolean
  isRunning: boolean
  pendingCount: number
  summary?: SessionSummary
}

export function buildRows(
  chats: Record<string, ChatState>,
  sessions: SessionSummary[],
  untitled: string,
  activeChatId?: string | null,
): ChatRow[] {
  const bySession = new Map<string, string>()
  for (const c of Object.values(chats)) if (c.sessionId) bySession.set(c.sessionId, c.chatId)

  const out: ChatRow[] = []
  for (const c of Object.values(chats)) {
    // A blank new chat only shows while it is the one being looked at; otherwise it would pile up as "未命名对话".
    if (c.status === 'new' && c.items.length === 0 && c.chatId !== activeChatId) continue
    out.push({
      key: c.chatId,
      chatId: c.chatId,
      sessionId: c.sessionId,
      title: c.title || untitled,
      cwd: c.cwd,
      lastModified: c.lastActivity,
      isNew: !c.sessionId,
      isRunning: c.status === 'running' || c.status === 'starting',
      pendingCount: c.pendingPermissions.length,
    })
  }
  for (const s of sessions) {
    if (bySession.has(s.sessionId)) continue // already shown as the live in-memory row above
    out.push({
      key: s.sessionId,
      sessionId: s.sessionId,
      title: s.title || untitled,
      cwd: s.cwd,
      lastModified: s.lastModified,
      isNew: false,
      isRunning: false,
      pendingCount: 0,
      summary: s,
    })
  }
  return out
}
