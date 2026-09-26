/**
 * Per-tool icon / verb / target-line computation for ToolRow's collapsed header.
 * Pure functions only — no React state here, ToolRow owns expand/collapse.
 */
import type { ComponentType } from 'react'
import {
  Bot,
  FilePlus,
  FolderSearch,
  Globe,
  HelpCircle,
  Link2,
  ListChecks,
  Network,
  NotebookPen,
  Pencil,
  Puzzle,
  Search,
  Terminal,
  ClipboardList,
  FileText,
  Layers,
  Wrench,
} from 'lucide-react'
import type { ToolCall } from '@/store/types'
import { displayPath, shortenPathsInText } from '@/lib/format'
import { t } from '@/i18n'
import { truncateMiddle } from './toolContent'

type Icon = ComponentType<{ size?: number; strokeWidth?: number; className?: string }>

export type ToolLineKind = 'row' | 'plan' | 'minimal'

export interface ToolLine {
  Icon: Icon
  verb: string
  target: string
  /** render `target` in the monospace path/code font */
  mono: boolean
  /** small trailing label, e.g. subagent_type or a glob filter */
  extra?: string
  kind: ToolLineKind
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}
function num(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined
}
function pathTarget(p: unknown, cwd?: string): string {
  const s = str(p)
  if (!s) return ''
  return truncateMiddle(displayPath(s, cwd), 72)
}

/** `mcp__server__tool` → "server · tool" (underscores → spaces, per SPEC 4.3). */
export function mcpLabel(name: string): string | null {
  if (!name.startsWith('mcp__')) return null
  const rest = name.slice('mcp__'.length)
  const sep = rest.indexOf('__')
  const server = sep >= 0 ? rest.slice(0, sep) : rest
  const toolName = sep >= 0 ? rest.slice(sep + 2) : ''
  const clean = (s: string) => s.replace(/_/g, ' ').trim()
  return toolName ? `${clean(server)} · ${clean(toolName)}` : clean(server)
}

/** Number of added/removed lines across a CLI-provided structuredPatch (for the "+N -M" stat
 * and for deciding whether an Edit row should default to expanded, per SPEC 4.3). */
export function editLineChangeCount(tool: ToolCall): { add: number; del: number } {
  const structured = tool.structured as { structuredPatch?: { lines: string[] }[] } | undefined
  const hunks = structured?.structuredPatch
  let add = 0
  let del = 0
  if (hunks) {
    for (const h of hunks) {
      for (const l of h.lines) {
        if (l.startsWith('+')) add++
        else if (l.startsWith('-')) del++
      }
    }
  }
  return { add, del }
}

export function describeTool(tool: ToolCall, cwd?: string): ToolLine {
  const { name } = tool
  const inp = tool.input ?? {}

  switch (name) {
    case 'Bash': {
      const cmd = shortenPathsInText(str(inp.command), cwd)
      const firstLine = (cmd.split('\n')[0] ?? '').trim()
      return { Icon: Terminal, verb: t('tools.bash.verb'), target: truncateMiddle(firstLine, 90), mono: true, kind: 'row' }
    }
    case 'Read': {
      let target = pathTarget(inp.file_path, cwd)
      const offset = num(inp.offset)
      const limit = num(inp.limit)
      if (offset != null) {
        const end = limit != null ? offset + limit - 1 : offset
        target = target ? `${target} · ${t('tools.read.lines', { a: offset, b: end })}` : t('tools.read.lines', { a: offset, b: end })
      }
      return { Icon: FileText, verb: t('tools.read.verb'), target, mono: true, kind: 'row' }
    }
    case 'Edit':
    case 'MultiEdit': {
      const { add, del } = editLineChangeCount(tool)
      const stat = add || del ? ` +${add} −${del}` : ''
      return { Icon: Pencil, verb: t('tools.edit.verb'), target: pathTarget(inp.file_path, cwd) + stat, mono: true, kind: 'row' }
    }
    case 'Write': {
      const structured = tool.structured as { type?: string } | undefined
      const isCreate = structured ? structured.type === 'create' : true
      return {
        Icon: FilePlus,
        verb: isCreate ? t('tools.write.create') : t('tools.write.update'),
        target: pathTarget(inp.file_path, cwd),
        mono: true,
        kind: 'row',
      }
    }
    case 'Grep': {
      const extra = str(inp.glob) || str(inp.path)
      return {
        Icon: Search,
        verb: t('tools.grep.verb'),
        target: truncateMiddle(str(inp.pattern), 80),
        mono: true,
        extra: extra ? truncateMiddle(extra, 40) : undefined,
        kind: 'row',
      }
    }
    case 'Glob':
      return { Icon: FolderSearch, verb: t('tools.glob.verb'), target: truncateMiddle(str(inp.pattern), 80), mono: true, kind: 'row' }
    case 'WebSearch':
      return { Icon: Globe, verb: t('tools.websearch.verb'), target: str(inp.query), mono: false, kind: 'row' }
    case 'WebFetch': {
      const url = str(inp.url)
      let domain = url
      try {
        domain = new URL(url).hostname
      } catch {
        /* keep raw string when it isn't a valid URL */
      }
      return { Icon: Link2, verb: t('tools.webfetch.verb'), target: domain, mono: false, kind: 'row' }
    }
    case 'Agent':
    case 'Task':
      return {
        Icon: Bot,
        verb: t('tools.agent.verb'),
        target: str(inp.description) || truncateMiddle(str(inp.prompt), 90),
        mono: false,
        extra: str(inp.subagent_type) || undefined,
        kind: 'row',
      }
    case 'TaskCreate':
    case 'TaskUpdate':
    case 'TaskList':
    case 'TodoWrite':
      return { Icon: ListChecks, verb: t('tools.tasks.updated'), target: '', mono: false, kind: 'minimal' }
    case 'ToolSearch':
      return { Icon: Layers, verb: t('tools.toolsearch.verb', { q: truncateMiddle(str(inp.query), 60) }), target: '', mono: false, kind: 'minimal' }
    case 'Skill':
      return {
        Icon: Puzzle,
        verb: t('tools.skill.verb'),
        target: str(inp.skill) || str(inp.command) || str(inp.name),
        mono: false,
        kind: 'row',
      }
    case 'NotebookEdit':
      return { Icon: NotebookPen, verb: t('tools.notebook.verb'), target: pathTarget(inp.notebook_path, cwd), mono: true, kind: 'row' }
    case 'ExitPlanMode':
      return { Icon: ClipboardList, verb: t('tools.plan.title'), target: '', mono: false, kind: 'plan' }
    case 'EnterPlanMode':
      return { Icon: ClipboardList, verb: t('tools.plan.enter'), target: '', mono: false, kind: 'minimal' }
    case 'AskUserQuestion': {
      const structured = tool.structured as { answers?: Record<string, string> } | undefined
      const questions = Array.isArray(inp.questions) ? (inp.questions as { question?: string }[]) : []
      const first = questions[0]
      const answer = first?.question && structured?.answers ? structured.answers[first.question] : undefined
      const moreCount = questions.length > 1 ? t('tools.ask.moreCount', { n: questions.length - 1 }) : undefined
      const answered = tool.status === 'done'
      const verb = answered ? t('tools.ask.verb') : tool.status === 'denied' || tool.status === 'error' ? t('tools.ask.verbSkipped') : t('tools.ask.verbAsking')
      const target = answer ?? (answered ? '' : first?.question ?? '')
      return { Icon: HelpCircle, verb, target, mono: false, extra: moreCount, kind: 'row' }
    }
    default: {
      const mcp = mcpLabel(name)
      if (mcp) return { Icon: Network, verb: mcp, target: '', mono: false, kind: 'row' }
      return { Icon: Wrench, verb: name, target: '', mono: false, kind: 'row' }
    }
  }
}
