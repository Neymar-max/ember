/** Bottom-of-sidebar account row: rate-limit bars + avatar/name/plan + settings gear (§4.5). */
import { Settings } from 'lucide-react'
import { IconButton } from '@/components/common/Button'
import { useT } from '@/i18n'
import { useApp } from '@/store/app'
import { UsageBars } from './UsageBars'
import './AccountCard.css'

export function AccountCard() {
  const t = useT()
  const env = useApp((s) => s.env)
  const rateLimits = useApp((s) => s.rateLimits)
  const setSettingsOpen = useApp((s) => s.setSettingsOpen)
  const account = env?.account
  const name = account?.displayName || account?.email?.split('@')[0] || t('shell.account.settings')
  const meta = [account?.email, account?.subscriptionType].filter(Boolean).join(' · ')
  const initial = (account?.displayName || account?.email || '?').trim().charAt(0).toUpperCase()

  return (
    <div className="em-shell-account">
      <UsageBars rateLimits={rateLimits} />
      <div
        className="em-shell-account__row"
        role="button"
        tabIndex={0}
        onClick={() => setSettingsOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') setSettingsOpen(true)
        }}
      >
        <span className="em-shell-account__avatar">{initial}</span>
        <span className="em-shell-account__id">
          <div className="em-shell-account__name">{name}</div>
          {meta && <div className="em-shell-account__meta">{meta}</div>}
        </span>
        <IconButton label={t('shell.account.settings')} onClick={(e) => { e.stopPropagation(); setSettingsOpen(true) }}>
          <Settings size={16} strokeWidth={1.75} />
        </IconButton>
      </div>
    </div>
  )
}
