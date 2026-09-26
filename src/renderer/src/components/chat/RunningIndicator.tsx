/** "Claude is working" line shown at the end of the live reply while a turn is running and the
 * last part isn't already streaming visible text (§4.2). Ticks its elapsed-seconds display live. */
import { useEffect, useState } from 'react'
import { EmberSpark } from '@/components/common/Spinner'
import { useT } from '@/i18n'
import { useChat } from '@/store/chats'
import type { ToolCall } from '@/store/types'
import './RunningIndicator.css'

function findActiveTool(tools: Record<string, ToolCall>): ToolCall | undefined {
  return Object.values(tools).find((tc) => tc.status === 'running' || tc.status === 'pending' || tc.status === 'streaming')
}

export function RunningIndicator({ chatId }: { chatId: string }) {
  const t = useT()
  const chat = useChat(chatId)
  const [, bump] = useState(0)

  useEffect(() => {
    const id = setInterval(() => bump((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [])

  if (!chat) return null

  let label = t('chat.running.thinking')
  if (chat.cliStatus === 'compacting') {
    label = t('chat.running.compacting')
  } else {
    const tool = findActiveTool(chat.tools)
    if (tool) label = t('chat.running.tool', { name: tool.name })
  }

  const elapsed = chat.turnStartedAt != null ? Math.max(0, Math.round((Date.now() - chat.turnStartedAt) / 1000)) : undefined

  return (
    <div className="em-chat-running">
      <EmberSpark size={15} />
      <span>{label}</span>
      {elapsed != null && <span className="em-chat-running__time">{formatElapsed(elapsed)}</span>}
    </div>
  )
}

/** 45s → "45s", 75s → "1m 15s", 3725s → "1h 2m 5s". */
export function formatElapsed(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}
