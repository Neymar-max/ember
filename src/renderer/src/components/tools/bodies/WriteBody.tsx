import type { ToolCall } from '@/store/types'
import { CodeBlock } from '@/components/chat/CodeBlock'
import { langFromPath } from '@/lib/format'
import { DiffView, type DiffHunk } from '../DiffView'

interface WriteStructured {
  type?: 'create' | 'update'
  content?: string
  structuredPatch?: DiffHunk[]
  originalFile?: string | null
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

export function WriteBody({ tool, cwd }: { tool: ToolCall; cwd?: string }) {
  const input = tool.input ?? {}
  const structured = tool.structured as WriteStructured | undefined
  const filePath = str(input.file_path)
  const content = str(input.content) || str(structured?.content)
  const isCreate = structured ? structured.type === 'create' : true

  if (!isCreate && ((structured?.structuredPatch?.length ?? 0) > 0 || typeof structured?.originalFile === 'string')) {
    return (
      <DiffView
        hunks={structured?.structuredPatch}
        oldText={typeof structured?.originalFile === 'string' ? structured.originalFile : undefined}
        newText={content}
        path={filePath}
        cwd={cwd}
      />
    )
  }

  return <CodeBlock code={content} language={langFromPath(filePath)} bare maxLines={40} />
}
