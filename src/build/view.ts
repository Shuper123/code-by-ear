// What the Parked screen shows for a query being built: the SQL with the lines that just changed marked,
// the first rows of its result (or SQLite's error), and how it compares with the answer.
import type { CompareResult } from '../grading/sqlCompare'
import type { SqlRunResult } from '../runtimes/sql'
import { shortCompare } from './feedback'
import { queryLines, type Frame } from './frame'
import type { Changed } from './parse'

export interface BuildLine {
  text: string
  changed?: boolean
}

export interface BuildSnapshot {
  lines: BuildLine[]
  result?: { columns: string[]; rows: unknown[][]; total: number }
  error?: string
  /** "12 rows · answer has 5 rows" */
  status?: string
  matched?: boolean
  steps: number
}

export const SHOWN_ROWS = 8

export function displayLines(f: Frame, changed: Changed[] = []): BuildLine[] {
  const out: BuildLine[] = []
  f.ctes.forEach((c, i) => {
    out.push({ text: `${i === 0 ? 'WITH ' : ''}${c.name} AS (`, changed: i === f.ctes.length - 1 && changed.some((x) => x.key === 'cte') })
    for (const l of queryLines(c.query)) out.push({ text: `  ${l.text}` })
    out.push({ text: i < f.ctes.length - 1 ? '),' : ')' })
  })
  for (const l of queryLines(f.main)) out.push({ text: l.text, changed: changed.some((x) => x.key === l.key && (x.index === undefined || x.index === l.index)) })
  return out
}

export function snapshotOf(f: Frame, changed: Changed[], run: SqlRunResult | null, cmp: CompareResult | null, steps: number, status?: string): BuildSnapshot {
  const snap: BuildSnapshot = { lines: displayLines(f, changed), steps }
  if (run?.ok) {
    snap.result = { columns: run.columns, rows: run.rows.slice(0, SHOWN_ROWS), total: run.rows.length }
    snap.status = `${run.rows.length} row${run.rows.length === 1 ? '' : 's'}${cmp ? ` · ${shortCompare(cmp)}` : ''}`
    snap.matched = !!cmp?.equal
  } else if (run) {
    snap.error = run.error
  }
  if (status) snap.status = status
  return snap
}
