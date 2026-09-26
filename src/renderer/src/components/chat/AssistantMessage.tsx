/** One assistant turn, Claude-app style: Claude's own words flow as prose, and every run of
 * thinking / tool calls between them folds into one grey line ("运行了 2 条命令 +85 -0 ›") that
 * opens to show the individual steps. */
import clsx from 'clsx'
import { ChevronRight } from 'lucide-react'
import { memo, useMemo, useState } from 'react'
import { useT } from '@/i18n'
import { formatDuration } from '@/lib/format'
import { summarizeSteps } from '@/lib/steps'
import { thinkingHeadline } from '@/lib/thinking'
import { editLineChangeCount } from '@/components/tools/toolDisplay'
import { useChats } from '@/store/chats'
import { useApp } from '@/store/app'
import { ToolRow } from '@/components/tools/ToolRow'
import type { ChatItem, Part, TurnResult } from '@/store/types'
import { Markdown } from './Markdown'
import { RunningIndicator } from './RunningIndicator'
import { Thinking } from './Thinking'
import { TurnFooter } from './TurnFooter'
import './AssistantMessage.css'

export interface AssistantMessageProps {
  chatId: string
  item: Extract<ChatItem, { kind: 'assistant' }>
  isLast: boolean
  isRunning: boolean
  /** the `result` item immediately following this one in the transcript, if any (attached so the
   * footer and the reply it summarizes read — and hover — as one visual block). */
  result?: TurnResult
}

function collectText(parts: Part[]): string {
  return parts
    .filter((p): p is Extract<Part, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('\n\n')
}

const PartView = memo(function PartView({ chatId, part }: { chatId: string; part: Part }) {
  if (part.type === 'text') return <Markdown text={part.text} variant="message" streaming={part.streaming} />
  if (part.type === 'thinking') return <Thinking text={part.text} streaming={part.streaming} tokens={part.tokens} />
  return <ToolRow chatId={chatId} toolUseId={part.toolUseId} />
})

type Block = { kind: 'text'; part: Extract<Part, { type: 'text' }> } | { kind: 'steps'; id: string; parts: Part[] }

/** Text parts stay as prose; each run of thinking/tool parts between them becomes one step line. */
export function toBlocks(parts: Part[]): Block[] {
  const out: Block[] = []
  for (const p of parts) {
    if (p.type === 'text') {
      if (p.text.trim() || p.streaming) out.push({ kind: 'text', part: p })
      continue
    }
    const last = out[out.length - 1]
    if (last?.kind === 'steps') last.parts.push(p)
    else out.push({ kind: 'steps', id: p.id, parts: [p] })
  }
  return out
}

function StepGroup({ chatId, parts, live }: { chatId: string; parts: Part[]; live: boolean }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const allTools = useChats((s) => s.chats[chatId]?.tools)
  const tools = parts.flatMap((p) => (p.type === 'tool' && allTools?.[p.toolUseId] ? [allTools[p.toolUseId]] : []))
  const lastThinking = [...parts].reverse().find((p): p is Extract<Part, { type: 'thinking' }> => p.type === 'thinking')

  let label = tools.length ? summarizeSteps(tools, t) : t('chat.steps.thinking')
  // While the model is still thinking at the tail of this group, show what it's thinking about.
  if (live && lastThinking?.streaming && parts[parts.length - 1] === lastThinking) {
    label = thinkingHeadline(lastThinking.text, true) || t('chat.thinking.streaming')
  }
  let add = 0
  let del = 0
  for (const tc of tools) {
    if (tc.name !== 'Edit' && tc.name !== 'MultiEdit' && tc.name !== 'Write') continue
    const c = editLineChangeCount(tc)
    // A brand-new file has no patch — count its lines as added.
    if (tc.name === 'Write' && c.add + c.del === 0 && typeof tc.input?.content === 'string') c.add = tc.input.content.replace(/\n$/, '').split('\n').length
    add += c.add
    del += c.del
  }
  const failed = tools.filter((tc) => tc.status === 'error' || tc.status === 'denied').length

  return (
    <div className={clsx('em-chat-steps', open && 'is-open')}>
      <button type="button" className="em-chat-steps__head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className={clsx('em-chat-steps__label', live && 'is-shimmer')}>{label}</span>
        {(add > 0 || del > 0) && (
          <span className="em-chat-steps__diff">
            <span className="is-add">+{add}</span>
            <span className="is-del">-{del}</span>
          </span>
        )}
        {failed > 0 && <span className="em-chat-steps__failed">{t('chat.steps.failed', { n: failed })}</span>}
        <ChevronRight size={14} strokeWidth={1.75} className="em-chat-steps__chev" />
      </button>
      {open && (
        <div className="em-chat-steps__body">
          {parts.map((part) => (
            <PartView key={part.id} chatId={chatId} part={part} />
          ))}
        </div>
      )}
    </div>
  )
}

export const AssistantMessage = memo(function AssistantMessage({ chatId, item, isLast, isRunning, result }: AssistantMessageProps) {
  const t = useT()
  const fullText = useMemo(() => collectText(item.parts), [item.parts])
  const lastPart = item.parts[item.parts.length - 1]
  const active = isRunning && isLast
  const showRunning = active && !(lastPart?.type === 'text' && lastPart.streaming)
  const showThinking = useApp((s) => s.settings.showThinking)
  // Thinking that won't render (setting off, or a finished block with no summary) is dropped.
  const parts = item.parts.filter((p) => p.type !== 'thinking' || (showThinking && (p.streaming || p.text.trim() !== '')))
  const blocks = toBlocks(parts)
  // Final answer = the prose after the last step line. Once the turn is over, everything before it
  // (notes + step lines) folds into one line so only the conclusion stays in view.
  let cut = blocks.length
  while (cut > 0 && blocks[cut - 1].kind === 'text') cut--
  const foldable = !active && cut > 0 && cut < blocks.length && blocks.slice(0, cut).some((b) => b.kind === 'steps')
  const [unfolded, setUnfolded] = useState(false)
  const renderBlock = (b: Block, i: number) =>
    b.kind === 'text' ? (
      <PartView key={b.part.id} chatId={chatId} part={b.part} />
    ) : (
      <StepGroup key={b.id} chatId={chatId} parts={b.parts} live={active && i === blocks.length - 1} />
    )
  const stepCount = blocks.slice(0, cut).reduce((n, b) => n + (b.kind === 'steps' ? b.parts.filter((p) => p.type === 'tool').length : 0), 0)

  return (
    <div className="em-chat-assistant">
      {foldable ? (
        <>
          <button type="button" className={clsx('em-chat-fold', unfolded && 'is-open')} aria-expanded={unfolded} onClick={() => setUnfolded(!unfolded)}>
            <span>
              {result?.durationMs
                ? t('chat.fold.labelFor', { d: formatDuration(result.durationMs), n: stepCount })
                : t('chat.fold.label', { n: stepCount })}
            </span>
            <ChevronRight size={14} strokeWidth={1.75} className="em-chat-fold__chev" />
          </button>
          {unfolded && <div className="em-chat-fold__body">{blocks.slice(0, cut).map(renderBlock)}</div>}
          {blocks.slice(cut).map((b, i) => renderBlock(b, cut + i))}
        </>
      ) : (
        blocks.map(renderBlock)
      )}
      {showRunning && <RunningIndicator chatId={chatId} />}
      {result && <TurnFooter result={result} getFullText={() => fullText} forceVisible={isLast} />}
    </div>
  )
})
