/** Renders a `result` ChatItem: either the small pale tool-strip at the end of a reply (duration,
 * tokens, cost, copy-all) or — on failure — a red error notice (§4.2 "错误结果显示为红色 notice"). */
import clsx from 'clsx'
import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import { useT } from '@/i18n'
import { formatCost, formatDuration, formatTokens } from '@/lib/format'
import { useApp } from '@/store/app'
import type { TurnResult } from '@/store/types'
import './TurnFooter.css'

export interface TurnFooterProps {
  result: TurnResult
  getFullText: () => string
  /** always show (not just on hover) — the most recent reply in the chat. */
  forceVisible?: boolean
  /** no preceding assistant item to attach to (e.g. a bare error before any text). */
  standalone?: boolean
}

export function TurnFooter({ result, getFullText, forceVisible, standalone }: TurnFooterProps) {
  const t = useT()
  const showCost = useApp((s) => s.settings.showCost)
  const [copied, setCopied] = useState(false)

  if (result.isError && !result.interrupted) {
    const subtypeKey = `chat.error.subtype.${result.subtype}`
    const subtypeMsg = t(subtypeKey)
    const text = subtypeMsg !== subtypeKey ? subtypeMsg : result.errorText || t('chat.error.unknown', { code: result.subtype })
    return (
      <div className="em-chat-notice em-chat-notice--error em-chat-turnfooter__error">
        <div className="em-chat-notice__row">{text}</div>
      </div>
    )
  }

  return (
    <div className={clsx('em-chat-turnfooter', (forceVisible || standalone) && 'is-visible')}>
      <button
        type="button"
        className="em-chat-turnfooter__copy"
        title={t('chat.result.copyAll')}
        onClick={async () => {
          await navigator.clipboard.writeText(getFullText())
          setCopied(true)
          setTimeout(() => setCopied(false), 1400)
        }}
      >
        {copied ? <Check size={13} strokeWidth={1.75} /> : <Copy size={13} strokeWidth={1.75} />}
      </button>
      {result.durationMs != null && <span>{formatDuration(result.durationMs)}</span>}
      {(result.inputTokens != null || result.outputTokens != null) && (
        <span>{t('chat.result.tokensInOut', { in: formatTokens(result.inputTokens ?? 0), out: formatTokens(result.outputTokens ?? 0) })}</span>
      )}
      {showCost && result.costUsd != null && <span>{formatCost(result.costUsd)}</span>}
    </div>
  )
}
