// Short phrases inside a spoken line of code, so each line is read with small pauses where a listener
// needs them: "Then (pause) x equals (pause) x (pause) plus 3."
//
// Pauses go after a leading "Then", at commas (but not between the items of a list), after "equals"
// (an assignment or a keyword argument), after a Python variable mentioned again after the line that
// defined it, and in SQL before each clause (from, where, group by, order by, having, limit, join, on).
// Names come from the drill's real code, so a multi-word name like "produced on" (produced_on) is never
// split, and the "on" inside it isn't taken for a clause.
import type { Drill, Lang } from '../data/types'
import { codePieces, sentences, type SpeechStyle } from './chunks'

const PY_KEYWORDS = new Set(['False', 'None', 'True', 'and', 'as', 'assert', 'break', 'class', 'continue', 'def', 'del', 'elif', 'else',
  'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise',
  'return', 'try', 'while', 'with', 'yield'])
// Words that are names in code but plain English (or builtins) when spoken: never treated as variables.
const NOT_VARIABLES = new Set(['self', '_', 'print', 'len', 'range', 'sum', 'max', 'min', 'sorted', 'int', 'str', 'float',
  'list', 'dict', 'set', 'tuple', 'abs', 'round', 'enumerate', 'zip', 'map', 'filter', 'type', 'any', 'all', 'reversed', 'key'])
// After a variable, these words continue the same expression ("stock at key pin", "name dot upper",
// "nums from index 1", "lots with a step of 2", "value of qty"), so no pause between them.
const ATTACHED = new Set(['of', 'dot', 'at', 'from', 'with'])
// Words that start a list whose items are read with commas: "the list 10, 20, 30".
const LIST_START = new Set(['list', 'strings', 'numbers', 'tuple', 'set'])
const CONNECTORS = new Set(['then', 'next', 'finally'])
const SQL_CLAUSES = [['from'], ['where'], ['group', 'by'], ['grouped', 'by'], ['order', 'by'], ['ordered', 'by'], ['having'], ['limit'],
  ['offset'], ['join'], ['joined', 'to'], ['union'], ['on']]
const JOIN_KINDS = new Set(['left', 'right', 'inner', 'outer', 'full', 'cross', 'natural'])

const spoken = (name: string) => name.toLowerCase().replace(/_+/g, ' ').trim()
const bare = (w: string) => w.toLowerCase().replace(/[.,;:!?]+$/, '')

function namesIn(list: string): string[] {
  return list
    .split(',')
    .map((p) => p.replace(/[()[\]*\s]/g, ' ').trim().split(/\s|:|=/)[0])
    .filter((n) => /^[A-Za-z_]\w*$/.test(n))
}

/** Python variables (not function names): assignment targets, parameters, loop and `as` names. */
export function pythonVariables(code: string): Set<string> {
  const out = new Set<string>()
  const add = (n: string) => {
    if (!PY_KEYWORDS.has(n) && !NOT_VARIABLES.has(n)) out.add(spoken(n))
  }
  for (const line of code.split('\n')) {
    const a = /^\s*([A-Za-z_][\w.[\]"', ]*?)\s*(?:\+|-|\*|\/\/|\/|%|\*\*)?=(?!=)/.exec(line)
    if (a && !/^\s*(def|class|if|elif|while|for|return|print)\b/.test(line)) for (const n of namesIn(a[1].replace(/\[.*?\]|\..*/g, ''))) add(n)
    const d = /^\s*def\s+\w+\s*\((.*)\)/.exec(line)
    if (d) for (const n of namesIn(d[1])) add(n)
    for (const f of line.matchAll(/\bfor\s+(.+?)\s+in\b/g)) for (const n of namesIn(f[1])) add(n)
    for (const s of line.matchAll(/\bas\s+([A-Za-z_]\w*)/g)) add(s[1])
    for (const l of line.matchAll(/\blambda\s+([^:]*):/g)) for (const n of namesIn(l[1])) add(n)
  }
  return out
}

/** Every multi-word identifier in the code, as it's spoken ("produced on" for produced_on), longest first. */
export function spokenIdentifiers(code: string): string[] {
  const ids = new Set<string>()
  for (const m of code.replace(/(["'])(?:\\.|(?!\1).)*\1/g, ' ').matchAll(/[A-Za-z_]\w*/g)) if (m[0].includes('_')) ids.add(spoken(m[0]))
  return [...ids].sort((a, b) => b.split(' ').length - a.split(' ').length)
}

interface Unit {
  from: number // word range in the piece
  to: number
  text: string // lowercased words, punctuation dropped
  comma: boolean // the unit ends with a comma
}

/** One line of spoken code cut into phrases. `pieceIndex` and `firstSeen` track where variables were defined. */
function splitPiece(piece: string, lang: Lang, idents: string[], variables: Set<string>, pieceIndex: number, firstSeen: Map<string, number>): string[] {
  const words = piece.split(' ').filter(Boolean)
  // group words into units, keeping multi-word names together
  const units: Unit[] = []
  for (let i = 0; i < words.length; ) {
    let len = 1
    for (const id of idents) {
      const parts = id.split(' ')
      if (parts.length > 1 && parts.every((p, k) => bare(words[i + k] ?? '') === p)) {
        len = parts.length
        break
      }
    }
    units.push({ from: i, to: i + len, text: words.slice(i, i + len).map(bare).join(' '), comma: /,$/.test(words[i + len - 1]) })
    i += len
  }
  const at = (k: number) => units[k]?.text ?? ''
  const cutAfter = new Set<number>() // unit indexes followed by a pause

  // commas: a clause boundary, unless it separates the short items of a list ("the list 10, 20, 30")
  // or a date's year ("February 28th, 2026")
  const wordsIn = (a: number, b: number) => units.slice(a, b).reduce((n, x) => n + (x.to - x.from), 0)
  let listFrom = -1 // where the current list's items start, or -1
  let itemFrom = 0 // first unit after the last comma
  units.forEach((u, k) => {
    if (LIST_START.has(u.text)) listFrom = k + 1
    if (!u.comma) return
    let end = k + 1 // the next item runs to the next comma, "and", "or", or the end of the sentence
    while (end < units.length && !units[end].comma && !/^(and|or)$/.test(at(end)) && !/[.!?]$/.test(words[units[end].to - 1])) end++
    const nextLen = wordsIn(k + 1, Math.min(end + 1, units.length))
    const prevLen = wordsIn(Math.max(itemFrom, listFrom), k + 1)
    const inList = listFrom >= 0 && listFrom <= k && prevLen <= 2 && nextLen <= 2
    const year = /^\d+(st|nd|rd|th)$/.test(u.text) && /^\d{4}$/.test(at(k + 1))
    itemFrom = k + 1
    if (inList || year) return
    cutAfter.add(k)
    listFrom = -1
  })

  units.forEach((u, k) => {
    if (k === 0 && CONNECTORS.has(u.text)) cutAfter.add(k)
    if (u.text === 'equals') cutAfter.add(k)
    // a variable named a, unless it's the article ("a dictionary", "a list comprehension")
    const article = u.text === 'a' && !/^(times|plus|minus|divided|mod|intersect|union|is|equals|and|or)?$/.test(at(k + 1))
    if (lang === 'python' && variables.has(u.text) && !article) {
      if (!firstSeen.has(u.text)) firstSeen.set(u.text, pieceIndex)
      const assigned = at(k + 1) === 'equals' || (/^(plus|minus|times)$/.test(at(k + 1)) && at(k + 2) === 'equals')
      const before = at(k - 1)
      // not inside "the string x", and not before words that continue the expression ("stock at key pin")
      if (firstSeen.get(u.text)! < pieceIndex && !assigned && before !== 'string' && before !== 'strings' && !ATTACHED.has(at(k + 1))) {
        cutAfter.add(k)
      }
    }
    if (lang === 'sql' && k > 0 && !JOIN_KINDS.has(at(k - 1)) && SQL_CLAUSES.some((c) => c.every((w, j) => at(k + j) === w))) cutAfter.add(k - 1)
    if (lang === 'sql' && k > 0 && JOIN_KINDS.has(u.text) && /^(join|joined|outer)$/.test(at(k + 1)) && !JOIN_KINDS.has(at(k - 1))) cutAfter.add(k - 1)
  })
  cutAfter.delete(units.length - 1)

  const phrases: string[] = []
  let start = 0
  units.forEach((u, k) => {
    if (cutAfter.has(k)) {
      phrases.push(words.slice(units[start].from, u.to).join(' '))
      start = k + 1
    }
  })
  if (start < units.length) phrases.push(words.slice(units[start].from).join(' '))
  return phrases
}

/** The drill's spoken code: one array of phrases per line, word for word. */
export function codePhrases(code: string | undefined, codeSpoken: string | undefined, lang: Lang): string[][] {
  const pieces = codePieces(codeSpoken)
  const src = code ?? ''
  const idents = spokenIdentifiers(src)
  const variables = lang === 'python' ? pythonVariables(src) : new Set<string>()
  const firstSeen = new Map<string, number>()
  return pieces.map((p, i) => splitPiece(p, lang, idents, variables, i, firstSeen))
}

export interface CodeLine {
  /** The whole line, as written in the drill. */
  text: string
  /** The line as spoken in phrases: every phrase but the last ends in a comma, so the voice sounds
   * like there's more to come rather than ending a sentence. One phrase means no pauses inside. */
  phrases: string[]
}

/** A drill's spoken code, line by line, ready for the voice. */
export function codeLines(d: Pick<Drill, 'code' | 'code_spoken' | 'lang'>): CodeLine[] {
  const pieces = codePieces(d.code_spoken)
  return codePhrases(d.code, d.code_spoken, d.lang).map((phrases, i) => ({
    text: pieces[i],
    phrases: phrases.map((p, k) => (k < phrases.length - 1 && !/[,.;:!?]$/.test(p) ? `${p},` : p)),
  }))
}

/** Every pre-rendered sentence a drill can speak: its prompt, model answer and hints, each line of code
 * whole, and each phrase of the lines that have pauses inside. */
export function drillSpeech(d: Drill): { style: SpeechStyle; text: string }[] {
  const out: { style: SpeechStyle; text: string }[] = []
  for (const t of [d.prompt_spoken, d.model_answer_spoken, ...(d.hints_spoken ?? [])]) {
    for (const s of sentences(t ?? '')) out.push({ style: 'prose', text: s })
  }
  for (const line of codeLines(d)) {
    for (const s of sentences(line.text)) out.push({ style: 'code', text: s })
    if (line.phrases.length > 1) for (const p of line.phrases) for (const s of sentences(p)) out.push({ style: 'phrase', text: s })
  }
  return out
}
