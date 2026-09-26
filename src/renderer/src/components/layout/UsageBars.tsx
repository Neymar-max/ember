/** Two thin rate-limit progress bars (5-hour / 7-day) shown above the account row when data exists. */
import { useT } from '@/i18n'
import type { RateLimitSnapshot, RateLimitWindow } from '@shared/types'
import './UsageBars.css'

function Bar({ labelKey, window: w, rejected }: { labelKey: string; window?: RateLimitWindow; rejected?: boolean }) {
  const t = useT()
  if (!w || w.utilization == null) return null
  const pct = Math.round(w.utilization * 100)
  const tone = rejected ? 'danger' : pct >= 80 ? 'warning' : undefined
  const resetLabel = w.resetsAt ? t('shell.account.resetsAt', { time: new Date(w.resetsAt * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) }) : undefined
  return (
    <div className="em-shell-usage__row" title={resetLabel}>
      <div className="em-shell-usage__label">
        <span>{t(labelKey)}</span>
        <span className="em-shell-usage__pct">{pct}%</span>
      </div>
      <div className="em-shell-usage__track">
        <div className={`em-shell-usage__fill${tone ? ` em-shell-usage__fill--${tone}` : ''}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  )
}

export function UsageBars({ rateLimits }: { rateLimits: RateLimitSnapshot | null }) {
  if (!rateLimits || (!rateLimits.fiveHour && !rateLimits.sevenDay)) return null
  const rejected = rateLimits.status === 'rejected'
  return (
    <div className="em-shell-usage">
      <Bar labelKey="shell.account.fiveHour" window={rateLimits.fiveHour} rejected={rejected} />
      <Bar labelKey="shell.account.sevenDay" window={rateLimits.sevenDay} rejected={rejected} />
    </div>
  )
}
