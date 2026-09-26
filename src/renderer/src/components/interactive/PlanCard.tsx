import { useState } from 'react'
import type { PermissionRequest, PermissionMode } from '@shared/types'
import { useChats } from '@/store/chats'
import { useT } from '@/i18n'
import { Button } from '@/components/common/Button'
import { Markdown } from '@/components/chat/Markdown'
import { useCardHotkeys } from './useCardHotkeys'
import './PlanCard.css'

/** Pending ExitPlanMode approval card. The plan itself, once resolved, is also rendered
 * inline in the transcript by tools/bodies/PlanResultCard. */
export function PlanCard({ request }: { request: PermissionRequest }) {
  const t = useT()
  const respond = useChats((s) => s.respondPermission)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [feedback, setFeedback] = useState('')
  const plan = typeof (request.input as { plan?: unknown } | undefined)?.plan === 'string' ? (request.input as { plan: string }).plan : ''

  function approve(mode: PermissionMode): void {
    void respond({ requestId: request.requestId, decision: 'allow', switchToMode: mode })
  }
  function refine(message: string): void {
    void respond({ requestId: request.requestId, decision: 'deny', message })
  }

  useCardHotkeys(!feedbackOpen, { onEnter: () => approve('acceptEdits'), onEscape: () => setFeedbackOpen(true) })

  return (
    <div className="em-ix-card em-ix-plan">
      <div className="em-ix-title">{t('tools.plan.approveTitle')}</div>
      <div className="em-ix-plan-body">
        <Markdown text={plan} variant="message" className="em-ix-plan-text" />
      </div>
      <div className="em-ix-actions em-ix-actions--col">
        <Button variant="primary" onClick={() => approve('acceptEdits')}>
          {t('tools.plan.approveAuto')}
        </Button>
        <Button variant="secondary" onClick={() => approve('default')}>
          {t('tools.plan.approveStep')}
        </Button>
        {!feedbackOpen && (
          <Button variant="ghost" onClick={() => setFeedbackOpen(true)}>
            {t('tools.plan.refine')}
          </Button>
        )}
      </div>
      {feedbackOpen && (
        <div className="em-ix-feedback">
          <textarea
            autoFocus
            rows={3}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder={t('tools.plan.refinePlaceholder')}
          />
          <div className="em-ix-feedback-actions">
            <Button size="sm" variant="ghost" onClick={() => setFeedbackOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button size="sm" variant="primary" disabled={!feedback.trim()} onClick={() => refine(feedback.trim())}>
              {t('tools.perm.send')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
