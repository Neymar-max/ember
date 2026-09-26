/**
 * Defensive helpers for reading tool_result content and structured output.
 * SDK content can be a plain string, an array of content blocks, or (for historical /
 * malformed data) something else entirely — every helper here tolerates that.
 */

export interface ImageBlock {
  mediaType: string
  dataUrl: string
}

/** Flatten a tool_result `content` value (string | content-block[] | anything) into plain text. */
export function contentToText(content: unknown): string {
  if (content == null) return ''
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === 'string') return block
        if (block && typeof block === 'object') {
          const b = block as Record<string, unknown>
          if (b.type === 'text' && typeof b.text === 'string') return b.text
        }
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }
  try {
    return JSON.stringify(content, null, 2)
  } catch {
    return String(content)
  }
}

/** Extract base64 image blocks (if any) as ready-to-render data URLs. */
export function contentImages(content: unknown): ImageBlock[] {
  if (!Array.isArray(content)) return []
  const out: ImageBlock[] = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    const b = block as Record<string, unknown>
    if (b.type !== 'image') continue
    const source = b.source as Record<string, unknown> | undefined
    if (source && source.type === 'base64' && typeof source.data === 'string') {
      const mediaType = typeof source.media_type === 'string' ? source.media_type : 'image/png'
      out.push({ mediaType, dataUrl: `data:${mediaType};base64,${source.data}` })
    }
  }
  return out
}

/** Middle-ellipsis a long path/string so it stays on one line. */
export function truncateMiddle(s: string, max = 60): string {
  if (s.length <= max) return s
  const keep = Math.max(max - 1, 4)
  const head = Math.ceil(keep * 0.6)
  const tail = keep - head
  return s.slice(0, head) + '…' + s.slice(s.length - tail)
}

export interface GrepGroup {
  file: string
  lines: string[]
}

/** Best-effort grouping of ripgrep-style "path:line:text" output by file. Returns null when the
 * text doesn't look like that shape, so callers can fall back to a plain block. */
export function groupGrepByFile(text: string): GrepGroup[] | null {
  const lines = text.split('\n').filter((l) => l.length > 0)
  if (lines.length === 0) return null
  const re = /^([^\n:]+):(\d+):(.*)$/
  let matched = 0
  for (const l of lines) if (re.test(l)) matched++
  if (matched < lines.length * 0.6) return null

  const groups: GrepGroup[] = []
  const byFile = new Map<string, GrepGroup>()
  for (const l of lines) {
    const m = re.exec(l)
    if (!m) continue
    const [, file, lineNo, rest] = m
    let g = byFile.get(file)
    if (!g) {
      g = { file, lines: [] }
      byFile.set(file, g)
      groups.push(g)
    }
    g.lines.push(`${lineNo}: ${rest}`)
  }
  return groups
}
