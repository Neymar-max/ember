/** Centered one-line system notice (info/warning/error), optionally expandable (§4.2). */
import { AlertTriangle, Info, XCircle } from 'lucide-react'
import { useState } from 'react'
import type { ChatItem } from '@/store/types'
import './Notice.css'

export function Notice({ item }: { item: Extract<ChatItem, { kind: 'notice' }> }) {
  const [open, setOpen] = useState(false)
  const Icon = item.level === 'error' ? XCircle : item.level === 'warning' ? AlertTriangle : Info

  return (
    <div className={`em-chat-notice em-chat-notice--${item.level}`}>
      <button type="button" className="em-chat-notice__row" onClick={() => item.detail && setOpen((v) => !v)} disabled={!item.detail}>
        <Icon size={13} strokeWidth={1.75} />
        <span>{item.text}</span>
      </button>
      {open && item.detail && <div className="em-chat-notice__detail">{item.detail}</div>}
    </div>
  )
}
