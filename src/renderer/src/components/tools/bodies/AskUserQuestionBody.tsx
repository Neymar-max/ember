import type { ToolCall } from '@/store/types'
import { useT } from '@/i18n'

interface QuestionDef {
  question: string
  header?: string
}
interface AskInput {
  questions?: QuestionDef[]
}
interface AskStructured {
  answers?: Record<string, string>
}

/** Transcript-time display of an already-answered AskUserQuestion call: the question(s) and
 * the answer the user picked. The *pending* version lives in interactive/QuestionCard. */
export function AskUserQuestionBody({ tool }: { tool: ToolCall }) {
  const t = useT()
  const input = tool.input as AskInput | undefined
  const questions = input?.questions ?? []
  const answers = (tool.structured as AskStructured | undefined)?.answers

  if (questions.length === 0) return <div className="em-tool-empty">{t('tools.generic.empty')}</div>

  return (
    <div className="em-tool-ask">
      {questions.map((q, i) => (
        <div key={i} className="em-tool-ask-item">
          {q.header && <div className="em-tool-ask-header">{q.header}</div>}
          <div className="em-tool-ask-q">{q.question}</div>
          <div className="em-tool-ask-a">{answers?.[q.question] ?? t('tools.ask.noAnswer')}</div>
        </div>
      ))}
    </div>
  )
}
