/** Scrollable message list for one chat (§4.1/§4.2): auto-follows new content near the bottom,
 * offers a "scroll to bottom" button once the user scrolls away, and resets to the bottom on
 * chat switch. Consecutive assistant + (non-error) result items render as one visual reply so
 * hovering the text reveals the copy/duration/tokens footer right where it belongs. */
import type { ReactNode } from 'react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { formatTokens } from '@/lib/format'
import { useT } from '@/i18n'
import { useChat } from '@/store/chats'
import type { ChatItem } from '@/store/types'
import { AssistantMessage } from './AssistantMessage'
import './ChatView.css'
import { Notice } from './Notice'
import { ScrollToBottom } from './ScrollToBottom'
import { TurnFooter } from './TurnFooter'
import { UserMessage } from './UserMessage'

const FOLLOW_THRESHOLD_PX = 80
// R4: very long transcripts mount every item, which is expensive even with content-visibility.
// Render only the tail window and let "show earlier" grow it 150 at a time.
const INITIAL_WINDOW = 150
const WINDOW_STEP = 150

function renderStandaloneItem(item: ChatItem, isLast: boolean, t: ReturnType<typeof useT>): ReactNode {
  switch (item.kind) {
    case 'user':
      return <UserMessage item={item} />
    case 'notice':
      return <Notice item={item} />
    case 'result':
      return <TurnFooter result={item.result} getFullText={() => ''} forceVisible={isLast} standalone />
    case 'compact':
      return (
        <div className="em-chat-compact">
          <span>{item.preTokens != null ? t('chat.compact.label', { pre: formatTokens(item.preTokens), post: formatTokens(item.postTokens ?? 0) }) : t('chat.compact.labelUnknown')}</span>
        </div>
      )
    case 'command-output':
      return <pre className="em-chat-command-output em-mono">{item.text}</pre>
    default:
      return null
  }
}

export function ChatView({ chatId }: { chatId: string }) {
  const t = useT()
  const chat = useChat(chatId)
  const items = chat?.items ?? []
  const scrollerRef = useRef<HTMLDivElement>(null)
  const followRef = useRef(true)
  const [showJump, setShowJump] = useState(false)
  const prevChatIdRef = useRef<string | null>(null)
  // While following the bottom, the window trails the newest INITIAL_WINDOW items. Once the user
  // scrolls away (or asks for earlier messages) the start index is frozen so streaming can't shift
  // content under them; returning to the bottom unfreezes it.
  const [frozenStart, setFrozenStart] = useState<number | null>(null)
  // Captured scrollHeight right before "show earlier" grows the window, so the layout effect below
  // can add back exactly the height the newly-mounted older items inserted above the fold.
  const pendingScrollAdjustRef = useRef<number | null>(null)

  let windowStart = Math.min(items.length, frozenStart ?? Math.max(0, items.length - INITIAL_WINDOW))
  // Never cut between a reply and the result footer attached to it.
  if (windowStart > 0 && items[windowStart]?.kind === 'result' && items[windowStart - 1]?.kind === 'assistant') windowStart -= 1
  const windowStartRef = useRef(windowStart)
  windowStartRef.current = windowStart
  const hiddenCount = windowStart
  const visibleItems = windowStart > 0 ? items.slice(windowStart) : items

  const showEarlier = () => {
    const el = scrollerRef.current
    if (el) pendingScrollAdjustRef.current = el.scrollHeight
    setFrozenStart(Math.max(0, windowStart - WINDOW_STEP))
  }

  const rendered = useMemo(() => {
    const nodes: { key: string; node: ReactNode }[] = []
    for (let i = 0; i < visibleItems.length; i++) {
      const item = visibleItems[i]
      if (item.kind === 'assistant') {
        const next = visibleItems[i + 1]
        const attach = next && next.kind === 'result' && !next.result.isError ? next : undefined
        const lastIndex = attach ? i + 1 : i
        nodes.push({
          key: item.id,
          node: (
            <AssistantMessage chatId={chatId} item={item} isLast={lastIndex === visibleItems.length - 1} isRunning={chat?.status === 'running'} result={attach?.result} />
          ),
        })
        if (attach) i++
        continue
      }
      nodes.push({ key: item.id, node: renderStandaloneItem(item, i === visibleItems.length - 1, t) })
    }
    return nodes
  }, [visibleItems, chatId, chat?.status, t])

  const scrollToBottom = (smooth = false) => {
    const el = scrollerRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
    followRef.current = true
    setShowJump(false)
  }

  // Switching chats always resets to the bottom, forgets the previous chat's scroll state, and
  // resets the item window (R4) since it applied to a different transcript.
  useLayoutEffect(() => {
    if (prevChatIdRef.current !== chatId) {
      prevChatIdRef.current = chatId
      followRef.current = true
      setShowJump(false)
      setFrozenStart(null)
      pendingScrollAdjustRef.current = null
      scrollToBottom(false)
    }
  }, [chatId])

  // New content: auto-follow only while the user hasn't scrolled away from the bottom.
  useLayoutEffect(() => {
    if (followRef.current) scrollToBottom(false)
  }, [items])

  // After "show earlier" grows the window, the older items just mounted above the fold pushed
  // everything else down by their height — add that same amount back to scrollTop so the content
  // the user was looking at stays in the same place on screen (R4).
  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (!el || pendingScrollAdjustRef.current == null) return
    el.scrollTop += el.scrollHeight - pendingScrollAdjustRef.current
    pendingScrollAdjustRef.current = null
  }, [frozenStart])

  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const onScroll = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < FOLLOW_THRESHOLD_PX
      if (atBottom !== followRef.current) setFrozenStart(atBottom ? null : windowStartRef.current)
      followRef.current = atBottom
      setShowJump(!atBottom && el.scrollHeight > el.clientHeight + FOLLOW_THRESHOLD_PX)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <div className="em-chat-view">
      <div className="em-chat-view__scroller em-selectable" ref={scrollerRef}>
        <div className="em-chat-view__content">
          {hiddenCount > 0 && (
            <button type="button" className="em-chat-view__older" onClick={showEarlier}>
              {t('chat.olderMessages', { n: hiddenCount })}
            </button>
          )}
          {rendered.map(({ key, node }) => (
            <div key={key} className="em-chat-item">
              {node}
            </div>
          ))}
          {chat?.queued?.map((q) => (
            <div key={q.id} className="em-chat-item">
              <UserMessage item={q} />
            </div>
          ))}
        </div>
      </div>
      {showJump && <ScrollToBottom onClick={() => scrollToBottom(true)} />}
    </div>
  )
}
