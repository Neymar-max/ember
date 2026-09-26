import { useChat } from '@/store/chats'
import { useT } from '@/i18n'
import { PermissionCard } from './PermissionCard'
import { QuestionCard } from './QuestionCard'
import { PlanCard } from './PlanCard'
import './InteractionDock.css'

/** Renders the oldest pending permission / question / plan-approval card for the chat,
 * docked above the composer (SPEC 4.3). Returns null when nothing is pending. */
export function InteractionDock({ chatId }: { chatId: string }) {
  const t = useT()
  const chat = useChat(chatId)
  const pending = chat?.pendingPermissions ?? []

  if (pending.length === 0) return null

  const request = pending[0]
  const extra = pending.length - 1

  return (
    <div className="em-ix-dock">
      {request.toolName === 'AskUserQuestion' ? (
        <QuestionCard key={request.requestId} request={request} />
      ) : request.toolName === 'ExitPlanMode' ? (
        <PlanCard key={request.requestId} request={request} />
      ) : (
        <PermissionCard key={request.requestId} request={request} />
      )}
      {extra > 0 && <div className="em-ix-more">{t('tools.perm.more', { n: extra })}</div>}
    </div>
  )
}
