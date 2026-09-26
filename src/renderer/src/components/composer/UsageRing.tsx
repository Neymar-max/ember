/** Small ring next to the model picker (Claude-app style): shows how full the context window is;
 * hover or click opens a card with the context window and the plan's usage limits. */
import clsx from 'clsx'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Popover } from '@/components/common/Popover'
import { useT } from '@/i18n'
import { ember } from '@/lib/api'
import { formatTokens } from '@/lib/format'
import { useApp } from '@/store/app'
import { useChats } from '@/store/chats'
import type { RateLimitWindow } from '@shared/types'
import './UsageRing.css'

const HOVER_OPEN_MS = 180
const HOVER_CLOSE_MS = 220

function tone(frac: number): string {
  if (frac >= 0.95) return 'var(--danger)'
  if (frac >= 0.8) return 'var(--warning)'
  return 'var(--accent)'
}

function Bar({ frac }: { frac: number }) {
  return (
    <div className="em-usage__bar">
      <div className="em-usage__bar-fill" style={{ width: `${Math.max(frac > 0 ? 1.5 : 0, Math.min(100, frac * 100))}%`, background: tone(frac) }} />
    </div>
  )
}

function useResetText() {
  const t = useT()
  return (resetsAt?: number): string | undefined => {
    if (!resetsAt) return undefined
    const ms = resetsAt * 1000 - Date.now()
    if (ms <= 0) return t('shell.usage.resetsSoon')
    const mins = Math.round(ms / 60000)
    if (mins < 60) return t('shell.usage.resetsInMin', { m: mins })
    if (mins < 24 * 60) return t('shell.usage.resetsInHr', { h: Math.floor(mins / 60), m: mins % 60 })
    const when = new Intl.DateTimeFormat(navigator.language, { weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(resetsAt * 1000))
    return t('shell.usage.resetsAt', { when })
  }
}

function LimitRow({ label, w }: { label: string; w: RateLimitWindow }) {
  const resetText = useResetText()
  const frac = w.utilization ?? 0
  const reset = resetText(w.resetsAt)
  return (
    <div className="em-usage__row">
      <div className="em-usage__row-head">
        <span className="em-usage__row-label">{label}</span>
        {reset && <span className="em-usage__row-reset">{reset}</span>}
        <span className="em-usage__row-pct">{Math.round(frac * 100)}%</span>
      </div>
      <Bar frac={frac} />
    </div>
  )
}

export function UsageRing({ chatId }: { chatId: string | null }) {
  const t = useT()
  const status = useChats((s) => (chatId ? s.chats[chatId]?.status : undefined))
  const contextTokens = useChats((s) => (chatId ? s.chats[chatId]?.contextTokens : undefined))
  const contextMax = useChats((s) => (chatId ? s.chats[chatId]?.contextMax : undefined))
  const activeModel = useChats((s) => (chatId ? s.chats[chatId]?.activeModel : undefined))
  const rateLimits = useApp((s) => s.rateLimits)
  const account = useApp((s) => s.env?.account)
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  const anchorRef = useRef<HTMLButtonElement>(null)
  const timer = useRef<number | undefined>(undefined)

  // Ask the live CLI for its own context measurement (exact window size) after each turn.
  const refreshContext = useCallback(() => {
    if (!chatId) return
    void ember.session
      .contextUsage(chatId)
      .then((u) => {
        if (u && (u.totalTokens != null || u.maxTokens != null)) useChats.getState().setContextUsage(chatId, u.totalTokens, u.maxTokens)
      })
      .catch(() => {})
  }, [chatId])

  useEffect(() => {
    if (status === 'idle') refreshContext()
  }, [status, refreshContext])

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const show = () => {
    setOpen(true)
    refreshContext()
    void ember.env.refreshUsage().catch(() => {})
  }
  const scheduleOpen = () => {
    window.clearTimeout(timer.current)
    if (!open) timer.current = window.setTimeout(show, HOVER_OPEN_MS)
  }
  // mouseenter can be missed when the composer jumps position under a resting pointer (e.g. after
  // the first message docks it) — any movement over the ring also counts as hovering.
  const hovering = useRef(false)
  const scheduleClose = () => {
    window.clearTimeout(timer.current)
    if (!pinned) timer.current = window.setTimeout(() => setOpen(false), HOVER_CLOSE_MS)
  }

  // Window size: the CLI's figure when we have it, else infer from the model id ("[1m]" = 1M tokens).
  const max = contextMax ?? (activeModel?.includes('[1m]') ? 1_000_000 : 200_000)
  const used = contextTokens ?? 0
  const frac = contextTokens != null ? Math.min(1, used / max) : 0
  const r = 7.5
  const c = 2 * Math.PI * r

  const hasPlan = !!(rateLimits?.fiveHour || rateLimits?.sevenDay || rateLimits?.weeklyByModel?.length)
  const planLabel = rateLimits?.planLabel ?? account?.subscriptionType?.replace(/^Claude\s+/i, '')
  const isApiKey = !!account && !account.email && (account.apiKeySource || account.tokenSource) && account.apiKeySource !== 'none'

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className={clsx('em-usage-ring', open && 'is-open')}
        aria-label={t('shell.usage.title')}
        onMouseEnter={() => {
          hovering.current = true
          scheduleOpen()
        }}
        onMouseMove={() => {
          if (!hovering.current) {
            hovering.current = true
            scheduleOpen()
          }
        }}
        onMouseLeave={() => {
          hovering.current = false
          scheduleClose()
        }}
        onClick={() => {
          window.clearTimeout(timer.current)
          if (open && pinned) {
            setPinned(false)
            setOpen(false)
          } else {
            setPinned(true)
            if (!open) show()
          }
        }}
      >
        <svg width={20} height={20} viewBox="0 0 20 20" aria-hidden>
          <circle cx={10} cy={10} r={r} fill="none" stroke="var(--border-2)" strokeWidth={2.2} />
          {frac > 0 && (
            <circle
              cx={10}
              cy={10}
              r={r}
              fill="none"
              stroke={tone(frac)}
              strokeWidth={2.2}
              strokeDasharray={c}
              strokeDashoffset={c * (1 - Math.max(frac, 0.03))}
              strokeLinecap="round"
              transform="rotate(-90 10 10)"
            />
          )}
        </svg>
      </button>
      <Popover
        open={open}
        onClose={() => {
          setOpen(false)
          setPinned(false)
        }}
        anchorRef={anchorRef}
        placement="top-end"
        offset={10}
        width={340}
        role="dialog"
      >
        <div className="em-usage" onMouseEnter={() => window.clearTimeout(timer.current)} onMouseLeave={scheduleClose}>
          <div className="em-usage__section">
            <div className="em-usage__row-head">
              <span className="em-usage__title">{t('shell.usage.context')}</span>
              <span className="em-usage__row-pct">
                {contextTokens != null
                  ? `${formatTokens(used)} / ${formatTokens(max)} (${Math.round(frac * 100)}%)`
                  : t('shell.usage.contextEmpty')}
              </span>
            </div>
            <Bar frac={frac} />
          </div>
          <div className="em-usage__divider" />
          <div className="em-usage__section">
            <div className="em-usage__title">
              {t('shell.usage.plan')}
              {planLabel && <span className="em-usage__plan"> · {planLabel}</span>}
            </div>
            {hasPlan ? (
              <>
                {rateLimits?.fiveHour && <LimitRow label={t('shell.usage.fiveHour')} w={rateLimits.fiveHour} />}
                {rateLimits?.sevenDay && <LimitRow label={t('shell.usage.weekly')} w={rateLimits.sevenDay} />}
                {rateLimits?.weeklyByModel?.map((m) => <LimitRow key={m.key} label={t('shell.usage.weeklyModel', { model: m.label })} w={m.window} />)}
              </>
            ) : (
              <div className="em-usage__empty">{isApiKey ? t('shell.usage.apiKey') : t('shell.usage.noData')}</div>
            )}
          </div>
        </div>
      </Popover>
    </>
  )
}
