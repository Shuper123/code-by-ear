// Verbal Syntax v0.1 (spec section 9): a spoken grammar where every symbol has a name, and this
// rules-based parser (no AI) turns the words into exact code.
//
// Pipeline: normalize words -> longest phrase first -> numbers -> vocabulary names (multi-word, fuzzy,
// sounds-alike) -> emit tokens while tracking indentation -> format with standard spacing.
// The code is kept as lines of tokens, so read-back, "scratch that" and "go to line" are exact.
import { readSpokenNumber } from '../grading/normalize'

export type VLang = 'sql' | 'python'
export type TokKind = 'kw' | 'name' | 'num' | 'str' | 'op' | 'punct' | 'comment'
export interface Tok {
  kind: TokKind
  text: string
  unary?: boolean
  /** The words actually said, when a name was matched to the vocabulary only by sounding close. */
  said?: string
}
export interface Line {
  indent: number
  toks: Tok[]
}
export interface Doc {
  lines: Line[]
  cursor: number
}

export function emptyDoc(): Doc {
  return { lines: [{ indent: 0, toks: [] }], cursor: 0 }
}

function cloneDoc(d: Doc): Doc {
  return { cursor: d.cursor, lines: d.lines.map((l) => ({ indent: l.indent, toks: l.toks.map((t) => ({ ...t })) })) }
}

// ---------------------------------------------------------------- phrase tables

type Action =
  | { t: 'toks'; toks: Tok[] }
  | { t: 'newline' }
  | { t: 'back' }
  | { t: 'quote'; f: boolean }
  | { t: 'comment' }
  | { t: 'snake' }
  | { t: 'camel' }
  | { t: 'cap' }
  | { t: 'spell' }

const op = (text: string): Action => ({ t: 'toks', toks: [{ kind: 'op', text }] })
const punct = (text: string): Action => ({ t: 'toks', toks: [{ kind: 'punct', text }] })
const kw = (text: string): Action => ({ t: 'toks', toks: [{ kind: 'kw', text }] })

function table(entries: [string[], Action][]): Map<string, Action> {
  const m = new Map<string, Action>()
  for (const [phrases, a] of entries) for (const p of phrases) m.set(p, a)
  return m
}

const COMMON: [string[], Action][] = [
  [['next', 'new line', 'newline', 'next line'], { t: 'newline' }],
  [['back'], { t: 'back' }],
  [['colon'], punct(':')],
  [['comma'], punct(',')],
  [['dot'], punct('.')],
  [['open paren', 'open parenthesis', 'left paren', 'open parens'], punct('(')],
  [['close paren', 'close parenthesis', 'right paren', 'close parens'], punct(')')],
  [['empty parens', 'empty parentheses', 'empty paren', 'open close paren'], punct('()')],
  [['open bracket', 'left bracket', 'open square bracket'], punct('[')],
  [['close bracket', 'right bracket', 'close square bracket'], punct(']')],
  [['empty list', 'empty brackets'], punct('[]')],
  [['open brace', 'left brace', 'open curly', 'open curly brace'], punct('{')],
  [['close brace', 'right brace', 'close curly', 'close curly brace'], punct('}')],
  [['empty dict', 'empty dictionary', 'empty braces'], punct('{}')],
  [['quote', 'open quote', 'begin quote', 'start quote'], { t: 'quote', f: false }],
  [['f quote', 'eff quote', 'f string quote'], { t: 'quote', f: true }],
  [['comment'], { t: 'comment' }],
  [['snake', 'snake case'], { t: 'snake' }],
  [['camel', 'camel case'], { t: 'camel' }],
  [['cap', 'capital'], { t: 'cap' }],
  [['spell'], { t: 'spell' }],
  [['equals', 'equal', 'gets'], op('=')],
  [['not equal to', 'is not equal to', 'not equals', 'does not equal'], op('!=')],
  [['greater than or equal to', 'is greater than or equal to', 'at least', 'is at least'], op('>=')],
  [['less than or equal to', 'is less than or equal to', 'at most', 'is at most'], op('<=')],
  [['greater than', 'is greater than', 'more than', 'is more than'], op('>')],
  [['less than', 'is less than', 'fewer than'], op('<')],
  [['plus equals', 'plus equal'], op('+=')],
  [['minus equals', 'minus equal'], op('-=')],
  [['times equals', 'times equal'], op('*=')],
  [['plus'], op('+')],
  [['minus'], op('-')],
  [['times', 'multiplied by'], op('*')],
  [['divided by', 'divide by', 'over'], op('/')],
  [['floor divide', 'floor divided by', 'floor division', 'integer divide'], op('//')],
  [['mod', 'modulo', 'modulus'], op('%')],
  [['to the power of', 'to the power'], op('**')],
  [['star', 'asterisk'], op('*')],
  [['semicolon'], punct(';')],
]

const PY_KEYWORDS = [
  'def', 'return', 'for', 'in', 'if', 'else', 'while', 'and', 'or', 'not', 'import', 'from', 'as', 'try', 'except',
  'with', 'lambda', 'pass', 'break', 'continue', 'is', 'class', 'yield', 'raise', 'finally', 'global', 'assert', 'del',
  'elif',
]

const PYTHON = table([
  ...COMMON,
  [['is equal to', 'double equals', 'equals equals', 'is equal', 'equal to'], op('==')],
  [['else if'], kw('elif')],
  [['for each'], kw('for')],
  [['true'], kw('True')],
  [['false'], kw('False')],
  [['none'], kw('None')],
  [['empty string'], { t: 'toks', toks: [{ kind: 'str', text: '""' }] }],
  ...PY_KEYWORDS.map((k): [string[], Action] => [[k], kw(k)]),
])

const SQL_KEYWORDS: [string[], string][] = [
  [['select'], 'SELECT'],
  [['select distinct'], 'SELECT DISTINCT'],
  [['distinct'], 'DISTINCT'],
  [['from'], 'FROM'],
  [['where'], 'WHERE'],
  [['and'], 'AND'],
  [['or'], 'OR'],
  [['not'], 'NOT'],
  [['as'], 'AS'],
  [['on'], 'ON'],
  [['in'], 'IN'],
  [['is'], 'IS'],
  [['null'], 'NULL'],
  [['is null'], 'IS NULL'],
  [['is not null'], 'IS NOT NULL'],
  [['like'], 'LIKE'],
  [['between'], 'BETWEEN'],
  [['having'], 'HAVING'],
  [['limit'], 'LIMIT'],
  [['offset'], 'OFFSET'],
  [['case'], 'CASE'],
  [['when'], 'WHEN'],
  [['then'], 'THEN'],
  [['else'], 'ELSE'],
  [['end'], 'END'],
  [['join'], 'JOIN'],
  [['inner join'], 'INNER JOIN'],
  [['left join', 'left outer join'], 'LEFT JOIN'],
  [['union'], 'UNION'],
  [['union all'], 'UNION ALL'],
  [['exists'], 'EXISTS'],
  [['with'], 'WITH'],
  [['over'], 'OVER'],
  [['group by'], 'GROUP BY'],
  [['order by'], 'ORDER BY'],
  [['partition by'], 'PARTITION BY'],
  [['descending', 'desc'], 'DESC'],
  [['ascending', 'asc'], 'ASC'],
  [['count'], 'COUNT'],
  [['sum'], 'SUM'],
  [['average', 'avg'], 'AVG'],
  [['min', 'minimum'], 'MIN'],
  [['max', 'maximum'], 'MAX'],
  [['row number'], 'ROW_NUMBER'],
  [['rank'], 'RANK'],
  [['dense rank'], 'DENSE_RANK'],
  [['lag'], 'LAG'],
  [['lead'], 'LEAD'],
  [['coalesce'], 'COALESCE'],
  [['upper'], 'UPPER'],
  [['lower'], 'LOWER'],
  [['length'], 'LENGTH'],
  [['round'], 'ROUND'],
  [['true'], 'TRUE'],
  [['false'], 'FALSE'],
]

const SQL = table([
  ...COMMON,
  [['is equal to', 'double equals', 'equals equals', 'is equal', 'equal to'], op('=')],
  [['concat', 'concatenate', 'double pipe'], op('||')],
  [['count star', 'count of star', 'count all'], { t: 'toks', toks: [{ kind: 'kw', text: 'COUNT' }, { kind: 'punct', text: '(' }, { kind: 'op', text: '*' }, { kind: 'punct', text: ')' }] }],
  ...SQL_KEYWORDS.map(([ph, k]): [string[], Action] => [ph, kw(k)]),
])

export const SQL_FUNCS = new Set([
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'ROW_NUMBER', 'RANK', 'DENSE_RANK', 'LAG', 'LEAD', 'COALESCE', 'UPPER', 'LOWER',
  'LENGTH', 'ROUND', 'ABS', 'SUBSTR', 'IFNULL', 'NULLIF', 'CAST', 'DATE', 'STRFTIME', 'TOTAL', 'GROUP_CONCAT',
])

/** "sum of qty" -> SUM(qty); "len of nums" -> len(nums). A shorthand for calls with one argument. */
const SQL_OF = new Map([
  ['sum', 'SUM'], ['count', 'COUNT'], ['average', 'AVG'], ['avg', 'AVG'], ['min', 'MIN'], ['minimum', 'MIN'],
  ['max', 'MAX'], ['maximum', 'MAX'], ['upper', 'UPPER'], ['lower', 'LOWER'], ['length', 'LENGTH'],
])
const PY_OF = new Set([
  'len', 'sum', 'sorted', 'max', 'min', 'int', 'str', 'float', 'list', 'set', 'dict', 'range', 'abs', 'round', 'print',
  'type', 'tuple', 'enumerate', 'reversed', 'any', 'all', 'bool',
])

const TABLES: Record<VLang, Map<string, Action>> = { python: PYTHON, sql: SQL }
const MAX_PHRASE = 6

const NATO: Record<string, string> = {
  alpha: 'a', alfa: 'a', bravo: 'b', charlie: 'c', delta: 'd', echo: 'e', foxtrot: 'f', golf: 'g', hotel: 'h',
  india: 'i', juliet: 'j', juliett: 'j', kilo: 'k', lima: 'l', mike: 'm', november: 'n', oscar: 'o', papa: 'p',
  quebec: 'q', romeo: 'r', sierra: 's', tango: 't', uniform: 'u', victor: 'v', whiskey: 'w', whisky: 'w', xray: 'x',
  yankee: 'y', zulu: 'z',
  // letter names as a recognizer often writes them
  bee: 'b', be: 'b', see: 'c', sea: 'c', dee: 'd', ee: 'e', ef: 'f', eff: 'f', gee: 'g', jay: 'j', kay: 'k', el: 'l',
  em: 'm', en: 'n', oh: 'o', pee: 'p', cue: 'q', queue: 'q', ar: 'r', are: 'r', es: 's', tee: 't', tea: 't', you: 'u',
  vee: 'v', ex: 'x', why: 'y', zed: 'z', zee: 'z',
  underscore: '_',
}
/** Inside quotes words are kept as said; "symbol dash" (or a quote holding just "dash") writes the symbol. */
const QUOTE_SYMBOLS: Record<string, string> = {
  dash: '-', hyphen: '-', space: ' ', comma: ',', dot: '.', period: '.', colon: ':', underscore: '_', slash: '/',
  plus: '+', equals: '=', percent: '%', hash: '#', at: '@', star: '*', exclamation: '!', question: '?',
  apostrophe: "'", semicolon: ';',
}

const DIGIT_WORDS: Record<string, string> = {
  zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9',
}

// ---------------------------------------------------------------- vocabulary matching

/** Common recognizer spellings of code names (risk table, spec section 16). */
const ALIASES: Record<string, string[]> = {
  qty: ['quantity', 'cutie', 'qt', 'q t y', 'que tee why'],
  len: ['lin', 'lens', 'linn', 'length'],
  nums: ['numbs', 'numbers', 'nums', 'num s'],
  df: ['d f', 'deaf', 'dee eff'],
  str: ['string'],
  int: ['integer'],
  idx: ['index'],
}

export interface VocabEntry {
  name: string
  words: string[]
  joined: string
  aliases: string[][]
}

export function buildVocab(vocab: string[]): VocabEntry[] {
  return vocab.map((name) => {
    const words = name
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .split(/[_\s]+/)
      .filter(Boolean)
      .map((w) => w.toLowerCase())
    return {
      name,
      words,
      joined: words.join(''),
      aliases: (ALIASES[name.toLowerCase()] ?? []).map((a) => a.split(' ')),
    }
  })
}

export function editDistance(a: string, b: string): number {
  if (a === b) return 0
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]
    prev[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1))
      diag = tmp
    }
  }
  return prev[b.length]
}

/** American Soundex: a simple sounds-alike key. */
export function soundex(word: string): string {
  const w = word.toLowerCase().replace(/[^a-z]/g, '')
  if (!w) return ''
  const codes: Record<string, string> = {
    b: '1', f: '1', p: '1', v: '1', c: '2', g: '2', j: '2', k: '2', q: '2', s: '2', x: '2', z: '2', d: '3', t: '3',
    l: '4', m: '5', n: '5', r: '6',
  }
  let out = w[0].toUpperCase()
  let last = codes[w[0]] ?? ''
  for (const ch of w.slice(1)) {
    const c = codes[ch] ?? ''
    if (c && c !== last) out += c
    if (ch !== 'h' && ch !== 'w') last = c
  }
  return (out + '000').slice(0, 4)
}

function fuzzyWord(spoken: string, target: string): boolean {
  if (spoken === target) return true
  if (target.length < 3 || spoken.length < 2) return false
  const limit = target.length <= 4 ? 1 : 2
  if (editDistance(spoken, target) <= limit) return true
  return spoken[0] === target[0] && Math.abs(spoken.length - target.length) <= 2 && soundex(spoken) === soundex(target)
}

interface NameMatch {
  name: string
  next: number
  exact: boolean
}

/** Match a vocabulary name at ws[i], longest first. */
export function matchVocab(ws: string[], i: number, vocab: VocabEntry[]): NameMatch | null {
  let best: NameMatch | null = null
  const consider = (m: NameMatch) => {
    if (!best || m.next > best.next || (m.next === best.next && m.exact && !best.exact)) best = m
  }
  for (const v of vocab) {
    const k = v.words.length
    const seg = ws.slice(i, i + k)
    if (seg.length === k) {
      if (seg.every((w, j) => w === v.words[j])) consider({ name: v.name, next: i + k, exact: true })
      else if (seg.every((w, j) => fuzzyWord(w, v.words[j]))) consider({ name: v.name, next: i + k, exact: false })
    }
    // the whole name said as one word ("partid") or close to it
    if (k > 1 && ws[i] !== undefined && (ws[i] === v.joined || fuzzyWord(ws[i], v.joined))) {
      consider({ name: v.name, next: i + 1, exact: ws[i] === v.joined })
    }
    // spelled out letters ("q t y")
    let j = i
    let letters = ''
    while (j < ws.length && /^[a-z]$/.test(ws[j]) && letters.length < v.joined.length) letters += ws[j++]
    if (j - i >= 2 && letters === v.joined) consider({ name: v.name, next: j, exact: true })
    for (const alias of v.aliases) {
      const seg2 = ws.slice(i, i + alias.length)
      if (seg2.length === alias.length && seg2.every((w, x) => w === alias[x])) consider({ name: v.name, next: i + alias.length, exact: true })
    }
  }
  return best
}

// ---------------------------------------------------------------- parsing

interface Word {
  raw: string
  w: string
}

// Recognizers sometimes write an operator as a symbol ("x = 2 + 3"); read it as its spoken name.
const SYMBOL_WORDS: Record<string, string> = {
  '=': 'equals', '==': 'double equals', '!=': 'not equal to', '>': 'greater than', '<': 'less than',
  '>=': 'at least', '<=': 'at most', '+': 'plus', '-': 'minus', '*': 'times', '/': 'divided by',
  '+=': 'plus equals', '-=': 'minus equals',
}

function splitWords(text: string): Word[] {
  return text
    .replace(/\b([a-z])-(quote|string)\b/gi, '$1 $2')
    .replace(/(\d),(\d{3})\b/g, '$1$2')
    .split(/\s+/)
    .flatMap((raw) => (SYMBOL_WORDS[raw] ? SYMBOL_WORDS[raw].split(' ') : [raw]))
    .map((raw) => raw.replace(/^[^\w']+|[^\w']+$/g, ''))
    .filter(Boolean)
    .map((raw) => ({ raw, w: raw.toLowerCase().replace(/’/g, "'") }))
}

function phraseAt(ws: string[], i: number, tbl: Map<string, Action>): { a: Action; next: number } | null {
  for (let k = Math.min(MAX_PHRASE, ws.length - i); k >= 1; k--) {
    const a = tbl.get(ws.slice(i, i + k).join(' '))
    if (a) return { a, next: i + k }
  }
  return null
}

const UNARY_AFTER = new Set(['(', '[', '{', ',', ':', '=', 'return', 'in', 'if', 'elif', 'while', 'and', 'or', 'not', 'else',
  'SELECT', 'WHERE', 'THEN', 'ELSE', 'WHEN', 'AND', 'OR', 'NOT', 'BY', 'LIMIT', 'IN'])

class Builder {
  doc: Doc
  private ofPending = 0
  constructor(
    doc: Doc,
    private lang: VLang,
  ) {
    this.doc = cloneDoc(doc)
  }
  private get line(): Line {
    return this.doc.lines[this.doc.cursor]
  }
  emit(t: Tok) {
    const toks = this.line.toks
    if (t.kind === 'op' && t.text === '-') {
      const prev = toks[toks.length - 1]
      if (!prev || prev.kind === 'op' || UNARY_AFTER.has(prev.text)) t = { ...t, unary: true }
    }
    toks.push(t)
  }
  /** After a value: close "len of ..." calls unless a dot chain continues ("count of l dot lot id"). */
  afterAtom(nextWord: string | undefined) {
    if (this.ofPending > 0 && nextWord !== 'dot') this.closePending()
  }
  openCall(name: Tok) {
    this.emit(name)
    this.emit({ kind: 'punct', text: '(' })
    this.ofPending++
  }
  newline() {
    this.closePending()
    const cur = this.line
    if (!cur.toks.length) return
    const last = cur.toks[cur.toks.length - 1]
    const indent = this.lang === 'python' ? cur.indent + (last.text === ':' ? 1 : 0) : 0
    this.doc.lines.splice(this.doc.cursor + 1, 0, { indent, toks: [] })
    this.doc.cursor++
  }
  back() {
    this.line.indent = Math.max(0, this.line.indent - 1)
  }
  closePending() {
    while (this.ofPending > 0) {
      this.line.toks.push({ kind: 'punct', text: ')' })
      this.ofPending--
    }
  }
}

function isReservedAt(ws: string[], i: number, lang: VLang): boolean {
  return !!phraseAt(ws, i, TABLES[lang]) || readSpokenNumber(ws, i) !== null
}

/** Apply one utterance of Verbal Syntax to a document. Returns a new document. */
export function dictate(doc: Doc, utterance: string, lang: VLang, vocabNames: string[]): Doc {
  const words = splitWords(utterance)
  const ws = words.map((x) => x.w)
  const vocab = buildVocab(vocabNames)
  const tbl = TABLES[lang]
  const b = new Builder(doc, lang)
  let i = 0
  const nameWord = (j: number) => !isReservedAt(ws, j, lang)

  while (i < ws.length) {
    const w = ws[i]

    // "sum of qty" / "len of nums": a call with one argument
    if (ws[i + 1] === 'of') {
      if (lang === 'sql' && SQL_OF.has(w)) {
        b.openCall({ kind: 'kw', text: SQL_OF.get(w)! })
        i += 2
        continue
      }
      if (lang === 'python' && PY_OF.has(w)) {
        b.openCall({ kind: 'name', text: w })
        i += 2
        continue
      }
    }

    const ph = phraseAt(ws, i, tbl)
    if (ph) {
      const a = ph.a
      i = ph.next
      switch (a.t) {
        case 'toks': {
          for (const t of a.toks) b.emit({ ...t })
          const last = a.toks[a.toks.length - 1]
          const isValue =
            last.text === '*' || last.kind === 'str' || last.text === ')' || last.text === '()' ||
            (last.kind === 'kw' && /^(True|False|None|NULL|TRUE|FALSE)$/.test(last.text))
          if (isValue) b.afterAtom(ws[i])
          break
        }
        case 'newline':
          b.newline()
          break
        case 'back':
          b.back()
          break
        case 'quote': {
          const parts: string[] = []
          while (i < ws.length && !(['end quote', 'close quote'].includes(`${ws[i]} ${ws[i + 1] ?? ''}`) || ws[i] === 'unquote')) {
            if (a.f && ws[i] === 'value' && ws[i + 1] === 'of') {
              i += 2
              const m = matchVocab(ws, i, vocab)
              if (m) {
                parts.push(`{${m.name}}`)
                i = m.next
              } else if (i < ws.length) {
                parts.push(`{${ws[i]}}`)
                i++
              }
              continue
            }
            if (ws[i] === 'symbol' && ws[i + 1] in QUOTE_SYMBOLS) {
              parts.push(`\u0000${QUOTE_SYMBOLS[ws[i + 1]]}`)
              i += 2
              continue
            }
            parts.push(words[i].raw)
            i++
          }
          if (ws[i] === 'unquote') i += 1
          else if (i < ws.length) i += 2
          // a quote holding one symbol name ("quote dash end quote") writes the symbol
          if (parts.length === 1 && parts[0].toLowerCase() in QUOTE_SYMBOLS) parts[0] = `\u0000${QUOTE_SYMBOLS[parts[0].toLowerCase()]}`
          const content = parts
            .join(' ')
            .replace(/ ?\u0000(.)/g, (_m, ch: string) => ch)
          const q = lang === 'sql' ? "'" : '"'
          const text = `${a.f ? 'f' : ''}${q}${content.replace(lang === 'sql' ? /'/g : /"/g, lang === 'sql' ? "''" : '\\"')}${q}`
          b.emit({ kind: 'str', text })
          b.afterAtom(ws[i])
          break
        }
        case 'comment': {
          const parts: string[] = []
          while (i < ws.length && `${ws[i]} ${ws[i + 1] ?? ''}` !== 'end comment') parts.push(words[i++].raw)
          if (i < ws.length) i += 2
          b.emit({ kind: 'comment', text: `${lang === 'sql' ? '--' : '#'} ${parts.join(' ')}`.trimEnd() })
          break
        }
        case 'snake':
        case 'camel': {
          const parts: string[] = []
          while (i < ws.length && nameWord(i)) parts.push(ws[i++])
          if (!parts.length) break
          const text =
            a.t === 'snake'
              ? parts.join('_')
              : parts[0] + parts.slice(1).map((p) => p[0].toUpperCase() + p.slice(1)).join('')
          b.emit({ kind: 'name', text })
          b.afterAtom(ws[i])
          break
        }
        case 'cap': {
          if (i < ws.length) {
            const m = matchVocab(ws, i, vocab)
            const base = m ? m.name : ws[i]
            i = m ? m.next : i + 1
            b.emit({ kind: 'name', text: base[0].toUpperCase() + base.slice(1) })
            b.afterAtom(ws[i])
          }
          break
        }
        case 'spell': {
          let out = ''
          let upper = false
          while (i < ws.length && ws[i] !== 'done') {
            const x = ws[i]
            const raw = words[i].raw
            if (x === 'cap' || x === 'capital') upper = true
            else if (/^[a-z]$/.test(x)) out += upper ? x.toUpperCase() : x
            else if (/^[A-Z]{2,}$/.test(raw)) out += raw.toLowerCase() // "DF" heard as one word
            else if (x in NATO) out += upper ? NATO[x].toUpperCase() : NATO[x]
            else if (x in DIGIT_WORDS) out += DIGIT_WORDS[x]
            else if (/^\d+$/.test(x)) out += x
            else break
            if (x !== 'cap' && x !== 'capital') upper = false
            i++
          }
          if (ws[i] === 'done') i++
          if (out) {
            b.emit({ kind: 'name', text: out })
            b.afterAtom(ws[i])
          }
          break
        }
      }
      continue
    }

    const num = readSpokenNumber(ws, i)
    if (num) {
      b.emit({ kind: 'num', text: num.value })
      i = num.next
      b.afterAtom(ws[i])
      continue
    }

    const m = matchVocab(ws, i, vocab)
    if (m) {
      b.emit(m.exact ? { kind: 'name', text: m.name } : { kind: 'name', text: m.name, said: ws.slice(i, m.next).join(' ') })
      i = m.next
      b.afterAtom(ws[i])
      continue
    }

    // anything else is a name, written as said
    i++
    if (/^[a-z_][a-z0-9_']*$/.test(w)) {
      b.emit({ kind: 'name', text: w.replace(/'/g, '') })
      b.afterAtom(ws[i])
    }
  }
  b.closePending()
  return b.doc
}

// ---------------------------------------------------------------- formatting

function needSpace(prev: Tok, cur: Tok, stack: string[], lang: VLang): boolean {
  const top = stack[stack.length - 1]
  if (cur.kind === 'comment') return true
  if ([',', ')', ']', '}', '.', ';'].includes(cur.text)) return false
  if (cur.text === ':' && cur.kind === 'punct') return false
  if (['(', '[', '{', '.'].includes(prev.text) && prev.kind === 'punct') return false
  if (prev.unary) return false
  if (prev.text === ':' && prev.kind === 'punct' && top === '[') return false
  if (lang === 'python' && top === '(' && ((cur.kind === 'op' && cur.text === '=') || (prev.kind === 'op' && prev.text === '='))) return false
  if (cur.text === '(' || cur.text === '()') {
    if (prev.kind === 'name' || prev.text === ')' || prev.text === ']') return false
    if (lang === 'sql' && prev.kind === 'kw' && SQL_FUNCS.has(prev.text)) return false
    return true
  }
  if (cur.text === '[' || cur.text === '[]') {
    if (prev.kind === 'name' || prev.kind === 'str' || prev.text === ')' || prev.text === ']') return cur.text === '[]'
    return true
  }
  return true
}

export function formatLine(toks: Tok[], lang: VLang): string {
  let out = ''
  const stack: string[] = []
  toks.forEach((t, i) => {
    if (i > 0 && t.kind === 'comment') out += '  ' // inline comments: two spaces before
    else if (i > 0 && needSpace(toks[i - 1], t, stack, lang)) out += ' '
    out += t.text
    if (t.kind === 'punct' && ['(', '[', '{'].includes(t.text)) stack.push(t.text)
    if (t.kind === 'punct' && [')', ']', '}'].includes(t.text)) stack.pop()
  })
  return out
}

export function render(doc: Doc, lang: VLang): string {
  const lines = doc.lines.filter((l) => l.toks.length)
  if (lang === 'sql') return lines.map((l) => formatLine(l.toks, lang)).join('\n')
  return lines.map((l) => '    '.repeat(l.indent) + formatLine(l.toks, lang)).join('\n')
}

/** One utterance from an empty document straight to code (used by tests and the self-check). */
export function verbalToCode(utterance: string, lang: VLang, vocab: string[] = []): string {
  return render(dictate(emptyDoc(), utterance, lang, vocab), lang)
}

// ---------------------------------------------------------------- reading code back

const SAY_OP: Record<string, string> = {
  '=': 'equals', '==': 'is equal to', '!=': 'not equal to', '>=': 'at least', '<=': 'at most', '>': 'greater than',
  '<': 'less than', '+': 'plus', '-': 'minus', '*': 'times', '/': 'divided by', '//': 'floor divide', '%': 'mod',
  '**': 'to the power', '+=': 'plus equals', '-=': 'minus equals', '*=': 'times equals', '||': 'concat',
}
const SAY_PUNCT: Record<string, string> = {
  '(': 'open paren', ')': 'close paren', '()': 'empty parens', '[': 'open bracket', ']': 'close bracket',
  '[]': 'empty list', '{': 'open brace', '}': 'close brace', '{}': 'empty dict', ',': 'comma', ':': 'colon',
  '.': 'dot', ';': 'semicolon',
}

export function speakTokens(toks: Tok[], lang: VLang): string {
  return toks
    .map((t, i) => {
      switch (t.kind) {
        case 'kw':
          if (t.text === 'elif') return 'else if'
          return t.text.toLowerCase().replace(/_/g, ' ')
        case 'name':
          return t.text.replace(/_/g, ' ')
        case 'num':
          return t.text.startsWith('-') ? `negative ${t.text.slice(1)}` : t.text
        case 'str': {
          const f = t.text.startsWith('f')
          const inner = t.text.slice(f ? 2 : 1, -1).replace(/\{([^}]*)\}/g, (_m, n: string) => `value of ${n.replace(/_/g, ' ')}`)
          return `${f ? 'f quote' : 'quote'} ${inner} end quote`.replace(/\s+/g, ' ')
        }
        case 'comment':
          return `comment ${t.text.replace(/^(#|--)\s*/, '')} end comment`
        case 'op':
          if (t.text === '*' && (lang === 'sql' || toks[i - 1]?.text === '(')) return 'star'
          if (t.unary && t.text === '-') return 'minus'
          return SAY_OP[t.text] ?? t.text
        default:
          return SAY_PUNCT[t.text] ?? t.text
      }
    })
    .join(' ')
}

export function speakLine(doc: Doc, index: number, lang: VLang): string {
  const l = doc.lines[index]
  if (!l) return `There's no line ${index + 1}.`
  const indent = lang === 'python' && l.indent ? `, indented ${l.indent === 1 ? 'once' : l.indent === 2 ? 'twice' : `${l.indent} times`}` : ''
  return `Line ${index + 1}${indent}. ${l.toks.length ? speakTokens(l.toks, lang) : 'empty'}.`
}

export function speakDoc(doc: Doc, lang: VLang): string {
  const parts = doc.lines.map((l, i) => (l.toks.length ? speakLine(doc, i, lang) : '')).filter(Boolean)
  return parts.length ? parts.join(' ') : "There's no code yet."
}

// ---------------------------------------------------------------- edit commands

export type EditCommand =
  | { t: 'scratch' }
  | { t: 'delete_line' }
  | { t: 'goto'; line: number }
  | { t: 'read_all' }
  | { t: 'read_line' }
  | { t: 'run' }
  | { t: 'start_over' }

/** Edit commands are never written into the code; each must be the whole utterance. */
export function parseEdit(utterance: string): EditCommand | null {
  const c = utterance
    .toLowerCase()
    .replace(/[^\w\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(okay|ok|um|uh|please) /, '')
  if (/^(scratch that|scratch|undo|undo that)$/.test(c)) return { t: 'scratch' }
  if (/^(delete line|delete the line|delete this line|remove line|remove the line)$/.test(c)) return { t: 'delete_line' }
  if (/^(read it back|read back|read the code|read it|read all|read the whole thing)$/.test(c)) return { t: 'read_all' }
  if (/^(read line|read the line|read this line|read current line)$/.test(c)) return { t: 'read_line' }
  if (/^(run it|run|run the code|run the tests|check it|i'm done|im done|done|finished|that's it)$/.test(c)) return { t: 'run' }
  if (/^(start over|clear|clear all|clear everything)$/.test(c)) return { t: 'start_over' }
  const m = c.match(/^(?:go to|goto|jump to) line (.+)$/)
  if (m) {
    const n = readSpokenNumber(m[1].split(' '), 0)
    if (n && /^\d+$/.test(n.value)) return { t: 'goto', line: Number(n.value) }
  }
  return null
}

export function applyEdit(doc: Doc, cmd: EditCommand): Doc {
  const d = cloneDoc(doc)
  if (cmd.t === 'delete_line') {
    if (d.lines.length <= 1) d.lines = [{ indent: 0, toks: [] }]
    else d.lines.splice(d.cursor, 1)
    d.cursor = Math.max(0, Math.min(d.cursor - 1, d.lines.length - 1))
  } else if (cmd.t === 'goto') {
    if (cmd.line >= 1 && cmd.line <= d.lines.length) d.cursor = cmd.line - 1
  } else if (cmd.t === 'start_over') {
    return emptyDoc()
  }
  return d
}
