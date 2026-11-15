// The query being built by voice, kept as clauses rather than text. You say one clause at a time, in any
// order ("from lots", "group by machine id", "sum of quantity as total"); each lands in its slot, and the
// app writes the SQL in the right order with the punctuation typed for you.
import { formatLine, type Tok } from '../verbal/syntax'

export type ClauseKey = 'select' | 'from' | 'join' | 'where' | 'groupBy' | 'having' | 'orderBy' | 'limit' | 'cte'

export interface Join {
  kind: string // JOIN, LEFT JOIN, INNER JOIN
  table: Tok[] // table and an optional alias
  on: Tok[]
  using: Tok[] // column names separated by commas
}

export interface Query {
  distinct: boolean
  select: Tok[][]
  from: Tok[]
  joins: Join[]
  where: Tok[]
  groupBy: Tok[][]
  having: Tok[]
  orderBy: Tok[][]
  limit: Tok[]
}

export interface Frame {
  /** Earlier steps saved by name ("name it ranked"): WITH ranked AS (...). */
  ctes: { name: string; query: Query }[]
  main: Query
  /** The clause touched last, which "and ...", "comma ..." and "descending" continue. */
  last: ClauseKey | null
}

export const emptyQuery = (): Query => ({ distinct: false, select: [], from: [], joins: [], where: [], groupBy: [], having: [], orderBy: [], limit: [] })
export const emptyFrame = (): Frame => ({ ctes: [], main: emptyQuery(), last: null })

const copyToks = (t: Tok[]) => t.map((x) => ({ ...x }))
export function cloneQuery(q: Query): Query {
  return {
    distinct: q.distinct,
    select: q.select.map(copyToks),
    from: copyToks(q.from),
    joins: q.joins.map((j) => ({ kind: j.kind, table: copyToks(j.table), on: copyToks(j.on), using: copyToks(j.using) })),
    where: copyToks(q.where),
    groupBy: q.groupBy.map(copyToks),
    having: copyToks(q.having),
    orderBy: q.orderBy.map(copyToks),
    limit: copyToks(q.limit),
  }
}
export function cloneFrame(f: Frame): Frame {
  return { ctes: f.ctes.map((c) => ({ name: c.name, query: cloneQuery(c.query) })), main: cloneQuery(f.main), last: f.last }
}

export const isEmptyQuery = (q: Query) =>
  !q.select.length && !q.from.length && !q.joins.length && !q.where.length && !q.groupBy.length && !q.having.length && !q.orderBy.length && !q.limit.length
export const isEmptyFrame = (f: Frame) => !f.ctes.length && isEmptyQuery(f.main)
/** A query can run once it has a table to read from. */
export const isRunnable = (f: Frame) => f.main.from.length > 0

const fmt = (toks: Tok[]) => formatLine(toks, 'sql')
const list = (items: Tok[][]) => items.map(fmt).join(', ')

export interface ClauseLine {
  key: ClauseKey
  /** Which join this line is, for join lines. */
  index?: number
  text: string
}

export function queryLines(q: Query): ClauseLine[] {
  const out: ClauseLine[] = []
  if (q.select.length || q.from.length) out.push({ key: 'select', text: `SELECT ${q.distinct ? 'DISTINCT ' : ''}${q.select.length ? list(q.select) : '*'}` })
  if (q.from.length) out.push({ key: 'from', text: `FROM ${fmt(q.from)}` })
  q.joins.forEach((j, index) => {
    const how = j.using.length ? ` USING (${fmt(j.using)})` : j.on.length ? ` ON ${fmt(j.on)}` : ''
    out.push({ key: 'join', index, text: `${j.kind} ${fmt(j.table)}${how}` })
  })
  if (q.where.length) out.push({ key: 'where', text: `WHERE ${fmt(q.where)}` })
  if (q.groupBy.length) out.push({ key: 'groupBy', text: `GROUP BY ${list(q.groupBy)}` })
  if (q.having.length) out.push({ key: 'having', text: `HAVING ${fmt(q.having)}` })
  if (q.orderBy.length) out.push({ key: 'orderBy', text: `ORDER BY ${list(q.orderBy)}` })
  if (q.limit.length) out.push({ key: 'limit', text: `LIMIT ${fmt(q.limit)}` })
  return out
}

export const renderQuery = (q: Query) => queryLines(q).map((l) => l.text).join('\n')

/** The whole statement as SQL text. */
export function renderFrame(f: Frame): string {
  const main = renderQuery(f.main)
  if (!f.ctes.length) return main
  const ctes = f.ctes.map((c) => `${c.name} AS (\n${renderQuery(c.query).replace(/^/gm, '  ')}\n)`).join(',\n')
  return `WITH ${ctes}${main ? `\n${main}` : ''}`
}

// ---------------------------------------------------------------- saying it

const SAY_OP: Record<string, string> = {
  '=': 'equals', '!=': 'not equal to', '<>': 'not equal to', '>=': 'at least', '<=': 'at most', '>': 'greater than',
  '<': 'less than', '+': 'plus', '-': 'minus', '*': 'times', '/': 'divided by', '%': 'mod', '||': 'concat',
}
const SAY_KW: Record<string, string> = { DESC: 'descending', ASC: 'ascending', AVG: 'average', MIN: 'min', MAX: 'max' }
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export function ordinal(n: number): string {
  const t = n % 100
  if (t >= 11 && t <= 13) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
}

/** '2026-02-01' -> "February 1st, 2026"; anything else unchanged. */
export function sayDate(s: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return s
  return `${MONTHS[Number(m[2]) - 1]} ${ordinal(Number(m[3]))}, ${m[1]}`
}

/** A name the way it's said: lot_id -> "lot id", qty -> "quantity". */
export function sayName(name: string): string {
  return name
    .split('_')
    .map((w) => (w.toLowerCase() === 'qty' ? 'quantity' : w))
    .join(' ')
}

/**
 * Tokens as a person would say them: no "open paren" for calls ("sum of quantity", "count star"), window
 * specs ("over partition by ...") or lists ("in cosmetic, structural").
 */
export function sayToks(toks: Tok[]): string {
  const out: string[] = []
  // parens that are not spoken: the opening index of each, matched to its close
  const silent = new Set<number>()
  const stack: number[] = []
  toks.forEach((t, i) => {
    if (t.kind !== 'punct') return
    if (t.text === '(') {
      const prev = toks[i - 1]
      const quiet = !!prev && prev.kind === 'kw' && !/^(AND|OR|NOT|WHERE|ON|THEN|ELSE|WHEN|BY|SELECT|FROM|HAVING|AS|BETWEEN|LIKE)$/.test(prev.text.split(' ').pop()!)
      stack.push(quiet ? i : -1)
      if (quiet) silent.add(i)
    } else if (t.text === ')') {
      const open = stack.pop()
      if (open !== undefined && open >= 0) silent.add(i)
    }
  })
  toks.forEach((t, i) => {
    const prev = toks[i - 1]
    const next = toks[i + 1]
    switch (t.kind) {
      case 'kw': {
        const word = SAY_KW[t.text] ?? t.text.toLowerCase().replace(/_/g, ' ')
        const call = next?.kind === 'punct' && next.text === '(' && silent.has(i + 1) && !/^(OVER|IN|USING|NOT IN)$/.test(t.text)
        out.push(call && !(toks[i + 2]?.text === '*' && toks[i + 2]?.kind === 'op') ? `${word} of` : word)
        break
      }
      case 'name':
        out.push(sayName(t.text))
        break
      case 'num':
        out.push(t.text.startsWith('-') ? `negative ${t.text.slice(1)}` : t.text)
        break
      case 'str':
        out.push(sayDate(t.text.slice(1, -1).replace(/''/g, "'")))
        break
      case 'op':
        if (t.text === '*' && (!prev || prev.text === '(' || prev.text === ',' || prev.text === '.' || /^SELECT/.test(prev.text))) out.push('star')
        else out.push(SAY_OP[t.text] ?? t.text)
        break
      case 'punct':
        if (t.text === ',') out[out.length - 1] = `${out[out.length - 1] ?? ''},`
        else if (t.text === '.') out.push('dot')
        else if (t.text === '()') break
        else if (silent.has(i)) break
        else if (t.text === '(') out.push('open paren')
        else if (t.text === ')') out.push('close paren')
        else out.push(t.text)
        break
      default:
        out.push(t.text)
    }
  })
  return out.join(' ').replace(/\s+/g, ' ').trim()
}

const sayList = (items: Tok[][]) => items.map(sayToks).join(', ')
const sentence = (s: string) => `${s.charAt(0).toUpperCase()}${s.slice(1)}.`

/** One clause as a sentence: "Group by machine id." */
export function sayClause(q: Query, key: ClauseKey, index?: number): string {
  switch (key) {
    case 'select':
      return sentence(`select ${q.distinct ? 'distinct ' : ''}${q.select.length ? sayList(q.select) : 'star'}`)
    case 'from':
      return sentence(`from ${sayToks(q.from)}`)
    case 'join': {
      const j = q.joins[index ?? q.joins.length - 1]
      if (!j) return ''
      const how = j.using.length ? ` using ${sayToks(j.using)}` : j.on.length ? ` on ${sayToks(j.on)}` : ''
      return sentence(`${j.kind.toLowerCase()} ${sayToks(j.table)}${how}`)
    }
    case 'where':
      return sentence(`where ${sayToks(q.where)}`)
    case 'groupBy':
      return sentence(`group by ${sayList(q.groupBy)}`)
    case 'having':
      return sentence(`having ${sayToks(q.having)}`)
    case 'orderBy':
      return sentence(`order by ${sayList(q.orderBy)}`)
    case 'limit':
      return sentence(`limit ${sayToks(q.limit)}`)
    default:
      return ''
  }
}

/** The whole query, one sentence per clause, in SQL order. */
export function sayQuery(q: Query): string {
  return queryLines(q)
    .filter((l) => l.key !== 'select' || q.select.length || q.distinct)
    .map((l) => sayClause(q, l.key, l.index))
    .join(' ')
}

export function sayFrame(f: Frame): string {
  if (isEmptyFrame(f)) return "There's no query yet."
  const parts = f.ctes.map((c) => `Step ${sayName(c.name)}: ${sayQuery(c.query)}`)
  if (!isEmptyQuery(f.main)) parts.push(f.ctes.length ? `Then: ${sayQuery(f.main)}` : sayQuery(f.main))
  return parts.join(' ')
}
