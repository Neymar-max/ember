import { useState } from 'react'
import { useT } from '@/i18n'
import type { ToolCall } from '@/store/types'
import { contentToText } from '../toolContent'

interface BashStructured {
  stdout?: string
  stderr?: string
  interrupted?: boolean
  timedOutAfterMs?: number
  noOutputExpected?: boolean
}

function OutputBlock({ stdout, stderr }: { stdout: string; stderr: string }) {
  const t = useT()
  const [expanded, setExpanded] = useState(false)
  const stdoutLines = stdout ? stdout.split('\n') : []
  const stderrLines = stderr ? stderr.split('\n') : []
  const total = stdoutLines.length + stderrLines.length
  const limit = 20

  let shownStdout = stdoutLines
  let shownStderr = stderrLines
  if (!expanded && total > limit) {
    if (stdoutLines.length >= limit) {
      shownStdout = stdoutLines.slice(0, limit)
      shownStderr = []
    } else {
      shownStdout = stdoutLines
      shownStderr = stderrLines.slice(0, limit - stdoutLines.length)
    }
  }

  return (
    <div className="em-tool-output">
      {shownStdout.length > 0 && <pre className="em-tool-stdout">{shownStdout.join('\n')}</pre>}
      {shownStderr.length > 0 && <pre className="em-tool-stderr">{shownStderr.join('\n')}</pre>}
      {!expanded && total > limit && (
        <button type="button" className="em-tool-more" onClick={() => setExpanded(true)}>
          {t('tools.bash.showAll', { n: total })}
        </button>
      )}
    </div>
  )
}

export function BashBody({ tool }: { tool: ToolCall }) {
  const t = useT()
  const input = tool.input ?? {}
  const structured = tool.structured as BashStructured | undefined
  const command = typeof input.command === 'string' ? input.command : ''
  const description = typeof input.description === 'string' ? input.description : ''

  const resultText = contentToText(tool.result?.content)
  const stdout = structured?.stdout ?? (tool.result?.isError ? '' : resultText)
  const stderr = structured?.stderr ?? (tool.result?.isError ? resultText : '')

  return (
    <div className="em-tool-bash">
      {description && <div className="em-tool-bash-desc">{description}</div>}
      <pre className="em-tool-cmd">$ {command}</pre>
      {stdout || stderr ? (
        <OutputBlock stdout={stdout} stderr={stderr} />
      ) : (
        <div className="em-tool-empty">{t('tools.bash.noOutput')}</div>
      )}
      {structured?.interrupted && <div className="em-tool-note">{t('tools.bash.interrupted')}</div>}
      {structured?.timedOutAfterMs != null && <div className="em-tool-note">{t('tools.bash.timedOut')}</div>}
    </div>
  )
}
