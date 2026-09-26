/** Right-aligned user bubble: plain text, slash-command chip, or image attachments (§4.2). */
import { FileText } from 'lucide-react'
import { useState } from 'react'
import { CopyButton } from '@/components/common/CopyButton'
import { useT } from '@/i18n'
import { basename } from '@/lib/format'
import type { ChatItem } from '@/store/types'
import './UserMessage.css'

export function UserMessage({ item }: { item: Extract<ChatItem, { kind: 'user' }> }) {
  const t = useT()
  const [hover, setHover] = useState(false)

  return (
    <div className="em-chat-user-wrap" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div className={item.pending ? 'em-chat-user is-pending' : 'em-chat-user'}>
        {item.command ? (
          <div className="em-chat-user__command">
            <span className="em-mono em-chat-user__command-name">/{item.command.name}</span>
            {item.command.args && <span className="em-chat-user__command-args">{item.command.args}</span>}
          </div>
        ) : (
          <>
            {item.images && item.images.length > 0 && (
              <div className="em-chat-user__images">
                {item.images.map((img, i) => (
                  <img key={i} src={img.dataUrl} alt={t('chat.image.alt')} title={t('chat.image.expand')} className="em-chat-user__image" />
                ))}
              </div>
            )}
            {item.text && <div className="em-chat-user__text">{item.text}</div>}
          </>
        )}
      </div>
      {item.attachments && item.attachments.length > 0 && (
        <div className="em-chat-user__attachments">
          {item.attachments.map((p) => (
            <span key={p} className="em-chat-user__attachment" title={p}>
              <FileText size={12} strokeWidth={1.75} />
              {basename(p)}
            </span>
          ))}
        </div>
      )}
      {hover && !item.pending && (
        <div className="em-chat-user__actions">
          <CopyButton text={item.text} size="sm" />
        </div>
      )}
    </div>
  )
}
