/** Floating "back to bottom" circular button shown once the user has scrolled up (§4.2). */
import { ArrowDown } from 'lucide-react'
import { useT } from '@/i18n'
import './ScrollToBottom.css'

export function ScrollToBottom({ onClick }: { onClick: () => void }) {
  const t = useT()
  return (
    <button type="button" className="em-chat-scrolldown" onClick={onClick} aria-label={t('chat.scrollToBottom')} title={t('chat.scrollToBottom')}>
      <ArrowDown size={16} strokeWidth={2} />
    </button>
  )
}
