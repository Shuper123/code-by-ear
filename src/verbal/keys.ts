// Voice grammar for the dictation editor.
// parseEditorCommand: whole-utterance commands that work in both modes (run it, undo, go to line 2
//   character 7, after equals, select word, keys mode...).
// parseKeys: Keys mode, where every word is a keystroke: letters (plain, NATO or Talon's alphabet),
//   "capital X", digits and numbers, symbols by name, space / tab / new line, backspace and delete
//   (with counts), and arrow-style moves. No spaces are added that you didn't say.
import { readSpokenNumber } from '../grading/normalize'
import type { EditorOp } from './editor'
import { targetCandidates } from './editor'

export type EditorCommand =
  | { t: 'run' }
  | { t: 'check' }
  | { t: 'undo' }
  | { t: 'redo' }
  | { t: 'readAll' }
  | { t: 'readLine'; line?: number }
  | { t: 'spellLine'; line?: number }
  | { t: 'where' }
  | { t: 'mode'; mode: 'keys' | 'code' }
  | { t: 'startOver' }
  | { t: 'ops'; ops: EditorOp[] }

export const NATO: Record<string, string> = {
  alpha: 'a', alfa: 'a', bravo: 'b', charlie: 'c', delta: 'd', echo: 'e', foxtrot: 'f', golf: 'g', hotel: 'h', india: 'i',
  juliet: 'j', juliett: 'j', kilo: 'k', lima: 'l', mike: 'm', november: 'n', oscar: 'o', papa: 'p', quebec: 'q', romeo: 'r',
  sierra: 's', tango: 't', uniform: 'u', victor: 'v', whiskey: 'w', whisky: 'w', xray: 'x', 'x-ray': 'x', yankee: 'y', zulu: 'z',
}
/** Talon's community alphabet: one syllable each, chosen not to sound alike. */
export const TALON: Record<string, string> = {
  air: 'a', bat: 'b', cap: 'c', drum: 'd', each: 'e', fine: 'f', gust: 'g', harp: 'h', sit: 'i', jury: 'j', crunch: 'k',
  look: 'l', made: 'm', near: 'n', odd: 'o', pit: 'p', quench: 'q', red: 'r', sun: 's', trap: 't', urge: 'u', vest: 'v',
  whale: 'w', plex: 'x', yank: 'y', zip: 'z',
}
/** How recognizers often write spoken letter names. */
const LETTER_SOUNDS: Record<string, string> = {
  ay: 'a', bee: 'b', be: 'b', see: 'c', sea: 'c', cee: 'c', dee: 'd', ee: 'e', eff: 'f', ef: 'f', gee: 'g', aitch: 'h',
  eye: 'i', jay: 'j', kay: 'k', el: 'l', ell: 'l', em: 'm', en: 'n', oh: 'o', pee: 'p', pea: 'p', queue: 'q', cue: 'q',
  are: 'r', ess: 's', es: 's', tee: 't', tea: 't', you: 'u', vee: 'v', ex: 'x', why: 'y', zee: 'z', zed: 'z',
}
const DIGITS: Record<string, string> = {
  zero: '0', oh: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9',
}

// Longest phrases first. Each maps to literal text.
const SYMBOLS: [string, string][] = [
  ['not equal to', '!='], ['not equals', '!='], ['is equal to', '=='], ['double equals', '=='], ['equal equal', '=='],
  ['greater than or equal to', '>='], ['less than or equal to', '<='], ['at least', '>='], ['at most', '<='],
  ['greater than', '>'], ['less than', '<'], ['plus equals', '+='], ['minus equals', '-='], ['times equals', '*='],
  ['floor divide', '//'], ['double slash', '//'], ['double star', '**'], ['to the power', '**'],
  ['open paren', '('], ['left paren', '('], ['close paren', ')'], ['right paren', ')'], ['empty parens', '()'],
  ['open bracket', '['], ['left bracket', '['], ['close bracket', ']'], ['right bracket', ']'], ['empty brackets', '[]'],
  ['empty list', '[]'], ['open brace', '{'], ['open curly', '{'], ['left brace', '{'], ['close brace', '}'],
  ['close curly', '}'], ['right brace', '}'], ['empty braces', '{}'], ['empty dict', '{}'],
  ['single quote', "'"], ['double quote', '"'], ['question mark', '?'], ['exclamation mark', '!'], ['exclamation point', '!'],
  ['at sign', '@'], ['dollar sign', '$'], ['percent sign', '%'], ['equal sign', '='], ['equals sign', '='],
  ['back slash', '\\'], ['forward slash', '/'], ['divided by', '/'], ['under score', '_'],
  ['equals', '='], ['equal', '='], ['plus', '+'], ['minus', '-'], ['dash', '-'], ['hyphen', '-'], ['times', '*'],
  ['star', '*'], ['asterisk', '*'], ['slash', '/'], ['percent', '%'], ['mod', '%'], ['colon', ':'], ['semicolon', ';'],
  ['comma', ','], ['dot', '.'], ['period', '.'], ['point', '.'], ['quote', '"'], ['apostrophe', "'"], ['underscore', '_'],
  ['hash', '#'], ['pound', '#'], ['bang', '!'], ['pipe', '|'], ['ampersand', '&'], ['caret', '^'], ['tilde', '~'],
  ['backslash', '\\'], ['backtick', '`'], ['dollar', '$'],
]

const COUNTABLE = new Set(['backspace', 'delete', 'left', 'right', 'up', 'down'])

function words(utterance: string): { w: string; raw: string }[] {
  // keep standalone symbols the recognizer may write ("x = 3"), drop sentence punctuation stuck to words
  return utterance
    .replace(/\b([a-z])-ray\b/gi, '$1ray')
    .split(/\s+/)
    .filter(Boolean)
    .map((raw) => {
      if (/^[^\w\s]+$/.test(raw)) return { w: raw, raw }
      const trimmed = raw.replace(/[.,!?;:]+$/, '').replace(/^["']+|["']+$/g, '')
      return { w: trimmed.toLowerCase(), raw: trimmed }
    })
    .filter((x) => x.w)
}

function clean(utterance: string): string {
  return utterance
    .toLowerCase()
    .replace(/[^\w\s'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(okay|ok|um|uh|please|now) /, '')
}

function num(ws: string[], i: number): { n: number; next: number } | null {
  const r = readSpokenNumber(ws, i)
  if (r && /^\d+$/.test(r.value)) return { n: Number(r.value), next: r.next }
  if (ws[i] === 'to' || ws[i] === 'too') return { n: 2, next: i + 1 }
  if (ws[i] === 'for') return { n: 4, next: i + 1 }
  return null
}

/** Whole-utterance commands. `vocab` helps find names ("after part id" finds part_id). In SQL, words that
 * start code ("select ...", "end") stay code: select a name there with "highlight". */
export function parseEditorCommand(utterance: string, vocab: string[] = [], lang: 'sql' | 'python' = 'python'): EditorCommand | null {
  const c = clean(utterance)
  if (!c) return null
  if (/^(run it|run|run the code|run the tests|i'm done|im done|done|finished|that's it|submit)$/.test(c)) return { t: 'run' }
  if (/^(check|check it|check syntax|check the code|any errors)$/.test(c)) return { t: 'check' }
  if (/^(scratch that|scratch|undo|undo that)$/.test(c)) return { t: 'undo' }
  if (/^(redo|redo that)$/.test(c)) return { t: 'redo' }
  if (/^(read it back|read back|read the code|read it|read all|read the whole thing)$/.test(c)) return { t: 'readAll' }
  if (/^(start over|clear all|clear everything)$/.test(c)) return { t: 'startOver' }
  if (/^(where am i|where's the cursor|where is the cursor|cursor)$/.test(c)) return { t: 'where' }
  if (/^(keys|keys mode|key mode|keyboard|keyboard mode|switch to keys|switch to keyboard|letters mode)$/.test(c)) return { t: 'mode', mode: 'keys' }
  if (/^(code|code mode|switch to code|words mode|verbal mode)$/.test(c)) return { t: 'mode', mode: 'code' }
  let m = /^(read|spell) (?:the )?line(?: (.+))?$/.exec(c)
  if (m) {
    const n = m[2] ? num(m[2].split(' '), 0) : null
    if (m[2] && !n) return null
    return { t: m[1] === 'read' ? 'readLine' : 'spellLine', line: n?.n }
  }
  if (/^(spell it|spell that|spell this line)$/.test(c)) return { t: 'spellLine' }

  // moving
  m = /^(?:(?:edit|go|jump|move|cursor)(?: to| at)?|goto|edit) ?(?:line (.+?))(?:,? (?:character|char|column|col|position|letter) (.+))?$/.exec(c)
  const bare = /^line (\S+(?: \S+)?)(?:,? (?:character|char|column|col|position) (.+))?$/.exec(c)
  const g = m ?? bare
  if (g) {
    const ln = num(g[1].split(' '), 0)
    const col = g[2] ? num(g[2].split(' '), 0) : null
    if (ln && ln.next === g[1].split(' ').length && (!g[2] || col)) return { t: 'ops', ops: [{ t: 'goto', line: ln.n, col: col?.n }] }
  }
  if (/^(start of line|line start|beginning of line|start of the line|beginning of the line|home)$/.test(c)) return { t: 'ops', ops: [{ t: 'home' }] }
  if (/^(end of line|line end|end of the line)$/.test(c) || (c === 'end' && lang === 'python')) return { t: 'ops', ops: [{ t: 'end' }] }
  if (/^(top|go to top|start of file|beginning|top of file)$/.test(c)) return { t: 'ops', ops: [{ t: 'top' }] }
  if (/^(bottom|go to bottom|end of file|end of code)$/.test(c)) return { t: 'ops', ops: [{ t: 'bottom' }] }
  if (/^(next match|find next|next one|again)$/.test(c)) return { t: 'ops', ops: [{ t: 'findNext' }] }
  m = /^(?:go |move |put the cursor |cursor )?(after|before) (.+)$/.exec(c)
  if (m) return { t: 'ops', ops: [{ t: 'find', where: m[1] as 'after' | 'before', target: m[2], candidates: targetCandidates(m[2].split(' '), vocab, lang) }] }
  m = /^(?:word )?(left|right)(?: word)?(?: (.+))?$/.exec(c)
  if (m && /word/.test(c)) {
    const n = m[2] ? num(m[2].split(' '), 0)?.n : 1
    if (n) return { t: 'ops', ops: [{ t: 'word', dir: m[1] as 'left' | 'right', n }] }
  }
  // selecting and deleting
  if (/^(select word|select the word|select this word)$/.test(c)) return { t: 'ops', ops: [{ t: 'select', what: 'word' }] }
  if (/^(select line|select the line|select this line)$/.test(c)) return { t: 'ops', ops: [{ t: 'select', what: 'line' }] }
  if (/^(select all|select everything)$/.test(c)) return { t: 'ops', ops: [{ t: 'select', what: 'all' }] }
  if (/^(select to end|select to the end|select to end of line)$/.test(c)) return { t: 'ops', ops: [{ t: 'select', what: 'toEnd' }] }
  if (/^(select to start|select to the start|select to start of line)$/.test(c)) return { t: 'ops', ops: [{ t: 'select', what: 'toStart' }] }
  if (/^(unselect|deselect|unselect that|clear selection)$/.test(c)) return { t: 'ops', ops: [{ t: 'unselect' }] }
  m = (lang === 'python' ? /^(?:select|highlight) (.+)$/ : /^highlight (.+)$/).exec(c)
  if (m) return { t: 'ops', ops: [{ t: 'find', where: 'select', target: m[1], candidates: targetCandidates(m[1].split(' '), vocab, lang) }] }
  if (/^(delete line|delete the line|delete this line|remove line|remove the line)$/.test(c)) return { t: 'ops', ops: [{ t: 'deleteLine' }] }
  if (/^(clear line|clear the line|clear this line)$/.test(c)) return { t: 'ops', ops: [{ t: 'clearLine' }] }
  if (/^(delete word|delete the word|backspace word|delete last word)$/.test(c)) return { t: 'ops', ops: [{ t: 'deleteWord' }] }
  if (/^(delete that|delete it|delete selection|delete the selection)$/.test(c)) return { t: 'ops', ops: [{ t: 'backspace', n: 1 }] }
  if (/^(indent|indent line|indent this line)$/.test(c)) return { t: 'ops', ops: [{ t: 'indent' }] }
  if (/^(dedent|outdent|unindent|dedent line|outdent line)$/.test(c)) return { t: 'ops', ops: [{ t: 'dedent' }] }
  // a whole utterance of only keystroke commands (backspace three, left 2) works in Code mode too
  const k = parseKeys(utterance)
  if (k.length && k.every((o) => o.t !== 'insert' && o.t !== 'newline' && o.t !== 'caps')) return { t: 'ops', ops: k }
  return null
}

/** Keys mode: the keystrokes in an utterance, in order. */
export function parseKeys(utterance: string): EditorOp[] {
  const ws = words(utterance)
  const w = ws.map((x) => x.w)
  const ops: EditorOp[] = []
  const type = (text: string) => {
    const last = ops[ops.length - 1]
    if (last && last.t === 'insert') last.text += text
    else ops.push({ t: 'insert', text })
  }
  let upperNext = false
  const letter = (ch: string) => {
    type(upperNext ? ch.toUpperCase() : ch)
    upperNext = false
  }
  let i = 0
  while (i < w.length) {
    const x = w[i]
    const two = `${x} ${w[i + 1] ?? ''}`
    // capitals
    if (x === 'capital' || x === 'uppercase' || x === 'upper' || x === 'shift') {
      upperNext = true
      i++
      continue
    }
    if (two === 'caps on' || two === 'caps lock' || two === 'all caps') {
      ops.push({ t: 'caps', on: true })
      i += 2
      continue
    }
    if (two === 'caps off') {
      ops.push({ t: 'caps', on: false })
      i += 2
      continue
    }
    // whitespace and line breaks
    if (x === 'space' || two === 'space bar') {
      type(' ')
      i += two === 'space bar' ? 2 : 1
      continue
    }
    if (x === 'tab' || (x === 'indent' && i === 0 && w.length > 1)) {
      type('    ')
      i++
      continue
    }
    if (two === 'new line' || two === 'next line' || x === 'newline' || x === 'enter') {
      ops.push({ t: 'newline' })
      i += x === 'newline' || x === 'enter' ? 1 : 2
      continue
    }
    if (x === 'dedent' || x === 'outdent' || x === 'unindent') {
      ops.push({ t: 'dedent' })
      i++
      continue
    }
    // deleting and moving, with an optional count: "backspace three", "left 2"
    let key: string | null = null
    if (x === 'backspace' || two === 'back space') key = 'backspace'
    else if (x === 'delete' && w[i + 1] !== 'word') key = 'delete'
    else if (COUNTABLE.has(x) && x !== 'backspace' && x !== 'delete') key = x
    if (key) {
      i += two === 'back space' ? 2 : 1
      let n = 1
      if (w[i] === 'times') i++
      const c = num(w, i)
      if (c && c.n > 0 && c.n <= 50) {
        n = c.n
        i = c.next
        if (w[i] === 'times') i++
      }
      if (key === 'backspace' || key === 'delete') ops.push({ t: key, n })
      else ops.push({ t: 'move', dir: key as 'left' | 'right' | 'up' | 'down', n })
      continue
    }
    if (two === 'delete word' || two === 'backspace word') {
      ops.push({ t: 'deleteWord' })
      i += 2
      continue
    }
    // symbols by name, longest first
    const sym = SYMBOLS.find(([p]) => {
      const parts = p.split(' ')
      return parts.every((pw, k) => w[i + k] === pw)
    })
    if (sym) {
      type(sym[1])
      i += sym[0].split(' ').length
      continue
    }
    // explicit digits: "number 3", "digit five"
    if ((x === 'number' || x === 'digit') && i + 1 < w.length) {
      const r = readSpokenNumber(w, i + 1)
      if (r) {
        type(r.value)
        i = r.next
        continue
      }
    }
    // letters
    if (x in NATO) {
      letter(NATO[x])
      i++
      continue
    }
    if (x in TALON) {
      letter(TALON[x])
      i++
      continue
    }
    if (/^[a-z]$/.test(x)) {
      letter(x)
      i++
      continue
    }
    if (/^[A-Z]{2,6}$/.test(ws[i].raw)) {
      // spelled letters heard as one word: "VAR"
      for (const ch of x) letter(ch)
      i++
      continue
    }
    // numbers: "3", "25", "twenty five", "three point five"
    if (x in DIGITS && x !== 'oh') {
      const r = readSpokenNumber(w, i)
      type(r ? r.value : DIGITS[x])
      i = r ? r.next : i + 1
      continue
    }
    const r = readSpokenNumber(w, i)
    if (r) {
      type(r.value)
      i = r.next
      continue
    }
    if (x in LETTER_SOUNDS) {
      letter(LETTER_SOUNDS[x])
      i++
      continue
    }
    // a symbol the recognizer wrote as itself
    if (/^[^\w\s]+$/.test(x)) {
      type(x)
      i++
      continue
    }
    // anything else is typed as the word itself
    const text = upperNext ? x[0].toUpperCase() + x.slice(1) : x
    upperNext = false
    type(text)
    i++
  }
  return ops
}
