// Spoken SQL clauses -> changes to the query frame. You say the words that carry meaning ("where shift
// equals night", "sum of quantity as total", "rank over partition by machine id order by quantity
// descending"); this types the punctuation: parentheses for calls, window specs and IN lists, quotes
// around values and dates, commas between columns, underscores in names. Rules only, no AI.
import { cleanUtterance } from '../speech/commands'
import { dictate, editDistance, emptyDoc, soundex, SQL_FUNCS, type Tok } from '../verbal/syntax'
import { cloneFrame, emptyQuery, type ClauseKey, type Frame, type Query } from './frame'

export interface BuildSchema {
  tables: { name: string; columns: string[] }[]
  /** Text values stored in each column (by column name), so "night" is written the way the data has it. */
  values: Record<string, string[]>
  /** The year the data is in, for dates said without one. */
  year: number
}

export interface Changed {
  key: ClauseKey
  index?: number
}

export interface Applied {
  frame: Frame
  /** The clauses that changed, in the order they were said. Empty when nothing usable was heard. */
  changed: Changed[]
  /** What to say when nothing changed, or when part of it couldn't be placed. */
  note?: string
}

const kw = (text: string): Tok => ({ kind: 'kw', text })
const punct = (text: string): Tok => ({ kind: 'punct', text })
const isKw = (t: Tok | undefined, ...texts: string[]) => !!t && t.kind === 'kw' && texts.includes(t.text)
const isPunct = (t: Tok | undefined, text: string) => !!t && t.kind === 'punct' && t.text === text
const isName = (t: Tok | undefined, text?: string) => !!t && t.kind === 'name' && (text === undefined || t.text.toLowerCase() === text)
const lower = (s: string) => s.toLowerCase()

// ---------------------------------------------------------------- text level

const MONTHS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5, june: 6, jun: 6, july: 7, jul: 7,
  august: 8, aug: 8, september: 9, sep: 9, sept: 9, october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
}
const MONTH_RE = `(${Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|')})\\.?`
const ORDINAL_WORDS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11,
  twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18,
  nineteenth: 19, twentieth: 20, 'twenty first': 21, 'twenty second': 22, 'twenty third': 23, 'twenty fourth': 24,
  'twenty fifth': 25, 'twenty sixth': 26, 'twenty seventh': 27, 'twenty eighth': 28, 'twenty ninth': 29, thirtieth: 30,
  'thirty first': 31,
}
const ORDINAL_RE = `(${Object.keys(ORDINAL_WORDS).sort((a, b) => b.length - a.length).join('|')})`

function iso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2200) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** "February 1st 2026", "Feb 1", "the 1st of February", "2/1/2026" -> quote 2026-02-01 unquote. */
export function replaceDates(text: string, year: number): string {
  const q = (d: string | null, whole: string) => (d ? ` quote ${d} unquote ` : whole)
  return text
    .replace(new RegExp(`\\b${MONTH_RE} ${ORDINAL_RE}\\b`, 'gi'), (_m, mon: string, ord: string) => `${mon} ${ORDINAL_WORDS[lower(ord)]}`)
    .replace(new RegExp(`\\b(?:the )?${ORDINAL_RE} of ${MONTH_RE}`, 'gi'), (_m, ord: string, mon: string) => `${mon} ${ORDINAL_WORDS[lower(ord)]}`)
    .replace(new RegExp(`\\b(?:the )?(\\d{1,2})(?:st|nd|rd|th)? of ${MONTH_RE}(?:,? (\\d{4}))?(?![\\d-])`, 'gi'), (m, d: string, mon: string, y?: string) =>
      q(iso(Number(y ?? year), MONTHS[lower(mon)], Number(d)), m),
    )
    .replace(new RegExp(`\\b${MONTH_RE} (\\d{1,2})(?:st|nd|rd|th)?(?:,? (\\d{4}))?(?![\\d-])`, 'gi'), (m, mon: string, d: string, y?: string) =>
      q(iso(Number(y ?? year), MONTHS[lower(mon)], Number(d)), m),
    )
    .replace(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g, (m, mo: string, d: string, y: string) => q(iso(Number(y), Number(mo), Number(d)), m))
    .replace(/(?<!quote )\b(\d{4})-(\d{2})-(\d{2})\b/g, (m, y: string, mo: string, d: string) => q(iso(Number(y), Number(mo), Number(d)), m))
}

const FILLER = /^(?:(?:okay|ok|um|uh|so|and then|then|now|next|please|alright)\s+)+/i
const APPEND = /^(?:also|add|plus|and also)\s+/i
const ALIAS_STOP = new Set(['comma', 'from', 'where', 'group', 'order', 'having', 'limit', 'join', 'left', 'inner', 'on', 'and', 'or',
  'then', 'when', 'else', 'end', 'over', 'descending', 'ascending', 'desc', 'asc', 'using', 'select', 'quote', 'case', 'zzofzz'])

/** After an alias, a word followed by one of these starts the next column rather than continuing the name. */
const CALL_NEXT = new Set(['zzofzz', 'star', 'distinct'])

/** "sum of", "count of", "lag of": the "of" is marked so the argument is read here (it can be a name with
 * dots, a group in parentheses or another call), not closed after one word by the dictation parser. */
const OF = 'zzofzz'
const OF_CALL = /\b(sum|count|average|avg|min|minimum|max|maximum|upper|lower|length|round|coalesce|lag|lead|abs|substr|ifnull|nullif)\s+of\b/gi
const isOf = (t: Tok | undefined) => !!t && t.kind === 'name' && (t.text === OF || t.text.toLowerCase() === 'of')

/** Clause words as speech recognition tends to write them. Phone testing will add to this list. */
const HEARD_AS: [RegExp, string][] = [
  [/\b(?:the )?some of\b/gi, 'sum of'],
  [/\bgroup(?:ed)? (?:buy|bye|bi)\b|\bgrouped by\b/gi, 'group by'],
  [/\border(?:ed)? (?:buy|bye|bi)\b|\bordered by\b/gi, 'order by'],
  [/\bpartition(?:ed)? (?:buy|bye|bi)\b|\bpartitioned by\b/gi, 'partition by'],
  [/\bjoined\b/gi, 'join'],
  [/\bsort(?:ed)? by\b/gi, 'order by'],
  [/^(?:wear|ware|were|we're)\b/i, 'where'],
  [/^(?:selects|selected|collect)\b/i, 'select'],
  [/\bcount (?:start|store|stars)\b/gi, 'count star'],
  [/\bis (?:not )?(?:no|nil|knoll|nul|nall)$/gi, ''], // filled in below
  [/\b(?:leg|lack) of\b/gi, 'lag of'],
  [/\b(open|close|left|right) (?:parentheses|parenthesis|parens|parent|paran|perrin|baron)\b/gi, '$1 paren'],
  [/([a-z_])\.([a-z_])/gi, '$1 dot $2'], // "defects.quantity" written with the dot
]

/** A number as speech recognition writes it: digits, or number words. */
const NUM_WORD = '(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million)'
const NUMBER = `(?:\\d[\\d,]*(?:\\.\\d+)?|${NUM_WORD}(?:[ -](?:and )?${NUM_WORD})*)`
const DATE_LIT = 'quote \\d{4}-\\d\\d-\\d\\d unquote'
const BE = '(?:is |are |was |were )?'
const cmp = (source: string) => new RegExp(source, 'gi')

/**
 * Everyday ways to compare, turned into the phrases the parser knows: "over 400", "is under 150",
 * "150 or more", "no more than 10", "before March 1st". "Over" stays the window keyword unless a number
 * follows it. Runs after dates are found. Phone testing will add to this list.
 */
const COMPARISONS: [RegExp, string][] = [
  [/\b(?:isn't|aren't|wasn't)\b/gi, 'is not'],
  [/\bdoesn't equal\b/gi, 'does not equal'],
  [/\b((?:greater|less) than or equal)(?! to)\b/gi, '$1 to'],
  [cmp(`\\b${BE}(?:equal to |equals )?(${NUMBER}|${DATE_LIT}) or (?:more|greater|higher|above|over|bigger|larger|later)\\b(?! than)`), 'at least $1'],
  [cmp(`\\b${BE}(?:equal to |equals )?(${NUMBER}|${DATE_LIT}) or (?:less|fewer|lower|below|under|smaller|earlier)\\b(?! than)`), 'at most $1'],
  [cmp(`\\b${BE}(?:no|not) (?:more|greater|bigger|larger|higher) than\\b`), 'at most'],
  [cmp(`\\b${BE}(?:no|not) (?:less|fewer|smaller|lower) than\\b`), 'at least'],
  [cmp(`\\b${BE}(?:bigger|larger|higher) than\\b`), 'greater than'],
  [cmp(`\\b${BE}(?:smaller|lower) than\\b`), 'less than'],
  [cmp(`\\b(?:is |are |was |were )fewer than\\b`), 'less than'],
  [cmp(`(?<!\\bas )\\b${BE}above\\b`), 'greater than'],
  [cmp(`(?<!\\bas )\\b${BE}(?:below|under)\\b`), 'less than'],
  [cmp(`\\b(?:is |are |was |were )over\\b`), 'greater than'],
  [cmp(`\\bover (?=${NUMBER}\\b)`), 'greater than '],
  [cmp(`\\b${BE}exactly\\b`), 'equals'],
  [cmp(`\\b${BE}on or after (?=${DATE_LIT})`), 'at least '],
  [cmp(`\\b${BE}on or before (?=${DATE_LIT})`), 'at most '],
  [cmp(`\\b${BE}(?:before|earlier than|prior to) (?=${DATE_LIT})`), 'less than '],
  [cmp(`\\b${BE}(?:after|later than) (?=${DATE_LIT})`), 'greater than '],
  [cmp(`\\b${BE}since (?=${DATE_LIT})`), 'at least '],
]

interface Prepared {
  text: string
  /** "also ..." / "add ...": extend the clause instead of replacing it. */
  append: boolean
}

function prepare(utterance: string, year: number): Prepared {
  let text = utterance.replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim()
  text = text.replace(FILLER, '')
  const append = APPEND.test(text)
  if (append) text = text.replace(APPEND, '')
  for (const [heard, meant] of HEARD_AS) {
    text = meant ? text.replace(heard, meant) : text.replace(heard, (m) => (/ not /i.test(m) ? 'is not null' : 'is null'))
  }
  text = replaceDates(text, year).replace(/\s+/g, ' ').trim()
  for (const [said, meant] of COMPARISONS) text = text.replace(said, meant)
  text = text
    .replace(/,(?=\s|$)/g, ' comma ')
    .replace(/\b(?:count|number) of (?:all )?(?:the )?rows\b|\bcount (?:all )?(?:the )?rows\b/gi, 'count star')
    .replace(/\bselect (?:all the columns|all columns|everything|all)\b/gi, 'select star')
    // "times" written as a symbol: always for the sign, for the letter only next to a number
    .replace(/\s×\s/g, ' times ')
    .replace(/\sx\s(?=\d)|(?<=\d)\sx\s/gi, ' times ')
    .replace(OF_CALL, `$1 ${OF}`)
    .replace(/\s+/g, ' ')
    .trim()
  return { text, append }
}

/** Names given with "as" in this utterance ("as total scrap"), so they can be used later in it. */
function aliasesIn(text: string): string[] {
  const words = lower(text).replace(/[^\w\s']/g, ' ').split(/\s+/).filter(Boolean)
  const out: string[] = []
  words.forEach((w, i) => {
    if (w !== 'as') return
    const alias: string[] = []
    for (let j = i + 1; j < words.length && alias.length < 4; j++) {
      if (ALIAS_STOP.has(words[j])) break
      // "as total average of quantity", "as total count star": the next column has started
      if (CALL_NEXT.has(words[j + 1] ?? '') && alias.length) break
      alias.push(words[j])
    }
    if (alias.length) out.push(alias.join('_'))
  })
  return out
}

// ---------------------------------------------------------------- names

const fromAlias = (toks: Tok[]): string | null => {
  const names = toks.filter((t) => t.kind === 'name')
  return names.length >= 2 ? names[names.length - 1].text : null
}

function selectAlias(item: Tok[]): string | null {
  let depth = 0
  let at = -1
  item.forEach((t, i) => {
    if (isPunct(t, '(')) depth++
    else if (isPunct(t, ')')) depth--
    else if (depth === 0 && isKw(t, 'AS')) at = i
  })
  return at >= 0 && isName(item[at + 1]) ? item[at + 1].text : null
}

/** Names the query itself defines: saved steps, table aliases, column aliases. */
export function frameNames(f: Frame): string[] {
  const out = new Set<string>()
  for (const q of [...f.ctes.map((c) => c.query), f.main]) {
    for (const item of q.select) {
      const a = selectAlias(item)
      if (a) out.add(a)
    }
    for (const toks of [q.from, ...q.joins.map((j) => j.table)]) {
      const a = fromAlias(toks)
      if (a) out.add(a)
    }
  }
  for (const c of f.ctes) out.add(c.name)
  return [...out]
}

export const schemaNames = (s: BuildSchema): string[] => [...new Set(s.tables.flatMap((t) => [t.name, ...t.columns]))]

// ---------------------------------------------------------------- token level

function matchParen(toks: Tok[], open: number): number {
  let depth = 0
  for (let i = open; i < toks.length; i++) {
    if (isPunct(toks[i], '(')) depth++
    else if (isPunct(toks[i], ')') && --depth === 0) return i
  }
  return toks.length
}

const AGG = new Set(['COUNT', 'SUM', 'AVG', 'MIN', 'MAX'])
const NO_ARG = new Set(['ROW_NUMBER', 'RANK', 'DENSE_RANK'])
const MORE_ARGS = new Set(['ROUND', 'COALESCE', 'LAG', 'LEAD', 'IFNULL', 'NULLIF', 'SUBSTR'])
/** Called without "of" as well: "lag quantity over order by lot id". */
const NO_OF = new Set(['LAG', 'LEAD'])
const COMPARE = new Set(['=', '!=', '<>', '<', '>', '<=', '>='])

interface Ctx {
  /** Every known name, lowercased: tables, columns, saved steps and aliases. */
  ids: Set<string>
  /** Column names only (schema columns and column aliases), lowercased. */
  cols: Set<string>
  schema: BuildSchema
}

function funcName(toks: Tok[], i: number): string | null {
  const t = toks[i]
  if (!t) return null
  if (t.kind === 'kw' && SQL_FUNCS.has(t.text)) return t.text
  // function names the phrase table doesn't know ("abs of x", "date of produced on")
  if (t.kind === 'name' && SQL_FUNCS.has(t.text.toUpperCase()) && (isOf(toks[i + 1]) || isPunct(toks[i + 1], '('))) return t.text.toUpperCase()
  return null
}

const COUNT_STAR = (): Tok[] => [kw('COUNT'), punct('('), { kind: 'op', text: '*' }, punct(')')]

function strTok(text: string): Tok {
  return { kind: 'str', text: `'${text.replace(/'/g, "''")}'` }
}

/** One argument of a call: a name (with dots), a number, a value, star, a group in parentheses, or another call. */
function readArg(toks: Tok[], i: number, ctx: Ctx): { toks: Tok[]; next: number } | null {
  const out: Tok[] = []
  let j = i
  if (isKw(toks[j], 'DISTINCT')) out.push(toks[j++])
  const t = toks[j]
  if (!t) return null
  if (isPunct(t, '(')) {
    const close = matchParen(toks, j)
    out.push(t, ...fixFunctions(toks.slice(j + 1, close), ctx), punct(')'))
    return { toks: out, next: Math.min(close + 1, toks.length) }
  }
  if (isKw(t, 'CASE')) {
    // "sum of case when shift equals night then 1 else 0 end": the whole case is the argument
    let open = 0
    for (let k = j; k < toks.length; k++) {
      if (isKw(toks[k], 'CASE')) open++
      else if (isKw(toks[k], 'END') && --open === 0) return { toks: [...out, ...fixFunctions(toks.slice(j, k + 1), ctx)], next: k + 1 }
    }
    return null // cut by a pause: read again when the rest arrives
  }
  const call = readCall(toks, j, ctx)
  if (call) return { toks: [...out, ...call.toks], next: call.next }
  if (funcName(toks, j) && isPunct(toks[j + 1], '(')) {
    const close = matchParen(toks, j + 1)
    out.push(kw(funcName(toks, j)!), punct('('), ...fixFunctions(toks.slice(j + 2, close), ctx), punct(')'))
    return { toks: out, next: Math.min(close + 1, toks.length) }
  }
  if ((t.kind === 'op' && t.text === '*') || t.kind === 'num' || t.kind === 'str') return { toks: [...out, t], next: j + 1 }
  if (t.kind === 'name') {
    out.push(t)
    j++
    while (isPunct(toks[j], '.') && toks[j + 1]?.kind === 'name') {
      out.push(toks[j], toks[j + 1])
      j += 2
    }
    return { toks: out, next: j }
  }
  return null
}

/** A function said without its parentheses ("count distinct lot id", "round of x comma 1", "row number"). */
function readCall(toks: Tok[], i: number, ctx: Ctx): { toks: Tok[]; next: number } | null {
  const t = toks[i]
  const fn = funcName(toks, i) ?? (t?.kind === 'kw' && SQL_FUNCS.has(t.text) ? t.text : null)
  if (!fn) return null
  const nxt = toks[i + 1]
  if (isPunct(nxt, '(') || isPunct(nxt, '()')) return null // already has its parentheses
  if (NO_ARG.has(fn)) return { toks: [kw(fn), punct('()')], next: i + 1 }
  let j = i + 1
  const saidOf = isOf(nxt)
  if (saidOf) j++
  else if (!AGG.has(fn) && !NO_OF.has(fn)) return null
  const arg = readArg(toks, j, ctx)
  if (!arg) {
    // "sum of" (pause) "quantity", or a case still open: left as it is until the rest arrives
    if (j >= toks.length || isKw(toks[j], 'CASE')) return fn === 'COUNT' && !saidOf && j >= toks.length ? { toks: COUNT_STAR(), next: j } : null
    if (saidOf) return { toks: [kw(fn), punct('('), punct(')')], next: j }
    // "count" on its own counts rows: "select shift, count as n", "having count greater than 10"
    return fn === 'COUNT' ? { toks: COUNT_STAR(), next: j } : null
  }
  // "sum of open paren a times b close paren": the spoken parentheses are the call's own
  const grouped = isPunct(arg.toks[0], '(') && matchParen(arg.toks, 0) === arg.toks.length - 1
  const call = grouped ? [kw(fn), ...arg.toks.slice(0, -1)] : [kw(fn), punct('('), ...arg.toks]
  let next = arg.next
  while (MORE_ARGS.has(fn) && isPunct(toks[next], ',')) {
    const a = toks[next + 1]
    // ROUND(x, 1): a number. COALESCE(shift, unknown): a value. A column after the comma is the next list item.
    const plainValue = isName(a) && !ctx.ids.has(lower(a.text)) && fn !== 'ROUND' && !isPunct(toks[next + 2], '.')
    if (!a || !(a.kind === 'num' || (a.kind === 'str' && fn !== 'ROUND') || plainValue)) break
    call.push(punct(','), plainValue ? strTok(a.text) : a)
    next += 2
  }
  call.push(punct(')'))
  return { toks: call, next }
}

/** A column named like a function ("as rank", "as count") is a name wherever it isn't being called. */
function aliasKeywords(toks: Tok[], ids: Set<string>): Tok[] {
  return toks.map((t, i) => {
    if (t.kind !== 'kw' || !SQL_FUNCS.has(t.text) || !ids.has(lower(t.text))) return t
    const next = toks[i + 1]
    if (isPunct(next, '(') || isPunct(next, '()') || isOf(next) || isKw(next, 'OVER')) return t
    if (AGG.has(t.text) && next && (next.kind === 'name' || isKw(next, 'DISTINCT') || (next.kind === 'op' && next.text === '*'))) return t
    return { kind: 'name', text: lower(t.text) }
  })
}

/** "sum of defects quantity" -> defects.qty: a table said right before one of its own columns. */
function qualify(toks: Tok[], schema: BuildSchema): Tok[] {
  const out: Tok[] = []
  toks.forEach((t, i) => {
    out.push(t)
    const next = toks[i + 1]
    if (t.kind !== 'name' || !isName(next) || isPunct(toks[i + 2], '.') || isPunct(toks[i - 1], '.')) return
    if (isKw(toks[i - 1], 'FROM', 'JOIN', 'INNER JOIN', 'LEFT JOIN', 'AS')) return
    const table = schema.tables.find((x) => lower(x.name) === lower(t.text))
    if (table?.columns.some((c) => lower(c) === lower(next.text))) out.push(punct('.'))
  })
  return out
}

function fixFunctions(toks: Tok[], ctx: Ctx): Tok[] {
  const out: Tok[] = []
  let i = 0
  while (i < toks.length) {
    const r = readCall(toks, i, ctx)
    if (r) {
      out.push(...r.toks)
      i = r.next
    } else out.push(toks[i++])
  }
  return out
}

/** "over partition by machine id order by quantity descending" -> OVER (PARTITION BY ... ORDER BY ... DESC). */
function fixWindows(toks: Tok[]): Tok[] {
  const out: Tok[] = []
  for (let i = 0; i < toks.length; i++) {
    out.push(toks[i])
    if (!isKw(toks[i], 'OVER') || isPunct(toks[i + 1], '(')) continue
    let j = i + 1
    let depth = 0
    for (; j < toks.length; j++) {
      if (isPunct(toks[j], '(')) depth++
      else if (isPunct(toks[j], ')')) depth--
      else if (depth === 0 && isKw(toks[j], 'AS')) break
    }
    out.push(punct('('), ...toks.slice(i + 1, j), punct(')'))
    i = j - 1
  }
  return out
}

/** "in cosmetic comma structural" -> IN (cosmetic, structural); the list ends at AND, OR or the end. */
function fixIn(toks: Tok[]): Tok[] {
  const out: Tok[] = []
  for (let i = 0; i < toks.length; i++) {
    out.push(toks[i])
    if (!isKw(toks[i], 'IN') || isPunct(toks[i + 1], '(')) continue
    let j = i + 1
    let depth = 0
    for (; j < toks.length; j++) {
      if (isPunct(toks[j], '(')) depth++
      else if (isPunct(toks[j], ')')) depth--
      else if (depth === 0 && isKw(toks[j], 'AND', 'OR')) break
    }
    out.push(punct('('), ...toks.slice(i + 1, j), punct(')'))
    i = j - 1
  }
  return out
}

/** "shift is night" -> shift = night; "is not night" -> != night; "is between" and "is in" lose the "is". */
function fixIs(toks: Tok[]): Tok[] {
  const out: Tok[] = []
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]
    if (isKw(t, 'IS')) {
      const n = toks[i + 1]
      if (isKw(n, 'BETWEEN', 'IN', 'LIKE')) continue
      if (isKw(n, 'NOT')) {
        const n2 = toks[i + 2]
        if (isKw(n2, 'IN', 'LIKE', 'BETWEEN')) continue
        if (n2 && n2.kind !== 'kw') {
          out.push({ kind: 'op', text: '!=' })
          i++
          continue
        }
      } else if (n && (n.kind === 'name' || n.kind === 'num' || n.kind === 'str')) {
        out.push({ kind: 'op', text: '=' })
        continue
      }
    }
    out.push(t)
  }
  return out
}

/** A spoken value written the way the data stores it: "a" -> A for a line, "knight" -> night for a shift. */
export function canonValue(text: string, column: string | null, schema: BuildSchema): string {
  const low = lower(text)
  const pool = column && schema.values[column] ? schema.values[column] : null
  const exact = (pool ?? Object.values(schema.values).flat()).find((v) => lower(v) === low)
  if (exact) return exact
  if (pool) {
    let best: string | null = null
    let bestD = 99
    for (const v of pool) {
      const d = editDistance(low, lower(v))
      if (d < bestD) {
        best = v
        bestD = d
      }
    }
    if (best && low.length >= 3 && (bestD <= (low.length <= 4 ? 1 : 2) || (soundex(low) === soundex(best) && low[0] === lower(best)[0]))) return best
  }
  return text
}

/**
 * Words that aren't names of anything become values: after a comparison, LIKE, THEN or ELSE, or inside
 * an IN list. "where shift equals night" -> shift = 'night'.
 */
function fixStrings(toks: Tok[], ctx: Ctx): Tok[] {
  const out: Tok[] = []
  const lists: boolean[] = []
  let expect = false
  let column: string | null = null
  // a word that isn't a name of anything, or was only matched to one by sounding close ("short" for shift)
  const wordAt = (k: number): string | null => {
    const t = toks[k]
    if (!isName(t) || isPunct(toks[k + 1], '.') || isPunct(toks[k + 1], '(')) return null
    if (t.said) return t.said
    return ctx.ids.has(lower(t.text)) ? null : t.text
  }
  const plain = (k: number) => wordAt(k) !== null
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]
    if (isPunct(t, '(')) {
      lists.push(isKw(toks[i - 1], 'IN'))
      expect = lists[lists.length - 1]
    } else if (isPunct(t, ')')) {
      lists.pop()
      expect = false
    } else if (isPunct(t, ',') && lists[lists.length - 1]) {
      expect = true
    } else if ((t.kind === 'op' && COMPARE.has(t.text)) || isKw(t, 'LIKE', 'THEN', 'ELSE')) {
      expect = true
    } else if (expect && plain(i)) {
      const words = [wordAt(i)!]
      let j = i + 1
      while (plain(j)) words.push(wordAt(j++)!)
      const said = words.join(' ')
      const value = canonValue(said, column, ctx.schema)
      // one word that sounds like a column and matches no stored value is that column ("quantity over unit costs")
      const isColumn = j === i + 1 && !!t.said && value === said && ctx.cols.has(lower(t.text))
      expect = false
      if (!isColumn) {
        out.push(strTok(value))
        i = j - 1
        continue
      }
    } else {
      if (t.kind === 'name' && ctx.cols.has(lower(t.text))) column = lower(t.text)
      expect = false
    }
    out.push(t)
  }
  return out
}

/** Split a list at commas (and at "and"), and between two column names said in a row. */
function splitItems(toks: Tok[], ctx: Ctx): Tok[][] {
  const items: Tok[][] = [[]]
  let depth = 0
  let cases = 0
  let between = false
  toks.forEach((t, i) => {
    const cur = items[items.length - 1]
    const prev = toks[i - 1]
    if (isPunct(t, '(')) depth++
    else if (isPunct(t, ')')) depth--
    else if (isKw(t, 'CASE')) cases++
    else if (isKw(t, 'END')) cases--
    if (depth === 0 && cases === 0 && !isPunct(t, ')') && !isKw(t, 'END')) {
      if (isKw(t, 'BETWEEN')) between = true
      if (isPunct(t, ',') || (isKw(t, 'AND') && !between)) {
        items.push([])
        return
      }
      if (isKw(t, 'AND')) between = false
      const column = (x: Tok | undefined) => !!x && x.kind === 'name' && ctx.cols.has(lower(x.text))
      const startsColumn = column(t) || (isName(t) && isPunct(toks[i + 1], '.'))
      // "select shift count star", "select machine id sum of quantity": no comma said before a call either
      const startsCall = t.kind === 'kw' && SQL_FUNCS.has(t.text) && (isPunct(toks[i + 1], '(') || isPunct(toks[i + 1], '()'))
      // after "as total", a call can only be the next column: "sum of quantity as total average of quantity"
      const aliased = isName(prev) && cur.some((x) => isKw(x, 'AS'))
      const endsValue = column(prev) || isPunct(prev, ')') || isPunct(prev, '()') || (aliased && startsCall)
      if (cur.length && !isPunct(prev, '.') && ((endsValue && (startsColumn || startsCall)) || (isKw(prev, 'DESC', 'ASC') && !isKw(t, 'DESC', 'ASC')))) {
        items.push([t])
        return
      }
    }
    // "select machine id case when ...": a case right after a column starts the next column
    if (depth === 0 && cases === 1 && isKw(t, 'CASE') && cur.length && prev && prev.kind === 'name' && ctx.cols.has(lower(prev.text)) && !isPunct(toks[i - 2], '.')) {
      items.push([t])
      return
    }
    cur.push(t)
  })
  return items.filter((x) => x.length)
}

/** "as total scrap" -> AS total_scrap. */
function fixAlias(item: Tok[]): Tok[] {
  let depth = 0
  let at = -1
  item.forEach((t, i) => {
    if (isPunct(t, '(')) depth++
    else if (isPunct(t, ')')) depth--
    else if (depth === 0 && isKw(t, 'AS')) at = i
  })
  if (at < 0 || at === item.length - 1) return item
  const words = item
    .slice(at + 1)
    .map((t) => lower(t.text).replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, ''))
    .filter(Boolean)
  return words.length ? [...item.slice(0, at + 1), { kind: 'name', text: words.join('_') }] : item
}

const CLAUSE_STARTS = new Set(['SELECT', 'SELECT DISTINCT', 'FROM', 'WHERE', 'GROUP BY', 'HAVING', 'ORDER BY', 'LIMIT', 'JOIN', 'INNER JOIN', 'LEFT JOIN', 'ON'])

interface Segment {
  /** The clause keyword that started it; null for words said before any keyword; AND/OR when it opens with one. */
  kw: string | null
  toks: Tok[]
}

/** Cut one utterance into clauses. PARTITION BY and ORDER BY after OVER belong to the window, not the query. */
function segment(toks: Tok[]): Segment[] {
  const segs: Segment[] = [{ kw: null, toks: [] }]
  let depth = 0
  let inWindow = false
  let windowOrder = false
  toks.forEach((t, i) => {
    const cur = segs[segs.length - 1]
    if (isPunct(t, '(')) depth++
    else if (isPunct(t, ')')) depth = Math.max(0, depth - 1)
    if (depth > 0 || t.kind !== 'kw') {
      cur.toks.push(t)
      return
    }
    if (t.text === 'OVER') {
      inWindow = !isPunct(toks[i + 1], '(')
      windowOrder = false
      cur.toks.push(t)
      return
    }
    if (inWindow) {
      if (t.text === 'ORDER BY' && !windowOrder) {
        windowOrder = true
        cur.toks.push(t)
        return
      }
      if (t.text === 'AS' || CLAUSE_STARTS.has(t.text)) inWindow = false
    }
    if (i === 0 && (t.text === 'AND' || t.text === 'OR')) {
      segs[0].kw = t.text
      return
    }
    if (CLAUSE_STARTS.has(t.text)) segs.push({ kw: t.text, toks: [] })
    else cur.toks.push(t)
  })
  return segs.filter((s) => s.kw !== null || s.toks.length)
}

const stripTableWords = (toks: Tok[]) => toks.filter((t) => !(t.kind === 'name' && /^(table|tables)$/.test(lower(t.text))))
const usingList = (toks: Tok[]): Tok[] =>
  toks
    .filter((t) => t.kind === 'name')
    .flatMap((t, i) => (i ? [punct(','), t] : [t]))

function setDirection(item: Tok[], dir: Tok): Tok[] {
  const last = item[item.length - 1]
  return isKw(last, 'DESC', 'ASC') ? [...item.slice(0, -1), dir] : [...item, dir]
}

const LIST_KEYS: ClauseKey[] = ['select', 'groupBy', 'orderBy']

/** Left hanging: ends with an operator or a word that needs something after it ("greater than", "and", "as"). */
function dangling(toks: Tok[]): boolean {
  const t = toks[toks.length - 1]
  const prev = toks[toks.length - 2]
  if (!t) return false
  if (t.kind === 'op') return !(t.text === '*' && (!prev || isPunct(prev, '(') || isPunct(prev, ',') || isPunct(prev, '.')))
  if (isPunct(t, '.') || isPunct(t, '(') || isPunct(t, ',')) return true
  if (t.kind === 'kw' && SQL_FUNCS.has(t.text)) return true // "sum of" (pause) "quantity"
  return isKw(t, 'AND', 'OR', 'NOT', 'BETWEEN', 'IN', 'LIKE', 'WHEN', 'THEN', 'ELSE', 'AS', 'CASE', 'OVER', 'PARTITION BY', 'IS', 'ON', 'DISTINCT')
}

const openCase = (toks: Tok[]) => toks.filter((t) => isKw(t, 'CASE')).length > toks.filter((t) => isKw(t, 'END')).length

/** A window at the very end of a column: where its parenthesis opens and what it already has. */
function windowAtEnd(item: Tok[]): { open: number; hasOrder: boolean } | null {
  if (!isPunct(item[item.length - 1], ')')) return null
  let depth = 0
  for (let i = item.length - 1; i >= 0; i--) {
    if (isPunct(item[i], ')')) depth++
    else if (isPunct(item[i], '(') && --depth === 0) {
      if (!isKw(item[i - 1], 'OVER')) return null
      return { open: i, hasOrder: item.slice(i).some((t) => isKw(t, 'ORDER BY')) }
    }
  }
  return null
}

/** A window that stops right after "partition by" or "order by": the rest is still to come. */
const hangingWindow = (item: Tok[]) => isPunct(item[item.length - 1], ')') && isKw(item[item.length - 2], 'PARTITION BY', 'ORDER BY')

/** Put the rest of a window ("partition by ...", "order by ... as r") inside the parentheses that end the column. */
function intoWindow(item: Tok[], more: Tok[]): Tok[] {
  let depth = 0
  let as = more.length
  more.forEach((t, i) => {
    if (isPunct(t, '(')) depth++
    else if (isPunct(t, ')')) depth--
    else if (depth === 0 && isKw(t, 'AS') && as === more.length) as = i
  })
  return [...item.slice(0, -1), ...more.slice(0, as), punct(')'), ...more.slice(as)]
}

/** Words that can only be the next part of something already started. */
const startsMidway = (t: Tok | undefined) =>
  !!t && ((t.kind === 'op' && t.text !== '*') || isKw(t, 'BETWEEN', 'IN', 'LIKE', 'IS', 'IS NULL', 'IS NOT NULL', 'NOT'))

/** Apply one spoken utterance to the frame. */
export function applyUtterance(prev: Frame, utterance: string, schema: BuildSchema): Applied {
  const { text, append } = prepare(utterance, schema.year)
  const vocab = [...new Set([...schemaNames(schema), ...frameNames(prev), ...aliasesIn(text)])]
  const doc = dictate(emptyDoc(), text, 'sql', vocab)
  const ids = new Set(vocab.map(lower))
  const toks = qualify(
    aliasKeywords(
      doc.lines.flatMap((l) => l.toks).filter((t) => !(t.kind === 'name' && lower(t.text) === 'the')),
      new Set([...frameNames(prev), ...aliasesIn(text)].map(lower)),
    ),
    schema,
  ).map((t, i, all): Tok => {
    // "quantity x unit cost": times, written as the letter (unless the query has something named x)
    const operand = (o: Tok | undefined) => !!o && (o.kind === 'name' || o.kind === 'num' || isPunct(o, ')') || isPunct(o, '('))
    return isName(t, 'x') && !ids.has('x') && operand(all[i - 1]) && operand(all[i + 1]) && !isPunct(all[i - 1], '(') ? { kind: 'op', text: '*' } : t
  })
  const f = cloneFrame(prev)
  const q = f.main
  const ctx: Ctx = {
    ids,
    cols: new Set([...schema.tables.flatMap((t) => t.columns), ...frameNames(prev), ...aliasesIn(text)].map(lower)),
    schema,
  }
  const changed: Changed[] = []
  let note: string | undefined
  let windowOpen = false
  const mark = (key: ClauseKey, index?: number) => {
    f.last = key
    if (!changed.some((c) => c.key === key && c.index === index)) changed.push({ key, index })
  }
  const calls = (t: Tok[]) =>
    fixFunctions(t, ctx)
      .filter((x) => !(x.kind === 'name' && x.text === OF))
      // "end" heard as "and" right before a name: "... else large and as size"
      .map((x, i, all) => (isKw(x, 'AND') && isKw(all[i + 1], 'AS') ? kw('END') : x))
  // a condition has no windows, so "over" in one is a comparison: "where quantity over" (pause) "400"
  const cond = (t: Tok[]) => fixStrings(fixIs(fixIn(calls(t.map((x): Tok => (isKw(x, 'OVER') ? { kind: 'op', text: '>' } : x))))), ctx)
  const listOf = (t: Tok[]) => splitItems(fixStrings(fixIs(fixIn(fixWindows(calls(t)))), ctx), ctx)
  const addTo = (key: ClauseKey, items: Tok[][]) => {
    if (key === 'groupBy') q.groupBy.push(...items)
    else if (key === 'orderBy') q.orderBy.push(...items)
    else q.select.push(...items.map(fixAlias))
    mark(key)
  }
  const lastJoin = () => q.joins[q.joins.length - 1]
  /** Carry on with the column said last: its alias, the rest of its case, more of its expression. */
  const continueColumn = (more: Tok[]) => {
    const item = q.select[q.select.length - 1]
    const w = isKw(more[0], 'PARTITION BY') || hangingWindow(item) ? windowAtEnd(item) : null
    if (w) windowOpen = true
    q.select.splice(q.select.length - 1, 1, ...listOf(w ? intoWindow(item, more) : [...item, ...more]).map(fixAlias))
    mark('select')
  }

  segment(toks).forEach((seg, segIndex) => {
    switch (seg.kw) {
      case 'SELECT':
      case 'SELECT DISTINCT': {
        let rest = seg.toks
        let distinct = seg.kw === 'SELECT DISTINCT'
        if (isKw(rest[0], 'DISTINCT')) {
          distinct = true
          rest = rest.slice(1)
        }
        const items = listOf(rest).map(fixAlias)
        if (append) q.select.push(...items)
        else if (items.length) q.select = items
        if (distinct || (!append && items.length)) q.distinct = distinct
        if (items.length || distinct) mark('select')
        break
      }
      case 'FROM': {
        const table = stripTableWords(seg.toks)
        if (table.length) {
          q.from = table
          mark('from')
        }
        break
      }
      case 'JOIN':
      case 'INNER JOIN':
      case 'LEFT JOIN': {
        const rest = stripTableWords(seg.toks)
        const u = rest.findIndex((t) => isName(t, 'using'))
        const table = u >= 0 ? rest.slice(0, u) : rest
        if (!table.length) break
        q.joins.push({ kind: seg.kw, table, on: [], using: u >= 0 ? usingList(rest.slice(u + 1)) : [] })
        mark('join', q.joins.length - 1)
        break
      }
      case 'ON': {
        const j = lastJoin()
        if (!j) {
          note = "There's no join for that yet. Say join and a table first."
          break
        }
        // "on lot id": the column both tables share
        const shared = seg.toks.length > 0 && seg.toks.every((t) => (t.kind === 'name' && ctx.cols.has(lower(t.text))) || isPunct(t, ',') || isKw(t, 'AND'))
        if (shared) {
          j.using = usingList(seg.toks)
          j.on = []
        } else {
          j.on = cond(seg.toks)
          j.using = []
        }
        mark('join', q.joins.length - 1)
        break
      }
      case 'WHERE':
      case 'HAVING': {
        const key = seg.kw === 'WHERE' ? 'where' : 'having'
        const c = cond(seg.toks)
        if (!c.length) break
        q[key] = append && q[key].length ? [...q[key], kw('AND'), ...c] : c
        mark(key)
        break
      }
      case 'GROUP BY':
      case 'ORDER BY': {
        // "... rank over partition by machine id" (pause) "order by quantity descending as r": still the window
        const item = q.select[q.select.length - 1]
        const w = seg.kw === 'ORDER BY' && f.last === 'select' && item && (segIndex === 0 || windowOpen) ? windowAtEnd(item) : null
        if (w && !w.hasOrder && selectAlias(item) === null && seg.toks.length) {
          q.select.splice(q.select.length - 1, 1, ...listOf(intoWindow(item, [kw('ORDER BY'), ...seg.toks])).map(fixAlias))
          mark('select')
          break
        }
        const key = seg.kw === 'GROUP BY' ? 'groupBy' : 'orderBy'
        const items = listOf(seg.toks)
        if (!items.length) break
        q[key] = append ? [...q[key], ...items] : items
        mark(key)
        break
      }
      case 'LIMIT': {
        const n = seg.toks.filter((t) => t.kind === 'num' || isKw(t, 'OFFSET'))
        if (n.length) {
          q.limit = n
          mark('limit')
        }
        break
      }
      case 'AND':
      case 'OR': {
        if (!seg.toks.length) break
        const target = f.last === 'where' || f.last === 'having' || f.last === 'join' ? f.last : null
        if (target === 'join' && lastJoin()) {
          const j = lastJoin()
          j.on = cond(j.on.length ? [...j.on, kw(seg.kw), ...seg.toks] : seg.toks)
          mark('join', q.joins.length - 1)
        } else if (target === 'where' || target === 'having') {
          q[target] = cond(q[target].length ? [...q[target], kw(seg.kw), ...seg.toks] : seg.toks)
          mark(target)
        } else if (seg.kw === 'AND' && f.last && LIST_KEYS.includes(f.last)) {
          addTo(f.last, listOf(seg.toks))
        } else if (q.where.length) {
          q.where = cond([...q.where, kw(seg.kw), ...seg.toks])
          mark('where')
        } else note = "There's no condition to add that to yet. Start with where."
        break
      }
      default: {
        // words with no clause keyword in front
        if (seg.toks.length === 1 && isKw(seg.toks[0], 'DESC', 'ASC')) {
          if (q.orderBy.length) {
            q.orderBy[q.orderBy.length - 1] = setDirection(q.orderBy[q.orderBy.length - 1], seg.toks[0])
            mark('orderBy')
          } else note = "There's no order by yet."
          break
        }
        const comma = isPunct(seg.toks[0], ',')
        const rest = comma ? seg.toks.slice(1) : seg.toks
        if (!rest.length) break
        if (!comma && segIndex === 0) {
          // the rest of a condition the recognizer cut in two: "where quantity greater than" (pause) "400".
          // A condition left unfinished earlier takes it even if another clause was said in between.
          const open = unfinishedClause(f)
          const key = open === 'where' || open === 'having' ? open : f.last === 'where' || f.last === 'having' ? f.last : null
          if (key && (cut(q[key]) || startsMidway(rest[0]))) {
            q[key] = cond([...q[key], ...rest])
            mark(key)
            break
          }
          const j = lastJoin()
          if (f.last === 'join' && j && j.on.length && (dangling(j.on) || startsMidway(rest[0]))) {
            j.on = cond([...j.on, ...rest])
            mark('join', q.joins.length - 1)
            break
          }
          // the rest of the last column: its alias, more of its case, its window, the other side of an operator
          const item = q.select[q.select.length - 1]
          if (f.last === 'select' && item && (isKw(rest[0], 'AS', 'WHEN', 'THEN', 'ELSE', 'END', 'PARTITION BY', 'OVER') || startsMidway(rest[0]) || dangling(item) || openCase(item) || hangingWindow(item))) {
            continueColumn(rest)
            break
          }
        }
        // an expression on its own is a new column. It has to name something real (a name that only sounds
        // close doesn't count), and every word in it has to be accounted for, so a stray phrase adds nothing.
        const real = rest.some((t) => (t.kind === 'op' && t.text === '*') || (t.kind === 'kw' && SQL_FUNCS.has(t.text)) || isKw(t, 'CASE') || (t.kind === 'name' && !t.said && ctx.ids.has(lower(t.text))))
        if (!real) break
        const items = listOf(rest)
        const stray = items.some((item) => fixAlias(item).some((t, k, all) => t.kind === 'name' && !ctx.ids.has(lower(t.text)) && !isKw(all[k - 1], 'AS') && !isPunct(all[k - 1], '.')))
        if (stray) break
        addTo(comma && f.last && LIST_KEYS.includes(f.last) ? f.last : 'select', items)
      }
    }
  })
  if (!changed.length) return { frame: prev, changed, note: note ?? "I didn't catch a clause in that. Start with select, from, where, group by, order by or limit." }
  return { frame: f, changed, note }
}

const unbalanced = (toks: Tok[]) => toks.filter((t) => isPunct(t, '(')).length > toks.filter((t) => isPunct(t, ')')).length
const openBetween = (toks: Tok[]) => {
  const at = toks.map((t) => isKw(t, 'BETWEEN')).lastIndexOf(true)
  return at >= 0 && !toks.slice(at).some((t) => isKw(t, 'AND'))
}
const cut = (toks: Tok[]) => toks.length > 0 && (openCase(toks) || dangling(toks) || unbalanced(toks) || openBetween(toks) || hangingWindow(toks))

/**
 * The clause a pause left unfinished, if there is one: a case with no end, an operator with nothing after
 * it, a parenthesis not closed, a between with no "and". Running it would only report an error the
 * speaker didn't make, so the build loop waits for the rest instead.
 */
export function unfinishedClause(f: Frame): ClauseKey | null {
  const q = f.main
  if (q.select.some(cut)) return 'select'
  if (q.joins.some((j) => cut(j.on))) return 'join'
  if (cut(q.where)) return 'where'
  if (q.groupBy.some(cut)) return 'groupBy'
  if (cut(q.having)) return 'having'
  if (q.orderBy.some(cut)) return 'orderBy'
  return null
}

/** "name it ranked": the query so far becomes a named step, and the next query reads from it. */
export function nameStep(prev: Frame, name: string): Applied {
  if (!prev.main.from.length) return { frame: prev, changed: [], note: "There's nothing to name yet. Build a query first." }
  if (prev.ctes.some((c) => c.name === name)) return { frame: prev, changed: [], note: `There's already a step called ${name.replace(/_/g, ' ')}.` }
  const f = cloneFrame(prev)
  f.ctes.push({ name, query: f.main })
  f.main = emptyQuery()
  f.main.from = [{ kind: 'name', text: name }]
  f.last = 'from'
  return { frame: f, changed: [{ key: 'cte' }, { key: 'from' }] }
}

export type Removable = 'select' | 'from' | 'where' | 'groupBy' | 'having' | 'orderBy' | 'limit' | 'join' | 'distinct' | 'on'

export function removeClause(prev: Frame, what: Removable): Applied {
  const f = cloneFrame(prev)
  const q: Query = f.main
  const had = (() => {
    switch (what) {
      case 'select': {
        const n = q.select.length > 0 || q.distinct
        q.select = []
        q.distinct = false
        return n
      }
      case 'distinct': {
        const n = q.distinct
        q.distinct = false
        return n
      }
      case 'join':
        return !!q.joins.pop()
      case 'on': {
        const j = q.joins[q.joins.length - 1]
        const n = !!j && (j.on.length > 0 || j.using.length > 0)
        if (j) {
          j.on = []
          j.using = []
        }
        return n
      }
      case 'from': {
        const n = q.from.length > 0
        q.from = []
        return n
      }
      default: {
        const n = q[what].length > 0
        q[what] = []
        return n
      }
    }
  })()
  if (!had) return { frame: prev, changed: [], note: "There's nothing like that to remove." }
  f.last = null
  return { frame: f, changed: [{ key: what === 'distinct' ? 'select' : what === 'on' ? 'join' : what }] }
}

// ---------------------------------------------------------------- commands

export type BuildCommand =
  | { t: 'tables' }
  | { t: 'columns'; table: string }
  | { t: 'readBack' }
  | { t: 'results' }
  | { t: 'compare' }
  | { t: 'undo' }
  | { t: 'redo' }
  | { t: 'startOver' }
  | { t: 'remove'; what: Removable }
  | { t: 'name'; name: string }
  | { t: 'done' }
  | { t: 'showMe' }

const REMOVE_WORDS: Record<string, Removable> = {
  select: 'select', columns: 'select', from: 'from', where: 'where', filter: 'where', 'group by': 'groupBy', grouping: 'groupBy',
  having: 'having', 'order by': 'orderBy', ordering: 'orderBy', sort: 'orderBy', limit: 'limit', join: 'join', 'last join': 'join',
  distinct: 'distinct', on: 'on',
}

/** Commands for the build loop. Each must be the whole utterance, so "select the results column" is still a clause. */
export function parseBuildCommand(utterance: string, schema: BuildSchema): BuildCommand | null {
  const c = cleanUtterance(utterance)
  if (!c) return null
  if (/^(tables|the tables|what tables|what are the tables|what tables are there|which tables|list tables|list the tables|show tables|show me the tables|schema)$/.test(c)) return { t: 'tables' }
  const col = c.match(/^(?:columns|fields) (?:of|in|for|on) (?:the )?(.+?)(?: table)?$/) ?? c.match(/^describe (?:the )?(.+?)(?: table)?$/) ?? c.match(/^what(?:'s| is) in (?:the )?(.+?)(?: table)?$/) ?? c.match(/^(.+?) (?:columns|table)$/)
  if (col) {
    const said = col[1].replace(/\s+/g, '_')
    const table =
      schema.tables.find((t) => lower(t.name) === said) ??
      schema.tables.find((t) => editDistance(lower(t.name), said) <= 1) ??
      schema.tables.find((t) => lower(t.name).replace(/s$/, '') === said.replace(/s$/, ''))
    if (table) return { t: 'columns', table: table.name }
  }
  if (/^(read it back|read back|read that back|read the query|read my query|read it|what do i have|what do i have so far|where am i)$/.test(c)) return { t: 'readBack' }
  if (/^(results|read results|read the results|read the rows|show results|show me the results|what are the rows|rows|first rows|read rows)$/.test(c)) return { t: 'results' }
  if (/^(compare|compare it|check|check it|what's wrong|what is wrong|what's different|what is different|how close|am i close|how close am i|difference|what's missing)$/.test(c)) return { t: 'compare' }
  if (/^(undo|undo that|scratch that|scratch|take that back|go back)$/.test(c)) return { t: 'undo' }
  if (/^(redo|redo that|put it back)$/.test(c)) return { t: 'redo' }
  if (/^(start over|clear|clear all|clear everything|reset|clear the query)$/.test(c)) return { t: 'startOver' }
  const rm = c.match(/^(?:remove|drop|delete|clear|no|take out|lose) (?:the |my |that )?(.+?)(?: clause)?$/)
  if (rm && REMOVE_WORDS[rm[1]]) return { t: 'remove', what: REMOVE_WORDS[rm[1]] }
  const nm = c.match(/^(?:name|call|save) (?:it|this|that)(?: as)? (.+)$/) ?? c.match(/^save as (.+)$/) ?? c.match(/^(?:make (?:it|this|that) a )?(?:step|c t e|cte) (?:called|named) (.+)$/)
  if (nm) {
    const name = nm[1].replace(/[^a-z0-9 ]/g, '').trim().replace(/\s+/g, '_')
    if (name && /^[a-z]/.test(name)) return { t: 'name', name }
  }
  if (/^(done|i'm done|im done|i am done|run it|run|submit|submit it|that's my answer|final answer|check my answer|finished|that's it)$/.test(c)) return { t: 'done' }
  if (/^(show me|show me the answer|show me how|show the answer|how do you say it)$/.test(c)) return { t: 'showMe' }
  return null
}
