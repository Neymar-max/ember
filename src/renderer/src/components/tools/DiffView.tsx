import { useMemo, useState } from 'react'
import clsx from 'clsx'
import { structuredPatch as computeStructuredPatch, diffWordsWithSpace } from 'diff'
import { useT } from '@/i18n'
import { displayPath } from '@/lib/format'
import { CopyButton } from '@/components/common/CopyButton'
import './DiffView.css'

/** Same shape as the CLI's `structuredPatch` field (Edit/Write tool_use_result) and as
 * `diff`'s own `structuredPatch()` output — SPEC 4.3. */
export interface DiffHunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: string[]
}

export interface DiffViewProps {
  /** Precomputed hunks from the CLI (preferred — matches what was actually applied). */
  hunks?: DiffHunk[]
  /** Fallback: full-text diff computed locally when the CLI didn't provide hunks
   * (MultiEdit snippets, historical entries without `structured`, …). */
  oldText?: string
  newText?: string
  path?: string
  cwd?: string
  className?: string
  /** collapse threshold before "show all N lines", default 40 per SPEC 4.3 */
  maxCollapsedLines?: number
}

interface Row {
  kind: 'add' | 'del' | 'ctx'
  oldLine?: number
  newLine?: number
  text: string
}

function computeHunks(oldText: string, newText: string): DiffHunk[] {
  try {
    return computeStructuredPatch('a', 'b', oldText, newText, undefined, undefined, { context: 3 }).hunks
  } catch {
    return []
  }
}

function hunkToRows(h: DiffHunk): Row[] {
  const rows: Row[] = []
  let oldLine = h.oldStart
  let newLine = h.newStart
  for (const raw of h.lines) {
    if (raw.startsWith('\\')) continue // "\ No newline at end of file"
    const sign = raw[0]
    const text = raw.slice(1)
    if (sign === '-') rows.push({ kind: 'del', oldLine: oldLine++, text })
    else if (sign === '+') rows.push({ kind: 'add', newLine: newLine++, text })
    else rows.push({ kind: 'ctx', oldLine: oldLine++, newLine: newLine++, text })
  }
  return rows
}

/** Pair up adjacent del/add runs 1:1 so we can word-diff-highlight them, Claude-app style. */
type PairedRow = Row | [Row, Row]
function pairRows(rows: Row[]): PairedRow[] {
  const out: PairedRow[] = []
  let i = 0
  while (i < rows.length) {
    if (rows[i].kind !== 'del') {
      out.push(rows[i])
      i++
      continue
    }
    const delRun: Row[] = []
    while (i < rows.length && rows[i].kind === 'del') delRun.push(rows[i++])
    const addRun: Row[] = []
    while (i < rows.length && rows[i].kind === 'add') addRun.push(rows[i++])
    const n = Math.min(delRun.length, addRun.length)
    for (let k = 0; k < n; k++) out.push([delRun[k], addRun[k]])
    for (let k = n; k < delRun.length; k++) out.push(delRun[k])
    for (let k = n; k < addRun.length; k++) out.push(addRun[k])
  }
  return out
}

function WordDiffSpan({ oldText, newText, side }: { oldText: string; newText: string; side: 'old' | 'new' }) {
  const parts = useMemo(() => {
    try {
      return diffWordsWithSpace(oldText, newText)
    } catch {
      return null
    }
  }, [oldText, newText])
  if (!parts) return <>{side === 'old' ? oldText : newText}</>
  return (
    <>
      {parts
        .filter((p) => (side === 'old' ? !p.added : !p.removed))
        .map((p, i) => (
          <span key={i} className={p.added ? 'em-tool-diff-strong-add' : p.removed ? 'em-tool-diff-strong-del' : undefined}>
            {p.value}
          </span>
        ))}
    </>
  )
}

function DiffLineRow({ row, otherText }: { row: Row; otherText?: string }) {
  return (
    <div className={clsx('em-tool-diff-row', `em-tool-diff-row--${row.kind}`)}>
      <span className="em-tool-diff-gutter">{row.oldLine ?? ''}</span>
      <span className="em-tool-diff-gutter">{row.newLine ?? ''}</span>
      <span className="em-tool-diff-sign">{row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : ''}</span>
      <span className="em-tool-diff-code">
        {otherText != null ? (
          <WordDiffSpan
            oldText={row.kind === 'del' ? row.text : otherText}
            newText={row.kind === 'add' ? row.text : otherText}
            side={row.kind === 'del' ? 'old' : 'new'}
          />
        ) : (
          row.text
        )}
      </span>
    </div>
  )
}

export function DiffView({ hunks, oldText, newText = '', path, cwd, className, maxCollapsedLines = 40 }: DiffViewProps) {
  const t = useT()
  const [expanded, setExpanded] = useState(false)

  const effectiveHunks = useMemo(() => {
    if (hunks && hunks.length > 0) return hunks
    if (oldText != null) return computeHunks(oldText, newText)
    return []
  }, [hunks, oldText, newText])

  const stats = useMemo(() => {
    let add = 0
    let del = 0
    for (const h of effectiveHunks) {
      for (const l of h.lines) {
        if (l.startsWith('+')) add++
        else if (l.startsWith('-')) del++
      }
    }
    return { add, del }
  }, [effectiveHunks])

  const rowsByHunk = useMemo(() => effectiveHunks.map(hunkToRows), [effectiveHunks])
  const totalRows = rowsByHunk.reduce((n, r) => n + r.length, 0)
  const showAll = expanded || totalRows <= maxCollapsedLines

  const visibleByHunk = useMemo(() => {
    if (showAll) return rowsByHunk
    let budget = maxCollapsedLines
    const out: Row[][] = []
    for (const rows of rowsByHunk) {
      if (budget <= 0) break
      out.push(rows.slice(0, budget))
      budget -= rows.length
    }
    return out
  }, [rowsByHunk, showAll, maxCollapsedLines])

  if (effectiveHunks.length === 0) return null

  return (
    <div className={clsx('em-tool-diff', className)}>
      {path && (
        <div className="em-tool-diff-head">
          <span className="em-tool-diff-path">{displayPath(path, cwd)}</span>
          <span className="em-tool-diff-stats">
            {stats.add > 0 && <span className="em-tool-diff-add-count">+{stats.add}</span>}
            {stats.del > 0 && <span className="em-tool-diff-del-count">−{stats.del}</span>}
          </span>
          <CopyButton text={newText} />
        </div>
      )}
      <div className="em-tool-diff-body">
        {visibleByHunk.map((rows, hi) => (
          <div key={hi} className="em-tool-diff-hunk">
            {hi > 0 && <div className="em-tool-diff-sep">⋯</div>}
            {pairRows(rows).map((item, ri) =>
              Array.isArray(item) ? (
                <div key={ri} className="em-tool-diff-pair">
                  <DiffLineRow row={item[0]} otherText={item[1].text} />
                  <DiffLineRow row={item[1]} otherText={item[0].text} />
                </div>
              ) : (
                <DiffLineRow key={ri} row={item} />
              ),
            )}
          </div>
        ))}
      </div>
      {!showAll && (
        <button type="button" className="em-tool-diff-more" onClick={() => setExpanded(true)}>
          {t('tools.diff.showAll', { n: totalRows })}
        </button>
      )}
    </div>
  )
}
