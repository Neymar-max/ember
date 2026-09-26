import { useMemo, useState } from 'react'
import clsx from 'clsx'
import type { PermissionRequest } from '@shared/types'
import { useChats } from '@/store/chats'
import { useT } from '@/i18n'
import { Button } from '@/components/common/Button'
import { useCardHotkeys } from './useCardHotkeys'
import './QuestionCard.css'

interface QuestionOption {
  label: string
  description: string
  preview?: string
}
interface QuestionDef {
  question: string
  header: string
  options: QuestionOption[]
  multiSelect?: boolean
}

interface PerQuestionState {
  choice: Set<string>
  other: string
}

/** Pending AskUserQuestion card. The answered version, once submitted, is rendered as an
 * ordinary transcript row by tools/bodies/AskUserQuestionBody. */
export function QuestionCard({ request }: { request: PermissionRequest }) {
  const t = useT()
  const respond = useChats((s) => s.respondPermission)
  const questions = useMemo(() => {
    const raw = (request.input as { questions?: unknown } | undefined)?.questions
    return Array.isArray(raw) ? (raw as QuestionDef[]) : []
  }, [request.input])

  const [state, setState] = useState<PerQuestionState[]>(() => questions.map(() => ({ choice: new Set<string>(), other: '' })))

  function toggleOption(qi: number, label: string, multi: boolean): void {
    setState((prev) => {
      const next = [...prev]
      const cur = new Set(next[qi].choice)
      if (multi) {
        if (cur.has(label)) cur.delete(label)
        else cur.add(label)
      } else {
        cur.clear()
        cur.add(label)
      }
      next[qi] = { choice: cur, other: '' }
      return next
    })
  }
  function setOther(qi: number, text: string): void {
    setState((prev) => {
      const next = [...prev]
      next[qi] = { choice: text ? new Set() : next[qi].choice, other: text }
      return next
    })
  }

  const answers = useMemo(() => {
    const out: Record<string, string> = {}
    questions.forEach((q, i) => {
      const st = state[i]
      if (!st) return
      const val = st.other.trim() || Array.from(st.choice).join(', ')
      if (val) out[q.question] = val
    })
    return out
  }, [state, questions])

  const canSubmit = questions.length > 0 && questions.every((q) => Boolean(answers[q.question]))

  function submit(): void {
    if (!canSubmit) return
    void respond({
      requestId: request.requestId,
      decision: 'allow',
      updatedInput: { ...(request.input ?? {}), answers },
    })
  }
  function skip(): void {
    void respond({ requestId: request.requestId, decision: 'deny', message: 'The user declined to answer.' })
  }

  useCardHotkeys(true, { onEnter: submit, onEscape: skip })

  return (
    <div className="em-ix-card em-ix-question">
      {questions.map((q, qi) => (
        <div key={qi} className="em-ix-q">
          <div className="em-ix-q-header">{q.header}</div>
          <div className="em-ix-q-text">{q.question}</div>
          <div className="em-ix-q-options">
            {q.options.map((opt) => {
              const selected = state[qi]?.choice.has(opt.label) ?? false
              return (
                <div key={opt.label} className="em-ix-q-option-wrap">
                  <button
                    type="button"
                    className={clsx('em-ix-q-option', q.multiSelect ? 'is-checkbox' : 'is-radio', selected && 'is-selected')}
                    onClick={() => toggleOption(qi, opt.label, Boolean(q.multiSelect))}
                  >
                    <span className="em-ix-q-option-mark" />
                    <span className="em-ix-q-option-body">
                      <span className="em-ix-q-option-label">{opt.label}</span>
                      <span className="em-ix-q-option-desc">{opt.description}</span>
                    </span>
                  </button>
                  {selected && opt.preview && (
                    // Preview HTML is model-authored, untrusted markup — sandboxed with
                    // scripts disabled (SPEC 4.3: "render in an iframe, no scripts").
                    <iframe className="em-ix-q-preview" sandbox="" srcDoc={opt.preview} title={opt.label} />
                  )}
                </div>
              )
            })}
          </div>
          <input
            className="em-ix-q-other"
            placeholder={t('tools.ask.otherPlaceholder')}
            value={state[qi]?.other ?? ''}
            onChange={(e) => setOther(qi, e.target.value)}
          />
        </div>
      ))}
      <div className="em-ix-actions">
        <Button variant="primary" disabled={!canSubmit} onClick={submit}>
          {t('tools.ask.submit')}
        </Button>
        <Button variant="ghost" onClick={skip}>
          {t('tools.ask.skip')}
        </Button>
      </div>
    </div>
  )
}
