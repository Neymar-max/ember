import type { ToolCall } from '@/store/types'
import { CodeBlock } from '@/components/chat/CodeBlock'
import { langFromPath } from '@/lib/format'
import { contentImages, contentToText } from '../toolContent'

interface ReadStructured {
  file?: { filePath?: string; content?: string; startLine?: number; totalLines?: number }
}

/** Historical/fallback tool_result text is line-number-prefixed ("1\t...", tab-separated) —
 * strip that when we don't have the clean `structured.file.content`. */
function stripLineNumberPrefixes(text: string): string {
  return text.replace(/^\s*\d+\t/gm, '')
}

export function ReadBody({ tool }: { tool: ToolCall }) {
  const input = tool.input ?? {}
  const filePath = typeof input.file_path === 'string' ? input.file_path : ''
  const images = contentImages(tool.result?.content)
  if (images.length > 0) {
    return (
      <div className="em-tool-images">
        {images.map((im, i) => (
          <img key={i} src={im.dataUrl} alt="" className="em-tool-image-thumb" />
        ))}
      </div>
    )
  }

  const structured = tool.structured as ReadStructured | undefined
  const fileInfo = structured?.file
  const hasClean = typeof fileInfo?.content === 'string'
  const code = hasClean ? (fileInfo!.content as string) : stripLineNumberPrefixes(contentToText(tool.result?.content))
  const startLine = fileInfo?.startLine ?? (typeof input.offset === 'number' ? input.offset : 1)

  return <CodeBlock code={code} language={langFromPath(filePath)} startLine={startLine} bare maxLines={40} />
}
