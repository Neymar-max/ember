import { CheckCircle2, XCircle } from 'lucide-react'
import type { ToolCall } from '@/store/types'
import { Markdown } from '@/components/chat/Markdown'
import { Spinner } from '@/components/common/Spinner'
import { useT } from '@/i18n'

const PENDING_STATUSES = new Set(['streaming', 'pending', 'waiting-permission', 'running'])

/** The ExitPlanMode call itself, rendered inline in the transcript as a distinct plan card
 * (not a collapsible ToolRow) — SPEC 4.3. The *approval* UI while it's still pending lives in
 * interactive/PlanCard, docked at the bottom; this is just the record of it. */
export function PlanResultCard({ tool }: { tool: ToolCall }) {
  const t = useT()
  const input = tool.input as { plan?: unknown } | undefined
  const plan = typeof input?.plan === 'string' ? input.plan : ''

  return (
    <div className="em-tool-plancard">
      <div className="em-tool-plancard-title">{t('tools.plan.title')}</div>
      <div className="em-tool-plancard-text">
        <Markdown text={plan} variant="message" />
      </div>
      <div className="em-tool-plancard-status">
        {tool.status === 'done' && (
          <span className="em-tool-plancard-approved">
            <CheckCircle2 size={13} strokeWidth={1.75} />
            {t('tools.plan.approved')}
          </span>
        )}
        {(tool.status === 'denied' || tool.status === 'error') && (
          <span className="em-tool-plancard-rejected">
            <XCircle size={13} strokeWidth={1.75} />
            {t('tools.plan.rejected')}
          </span>
        )}
        {tool.status === 'interrupted' && (
          <span className="em-tool-plancard-rejected">
            <XCircle size={13} strokeWidth={1.75} />
            {t('tools.plan.interrupted')}
          </span>
        )}
        {PENDING_STATUSES.has(tool.status) && (
          <span className="em-tool-plancard-pending">
            <Spinner size={12} />
            {t('tools.plan.pending')}
          </span>
        )}
      </div>
    </div>
  )
}
