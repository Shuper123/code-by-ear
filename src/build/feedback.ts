// What the build loop says about a result: how many rows came back, SQLite's own error, the first rows,
// how the rows differ from the answer, and which piece of the query is still missing. Everything here is
// computed from the query and its rows; none of it comes from an AI.
import { canonCell, type CompareResult } from '../grading/sqlCompare'
import type { SqlRunResult } from '../runtimes/sql'
import { sayDate, sayName } from './frame'

export function rowsPhrase(n: number): string {
  return n === 0 ? 'No rows.' : n === 1 ? '1 row.' : `${n} rows.`
}

/** SQLite's message in sayable words: `near "FROM": syntax error` -> "Syntax error near from." */
export function sayError(error: string): string {
  const e = error.replace(/\s+/g, ' ').trim()
  const near = e.match(/^near "([^"]*)": syntax error/i)
  if (near) return `Syntax error near ${near[1] ? sayName(near[1].toLowerCase()) : 'the end'}.`
  if (/incomplete input/i.test(e)) return "That isn't a complete query yet."
  if (/ran longer than/i.test(e)) return e
  const named = e.match(/^(no such column|no such table|ambiguous column name|misuse of aggregate(?: function)?|misuse of window function|no such function|wrong number of arguments to function): ?(.+)$/i)
  const say = (s: string) =>
    s
      .replace(/\(\)/g, '')
      .split('.')
      .map((p) => sayName(p.toLowerCase()))
      .join(' dot ')
  if (named) return `${named[1].charAt(0).toUpperCase()}${named[1].slice(1).toLowerCase()}: ${say(named[2])}.`
  const plain = e.replace(/[\x22\x60]/g, '').replace(/_/g, ' ') // (quote characters by code, so the voice-text scan of this file stays in step)
  return /[.!?]$/.test(plain) ? plain : `${plain}.`
}

function sayCell(v: unknown): string {
  const c = canonCell(v)
  if (c === null) return 'null'
  if (typeof c === 'number') return Number.isInteger(c) ? String(c) : String(Math.round(c * 100) / 100)
  return sayDate(c)
}

const simpleName = (col: string) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(col)

/** The first rows, read out: "Row 1: machine id 3, total 412." */
export function sayResults(run: SqlRunResult, max = 3): string {
  if (!run.ok) return sayError(run.error)
  if (!run.rows.length) return 'No rows.'
  const head = run.rows.length > max ? `The first ${max} of ${run.rows.length} rows. ` : ''
  const rows = run.rows.slice(0, max).map((r, i) => {
    const cells = r.map((v, k) => (simpleName(run.columns[k] ?? '') ? `${sayName(run.columns[k])} ${sayCell(v)}` : sayCell(v)))
    return `Row ${i + 1}: ${cells.join(', ')}.`
  })
  return head + rows.join(' ')
}

/** How the rows differ from the answer, without giving the answer away. */
export function sayCompare(cmp: CompareResult): string {
  if (cmp.equal) return "That's a match."
  if (cmp.learnerCols !== cmp.referenceCols && cmp.learnerRows > 0 && cmp.referenceRows > 0) {
    return `You have ${cmp.learnerCols} column${cmp.learnerCols === 1 ? '' : 's'}. The answer has ${cmp.referenceCols}.`
  }
  if (cmp.learnerRows !== cmp.referenceRows) {
    return `You have ${cmp.learnerRows} row${cmp.learnerRows === 1 ? '' : 's'}. The answer has ${cmp.referenceRows}.`
  }
  if (/wrong order/.test(cmp.note)) return 'Right rows, wrong order.'
  const like = cmp.missing ? ` The answer has a row like: ${cmp.missing.map(sayCell).join(', ')}.` : ''
  return `Right number of rows, but some values differ.${like}`
}

/** The same thing, short, for the screen. */
export function shortCompare(cmp: CompareResult): string {
  if (cmp.equal) return 'match'
  if (cmp.learnerCols !== cmp.referenceCols && cmp.learnerRows > 0 && cmp.referenceRows > 0) return `answer has ${cmp.referenceCols} column${cmp.referenceCols === 1 ? '' : 's'}`
  if (cmp.learnerRows !== cmp.referenceRows) return `answer has ${cmp.referenceRows} row${cmp.referenceRows === 1 ? '' : 's'}`
  if (/wrong order/.test(cmp.note)) return 'right rows, wrong order'
  return 'some values differ'
}

// ---------------------------------------------------------------- hints

export interface SqlShape {
  tables: Set<string>
  features: Set<string>
}

/** The tables a query reads and the kinds of clause it uses. */
export function sqlShape(sql: string): SqlShape {
  const s = sql.replace(/\x27(?:[^\x27]|\x27\x27)*\x27/g, '\x27\x27')
  const steps = new Set([...s.matchAll(/\b([A-Za-z_]\w*)\s+AS\s*\(/gi)].map((m) => m[1].toLowerCase()))
  const tables = new Set(
    [...s.matchAll(/\b(?:FROM|JOIN)\s+([A-Za-z_]\w*)/gi)].map((m) => m[1].toLowerCase()).filter((t) => !steps.has(t)),
  )
  const features = new Set<string>()
  const has = (re: RegExp, f: string) => {
    if (re.test(s)) features.add(f)
  }
  has(/\bLEFT\s+(?:OUTER\s+)?JOIN\b/i, 'left join')
  has(/\bJOIN\b/i, 'join')
  has(/\bWHERE\b/i, 'where')
  has(/\bGROUP\s+BY\b/i, 'group by')
  has(/\bHAVING\b/i, 'having')
  has(/\bOVER\s*\(/i, 'window')
  has(/\bWITH\b|\bFROM\s*\(\s*SELECT\b/i, 'step')
  has(/\bCASE\b/i, 'case')
  has(/\bSELECT\s+DISTINCT\b|\(\s*DISTINCT\b/i, 'distinct')
  // the ORDER BY and LIMIT of the outer query, not the ones inside a window or a step
  const outer = s.replace(/\([^()]*(?:\([^()]*(?:\([^()]*\)[^()]*)*\)[^()]*)*\)/g, '()')
  if (/\bORDER\s+BY\b/i.test(outer)) features.add('order by')
  if (/\bLIMIT\b/i.test(outer)) features.add('limit')
  return { tables, features }
}

const MISSING: [string, string][] = [
  ['left join', 'Use a left join, so rows with no match are kept.'],
  ['join', 'You need a join.'],
  ['where', 'You need a where.'],
  ['group by', 'You need a group by.'],
  ['having', 'Filter the groups with having.'],
  ['window', 'You need a window function, with over.'],
  ['step', 'Do it in two steps. Build the first query, say name it, then query that.'],
  ['case', 'You need a case expression.'],
  ['distinct', 'You need distinct.'],
  ['order by', 'The order matters here. Add an order by.'],
  ['limit', 'You need a limit.'],
]

/** The first piece the answer has that the query so far doesn't, as a hint. Null when nothing is missing. */
export function missingPiece(userSql: string, referenceSql: string): string | null {
  const mine = sqlShape(userSql)
  const ref = sqlShape(referenceSql)
  for (const t of ref.tables) if (!mine.tables.has(t)) return `You need the ${sayName(t)} table.`
  for (const [f, hint] of MISSING) {
    if (!ref.features.has(f) || mine.features.has(f)) continue
    if (f === 'join' && ref.features.has('left join')) continue
    return hint
  }
  return null
}
