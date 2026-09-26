/** One thinking step (Claude-app style): a single line showing the summary's first sentence —
 * shimmering while it streams — and the full summary only when clicked. Hidden entirely when
 * settings.showThinking is off. A finished block with no text (older CLIs / redacted) carries no
 * information and is not rendered at all. */
import clsx from 'clsx'
import { ChevronRight, Lightbulb } from 'lucide-react'
import { useState } from 'react'
import { useT } from '@/i18n'
import { useApp } from '@/store/app'
import { thinkingHeadline } from '@/lib/thinking'
import { Markdown } from './Markdown'
import './Thinking.css'

export function Thinking({ text, streaming, tokens }: { text: string; streaming?: boolean; tokens?: number }) {
  const t = useT()
  const showThinking = useApp((s) => s.settings.showThinking)
  const [open, setOpen] = useState(false)
  if (!showThinking) return null

  const isEmpty = text.trim() === ''
  if (isEmpty && !streaming) return null
  const headline = isEmpty ? '' : thinkingHeadline(text, streaming)
  // Nothing more to show when the headline already is the whole summary.
  const canExpand = !isEmpty && headline !== text.replace(/[*_`#>]+/g, '').replace(/\s+/g, ' ').trim()
  const label = headline || (streaming ? (tokens ? t('chat.thinking.streamingTokens', { n: tokens }) : t('chat.thinking.streaming')) : t('chat.thinking.label'))

  return (
    <div className={clsx('em-chat-thinking', open && 'is-open')}>
      <button
        type="button"
        className="em-chat-thinking__row"
        onClick={() => canExpand && setOpen((v) => !v)}
        disabled={!canExpand}
        aria-expanded={canExpand ? open : undefined}
      >
        <Lightbulb size={13} strokeWidth={1.75} className={clsx('em-chat-thinking__icon', streaming && 'is-active')} />
        <span className={clsx('em-chat-thinking__label', streaming && 'is-shimmer')}>{label}</span>
        {canExpand && <ChevronRight size={12} strokeWidth={1.75} className="em-chat-thinking__chev" />}
      </button>
      {open && canExpand && (
        <div className="em-chat-thinking__body">
          <Markdown text={text} variant="ui" streaming={streaming} />
        </div>
      )}
    </div>
  )
}
