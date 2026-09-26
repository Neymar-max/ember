/**
 * The message input (§4.4). Owns text/attachment/menu state locally; talks to the ChatsStore
 * only to read chat config (model/mode/effort/draft) and to call send/interrupt/setters.
 */
import clsx from 'clsx'
import { ArrowUp, Plus, Square } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react'
import { IconButton } from '@/components/common/Button'
import { useT } from '@/i18n'
import { ember } from '@/lib/api'
import { useApp } from '@/store/app'
import { useChats } from '@/store/chats'
import type { ModelOption, EffortChoice, FileSuggestion, ImageAttachment, PermissionMode, SlashCommandInfo } from '@shared/types'
import { Attachments } from './Attachments'
import './Composer.css'
import { MentionMenu } from './MentionMenu'
import { EffortPicker } from './EffortPicker'
import { ModelPicker } from './ModelPicker'
import { UsageRing } from './UsageRing'
import { PermissionModePicker } from './PermissionModePicker'
import { SlashMenu } from './SlashMenu'

const NO_MODELS: ModelOption[] = []

const MAX_IMAGES = 10
// Mirrors the allowlist `sys.pickImages` enforces in the main process (S8) — applied here too
// since paste/drop never go through that IPC call.
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

/** Find the "/command" being typed on the current line, if the caret sits right after it.
 * Allows ':' and '.' so plugin/namespaced commands (e.g. "/plugin:cmd") keep matching. */
function findSlashQuery(text: string, caret: number): string | null {
  const lineStart = text.lastIndexOf('\n', caret - 1) + 1
  const line = text.slice(lineStart, caret)
  const m = /^\/([\w:.-]*)$/.exec(line)
  return m ? m[1] : null
}

/** Find the "@mention" being typed right before the caret, if any. Requires a word boundary
 * (start-of-text or whitespace) right before the '@' so e.g. "a@b.com" doesn't hijack it. */
function findMentionQuery(text: string, caret: number): { query: string; start: number } | null {
  const before = text.slice(0, caret)
  const m = /(^|\s)@([^\s@]*)$/.exec(before)
  if (!m) return null
  return { query: m[2], start: m.index + m[1].length }
}

function fileToImageAttachment(file: File): Promise<ImageAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result || '')
      const base64 = result.slice(result.indexOf(',') + 1)
      resolve({ mediaType: file.type || 'image/png', data: base64, name: file.name })
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export function Composer({ chatId, variant }: { chatId: string; variant: 'docked' | 'centered' }) {
  const t = useT()
  const settings = useApp((s) => s.settings)
  const envModels = useApp((s) => s.env?.models ?? NO_MODELS)
  const cliDefaultModel = useApp((s) => s.env?.defaultModel)
  const modelEffortDefaults = useApp((s) => s.env?.modelEffortDefaults)
  const defaultEffortLevel = useApp((s) => s.env?.defaultEffortLevel)
  const envCommands = useApp((s) => s.env?.commands ?? [])
  // Narrowed to primitives (S9): subscribing to the whole ChatState would re-render the
  // composer on every streamed token, not just when these specific fields change.
  const draft = useChats((s) => s.chats[chatId]?.draft)
  const cwdFromChat = useChats((s) => s.chats[chatId]?.cwd)
  const status = useChats((s) => s.chats[chatId]?.status)
  const permissionMode = useChats((s) => s.chats[chatId]?.permissionMode)
  const modelFromChat = useChats((s) => s.chats[chatId]?.model)
  const effortFromChat = useChats((s) => s.chats[chatId]?.effort)
  const slashCommandsFromChat = useChats((s) => s.chats[chatId]?.slashCommands)
  const pendingCount = useChats((s) => s.chats[chatId]?.pendingPermissions.length ?? 0)

  const [text, setText] = useState(draft ?? '')
  const [images, setImages] = useState<ImageAttachment[]>([])
  const [imageError, setImageError] = useState<string | null>(null)
  const [slashOpen, setSlashOpen] = useState(false)
  const [slashIndex, setSlashIndex] = useState(0)
  const [mentionOpen, setMentionOpen] = useState(false)
  const [mentionIndex, setMentionIndex] = useState(0)
  const [mentionItems, setMentionItems] = useState<FileSuggestion[]>([])
  const mentionRangeRef = useRef<{ start: number; end: number } | null>(null)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const composerRef = useRef<HTMLDivElement>(null)
  const loadedForChatId = useRef<string | null>(null)

  const cwd = cwdFromChat || settings.lastProject || useApp.getState().appInfo?.homeDir || ''
  const running = status === 'running' || status === 'starting'
  const mode: PermissionMode = permissionMode ?? settings.defaultPermissionMode
  const model = modelFromChat ?? (settings.defaultModel || undefined)
  // Before the chat exists (lazy creation) show the global default; afterwards the chat's own value,
  // where undefined means "CLI default" (e.g. right after 恢复默认).
  const effort = status !== undefined ? effortFromChat : settings.defaultEffort || undefined

  // Reload the draft when switching chats (each chat keeps its own draft server-side).
  useEffect(() => {
    if (loadedForChatId.current === chatId) return
    loadedForChatId.current = chatId
    setText(draft ?? '')
    setImages([])
  }, [chatId, draft])

  // Briefly surface rejected paste/drop images, then clear.
  useEffect(() => {
    if (!imageError) return
    const id = window.setTimeout(() => setImageError(null), 4000)
    return () => window.clearTimeout(id)
  }, [imageError])

  // Autosize 1–12 lines.
  useLayoutEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
    // Only show a scrollbar once the 12-line cap is reached (otherwise a stray thumb appears).
    el.style.overflowY = el.scrollHeight > el.clientHeight + 1 ? 'auto' : 'hidden'
  }, [text])

  // Menu commands / suggestion chips can ask us to focus or fill this composer.
  useEffect(() => {
    const onFocus = () => textareaRef.current?.focus()
    const onFill = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail
      setText((cur) => (cur ? `${cur} ${detail}` : detail))
      textareaRef.current?.focus()
    }
    document.addEventListener('ember:focus-composer', onFocus)
    document.addEventListener('ember:fill-composer', onFill)
    return () => {
      document.removeEventListener('ember:focus-composer', onFocus)
      document.removeEventListener('ember:fill-composer', onFill)
    }
  }, [])

  // debounce @ file suggestions
  useEffect(() => {
    if (!mentionOpen) return
    const range = mentionRangeRef.current
    if (!range) return
    const query = text.slice(range.start + 1, range.end)
    const id = window.setTimeout(() => {
      void ember.files.suggest(cwd, query).then(setMentionItems)
    }, 120)
    return () => window.clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mentionOpen, text, cwd])

  const slashCommands: SlashCommandInfo[] = (() => {
    if (!slashOpen) return []
    const byName = new Map<string, SlashCommandInfo>()
    for (const c of envCommands) byName.set(c.name, c)
    for (const name of slashCommandsFromChat ?? []) if (!byName.has(name)) byName.set(name, { name, description: '' })
    const caret = textareaRef.current?.selectionStart ?? text.length
    const query = (findSlashQuery(text, caret) ?? '').toLowerCase()
    return [...byName.values()].filter((c) => c.name.toLowerCase().includes(query)).slice(0, 30)
  })()

  function updateMenusFromCaret(nextText: string, caret: number) {
    const slashQ = findSlashQuery(nextText, caret)
    if (slashQ !== null) {
      setSlashOpen(true)
      setSlashIndex(0)
    } else {
      setSlashOpen(false)
    }
    const mention = findMentionQuery(nextText, caret)
    if (mention) {
      setMentionOpen(true)
      setMentionIndex(0)
      mentionRangeRef.current = { start: mention.start, end: caret }
    } else {
      setMentionOpen(false)
      mentionRangeRef.current = null
    }
  }

  function handleChange(e: ChangeEvent<HTMLTextAreaElement>) {
    const next = e.target.value
    setText(next)
    if (chatId) useChats.getState().setDraft(chatId, next)
    updateMenusFromCaret(next, e.target.selectionStart)
  }

  function insertAt(start: number, end: number, insertion: string) {
    const next = text.slice(0, start) + insertion + text.slice(end)
    setText(next)
    if (chatId) useChats.getState().setDraft(chatId, next)
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(start + insertion.length, start + insertion.length)
    })
  }

  function selectSlashCommand(cmd: SlashCommandInfo) {
    const caret = textareaRef.current?.selectionStart ?? text.length
    const lineStart = text.lastIndexOf('\n', caret - 1) + 1
    insertAt(lineStart, caret, `/${cmd.name} `)
    setSlashOpen(false)
  }

  function selectMention(item: FileSuggestion) {
    const range = mentionRangeRef.current
    if (!range) return
    insertAt(range.start, range.end, `@${item.path} `)
    setMentionOpen(false)
  }

  async function addImages(files: File[] | ImageAttachment[]) {
    const room = MAX_IMAGES - images.length
    if (room <= 0) {
      setImageError(t('shell.composer.tooManyImages'))
      return
    }
    // Same size/type allowlist as sys.pickImages (S8) — paste/drop never go through that IPC call.
    let rejected = false
    const accepted: (File | ImageAttachment)[] = []
    for (const f of files) {
      if (f instanceof File && (f.size > MAX_IMAGE_BYTES || !ALLOWED_IMAGE_TYPES.has(f.type))) {
        rejected = true
        continue
      }
      accepted.push(f)
    }
    if (accepted.length > room) rejected = true
    const picked = accepted.slice(0, room)
    const converted: ImageAttachment[] = []
    for (const f of picked) {
      converted.push(f instanceof File ? await fileToImageAttachment(f) : f)
    }
    setImages((cur) => [...cur, ...converted].slice(0, MAX_IMAGES))
    setImageError(rejected ? t('shell.composer.imageRejected') : null)
  }

  function doSend() {
    if (!canSend()) return
    let id = chatId
    if (!id) id = useChats.getState().newChat(cwd)
    void useChats.getState().send(id, text, images.length ? images : undefined)
    setText('')
    setImages([])
    setSlashOpen(false)
    setMentionOpen(false)
    if (id) useChats.getState().setDraft(id, '')
  }

  function canSend(): boolean {
    return text.trim().length > 0 || images.length > 0
  }

  function recallLastMessage() {
    // Read imperatively (not subscribed) — this only runs on an ArrowUp keypress, so it
    // doesn't need to be part of the render subscription (S9).
    const items = useChats.getState().chats[chatId]?.items
    if (!items) return
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i]
      if (item.kind === 'user' && !item.command) {
        setText(item.text)
        requestAnimationFrame(() => {
          const el = textareaRef.current
          if (el) el.setSelectionRange(item.text.length, item.text.length)
        })
        return
      }
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return // IME composition in progress

    if (slashOpen && slashCommands.length > 0 && ['ArrowDown', 'ArrowUp', 'Enter', 'Tab'].includes(e.key)) {
      e.preventDefault()
      if (e.key === 'ArrowDown') setSlashIndex((i) => (i + 1) % slashCommands.length)
      else if (e.key === 'ArrowUp') setSlashIndex((i) => (i - 1 + slashCommands.length) % slashCommands.length)
      else selectSlashCommand(slashCommands[slashIndex])
      return
    }
    if (mentionOpen && mentionItems.length > 0 && ['ArrowDown', 'ArrowUp', 'Enter', 'Tab'].includes(e.key)) {
      e.preventDefault()
      if (e.key === 'ArrowDown') setMentionIndex((i) => (i + 1) % mentionItems.length)
      else if (e.key === 'ArrowUp') setMentionIndex((i) => (i - 1 + mentionItems.length) % mentionItems.length)
      else selectMention(mentionItems[mentionIndex])
      return
    }

    const hasPendingCard = pendingCount > 0 && text === ''

    if (e.key === 'Escape') {
      // A pending permission card owns Esc (deny) while the composer is empty — don't also
      // interrupt the turn (S1). Don't preventDefault either: let the event reach the card's
      // own window-level hotkey (useCardHotkeys).
      if (hasPendingCard) return
      e.preventDefault()
      if (running && chatId) void useChats.getState().interrupt(chatId)
      else textareaRef.current?.blur()
      return
    }

    if (e.key === 'ArrowUp' && text === '' && (e.target as HTMLTextAreaElement).selectionStart === 0) {
      e.preventDefault()
      recallLastMessage()
      return
    }

    // Likewise, plain Enter in an empty composer with a pending card is the card's "allow"
    // shortcut, not "send" (there's nothing to send) — don't preventDefault so it can reach it.
    if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey && hasPendingCard) return

    const sendOnEnter = settings.sendKey === 'enter'
    if (e.key === 'Enter' && !e.shiftKey && sendOnEnter && !e.metaKey && !e.ctrlKey) {
      e.preventDefault()
      doSend()
    } else if (e.key === 'Enter' && !sendOnEnter && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      doSend()
    }
  }

  async function handlePaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const files = [...e.clipboardData.items].filter((it) => it.type.startsWith('image/')).map((it) => it.getAsFile()).filter((f): f is File => !!f)
    if (files.length === 0) return
    e.preventDefault()
    await addImages(files)
  }

  async function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    const imageFiles = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'))
    if (imageFiles.length > 0) await addImages(imageFiles)
    // Other files/folders become @path mentions, like dragging a file into the terminal CLI.
    const paths = [...e.dataTransfer.files]
      .filter((f) => !f.type.startsWith('image/'))
      .map((f) => ember.files.pathForFile(f))
      .filter(Boolean)
    if (paths.length > 0) {
      const caret = textareaRef.current?.selectionStart ?? text.length
      const before = text.slice(0, caret)
      const insertion = (before && !/\s$/.test(before) ? ' ' : '') + paths.map((p) => `@${p}`).join(' ') + ' '
      insertAt(caret, caret, insertion)
    }
  }

  const placeholder = variant === 'centered' || status === 'new' ? t('shell.composer.placeholderNew') : t('shell.composer.placeholder')
  const showStop = running && text.trim() === ''

  return (
    <div
      ref={composerRef}
      className={clsx('em-composer', variant === 'docked' && 'em-composer--docked')}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => void handleDrop(e)}
    >
      <textarea
        ref={textareaRef}
        className="em-composer__textarea em-selectable"
        rows={1}
        value={text}
        placeholder={placeholder}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onPaste={(e) => void handlePaste(e)}
      />
      <Attachments images={images} onRemove={(i) => setImages((cur) => cur.filter((_, idx) => idx !== i))} />
      {imageError && <div className="em-composer__notice">{imageError}</div>}
      <div className="em-composer__toolbar em-no-drag">
        <div className="em-composer__toolbar-left">
          <IconButton label={t('shell.composer.attach')} onClick={() => void ember.sys.pickImages().then(addImages)}>
            <Plus size={16} strokeWidth={1.75} />
          </IconButton>
          <PermissionModePicker
            mode={mode}
            onChange={(m) => {
              if (chatId) void useChats.getState().setPermissionMode(chatId, m)
            }}
          />
        </div>
        <div className="em-composer__toolbar-right">
          <ModelPicker
            models={envModels}
            model={model}
            cliDefault={cliDefaultModel}
            effort={effort}
            onModelChange={(m) => {
              if (chatId) void useChats.getState().setModel(chatId, m)
            }}
            onEffortChange={(ef: EffortChoice | undefined) => {
              if (chatId) void useChats.getState().setEffort(chatId, ef)
            }}
          />
          <EffortPicker
            models={envModels}
            model={model}
            cliDefault={cliDefaultModel}
            effort={effort}
            effortDefaults={modelEffortDefaults}
            defaultEffortLevel={defaultEffortLevel}
            onEffortChange={(ef: EffortChoice | undefined) => {
              if (chatId) void useChats.getState().setEffort(chatId, ef)
            }}
          />
          <UsageRing chatId={chatId || null} />
          <button
            type="button"
            className={clsx('em-composer__send', showStop && 'em-composer__send--stop')}
            disabled={!showStop && !canSend()}
            aria-label={showStop ? t('shell.composer.stop') : t('shell.composer.send')}
            onClick={() => {
              if (showStop) {
                if (chatId) void useChats.getState().interrupt(chatId)
              } else {
                doSend()
              }
            }}
          >
            {showStop ? <Square size={13} strokeWidth={0} fill="currentColor" /> : <ArrowUp size={16} strokeWidth={2} />}
          </button>
        </div>
      </div>

      <SlashMenu
        open={slashOpen}
        anchorRef={textareaRef}
        commands={slashCommands}
        activeIndex={slashIndex}
        onHover={setSlashIndex}
        onSelect={selectSlashCommand}
        onClose={() => setSlashOpen(false)}
      />
      <MentionMenu
        open={mentionOpen}
        anchorRef={textareaRef}
        items={mentionItems}
        activeIndex={mentionIndex}
        onHover={setMentionIndex}
        onSelect={selectMention}
        onClose={() => setMentionOpen(false)}
      />
    </div>
  )
}
