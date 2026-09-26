import { useState, type KeyboardEvent } from 'react'
import type { PermissionRequest } from '@shared/types'
import { useChats } from '@/store/chats'
import { useT } from '@/i18n'
import { Button } from '@/components/common/Button'
import { CodeBlock } from '@/components/chat/CodeBlock'
import { DiffView } from '@/components/tools/DiffView'
import { ParamList } from '@/components/tools/bodies/GenericBody'
import { permissionTitle, alwaysAllowHint } from './permissionText'
import { useCardHotkeys } from './useCardHotkeys'
import './PermissionCard.css'

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function PermissionPreview({ request }: { request: PermissionRequest }) {
  const cwd = useChats((s) => s.chats[request.chatId]?.cwd)
  const input = request.input ?? {}
  switch (request.toolName) {
    case 'Bash':
      return <pre className="em-ix-cmd">$ {str(input.command)}</pre>
    case 'Edit':
      return <DiffView oldText={str(input.old_string)} newText={str(input.new_string)} path={str(input.file_path)} cwd={cwd} maxCollapsedLines={20} />
    case 'MultiEdit': {
      const edits = Array.isArray(input.edits) ? (input.edits as { old_string?: unknown; new_string?: unknown }[]) : []
      return (
        <>
          {edits.map((e, i) => (
            <DiffView key={i} oldText={str(e.old_string)} newText={str(e.new_string)} maxCollapsedLines={20} className="em-ix-preview-item" />
          ))}
        </>
      )
    }
    case 'Write':
      return <CodeBlock code={str(input.content)} bare maxLines={20} />
    default:
      return <ParamList input={input} />
  }
}

/** Permission approval card docked above the composer (SPEC 4.3). Renders for every tool
 * except AskUserQuestion / ExitPlanMode, which get their own card types. */
export function PermissionCard({ request }: { request: PermissionRequest }) {
  const t = useT()
  const respond = useChats((s) => s.respondPermission)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [feedback, setFeedback] = useState('')

  function allow(applySuggestions: boolean): void {
    void respond({ requestId: request.requestId, decision: 'allow', applySuggestions })
  }
  function deny(message?: string): void {
    void respond({ requestId: request.requestId, decision: 'deny', message })
  }
  // These buttons autoFocus; a stray Space while the card just appeared (still held from
  // e.g. scrolling) shouldn't approve. Enter via useCardHotkeys remains the approve shortcut.
  function blockSpace(e: KeyboardEvent): void {
    if (e.key === ' ') e.preventDefault()
  }

  useCardHotkeys(!feedbackOpen, { onEnter: () => allow(false), onEscape: () => deny() })

  const hasSuggestions = (request.suggestions?.length ?? 0) > 0 && !request.suppressAlwaysAllow

  return (
    <div className="em-ix-card em-ix-permission">
      <div className="em-ix-title">{permissionTitle(request)}</div>
      {request.description && <div className="em-ix-desc">{request.description}</div>}
      <div className="em-ix-preview">
        <PermissionPreview request={request} />
      </div>
      <div className="em-ix-actions">
        <Button variant="primary" autoFocus={!request.defaultToNo} onClick={() => allow(false)} onKeyDown={blockSpace}>
          {t('tools.perm.allow')}
        </Button>
        {hasSuggestions && (
          <Button variant="secondary" title={alwaysAllowHint(request.toolName)} onClick={() => allow(true)} onKeyDown={blockSpace}>
            {t('tools.perm.alwaysAllow')}
          </Button>
        )}
        <Button variant="ghost" autoFocus={request.defaultToNo} onClick={() => deny()} onKeyDown={blockSpace}>
          {t('tools.perm.deny')}
        </Button>
      </div>
      {!feedbackOpen ? (
        <button type="button" className="em-ix-feedback-link" onClick={() => setFeedbackOpen(true)}>
          {t('tools.perm.tellClaude')}
        </button>
      ) : (
        <div className="em-ix-feedback">
          <textarea
            autoFocus
            rows={3}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder={t('tools.perm.feedbackPlaceholder')}
          />
          <div className="em-ix-feedback-actions">
            <Button size="sm" variant="ghost" onClick={() => setFeedbackOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button size="sm" variant="primary" disabled={!feedback.trim()} onClick={() => deny(feedback.trim())}>
              {t('tools.perm.send')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
