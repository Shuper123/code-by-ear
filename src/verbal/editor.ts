// The dictation editor: code as lines of text with a cursor and an optional selection, edited by voice.
// Keys mode types exactly what you say (one keystroke per word); Code mode turns Verbal Syntax into
// formatted code at the cursor. Both share moving, selecting, deleting and undo.
import { readSpokenNumber } from '../grading/normalize'
import { dictate, formatLine, matchVocab, buildVocab, speakTokens, SQL_FUNCS, type Doc, type Tok, type VLang } from './syntax'

export interface Pos {
  line: number // 0-based
  col: number // 0-based, between characters
}
export type EditorMode = 'keys' | 'code'

export interface EditorState {
  lines: string[]
  cursor: Pos
  anchor: Pos | null // selection from anchor to cursor
  caps: boolean
  mode: EditorMode
  lastFind?: string
}

/** What the screen shows: the code, the cursor and selection, the mode, and the checker's message. */
export interface EditorSnapshot {
  lines: string[]
  cursor: Pos
  anchor: Pos | null
  mode: EditorMode
  caps: boolean
  error?: { message: string; line?: number }
  status?: string
}

export function snapshot(st: EditorState, extra: Partial<EditorSnapshot> = {}): EditorSnapshot {
  return { lines: [...st.lines], cursor: { ...st.cursor }, anchor: st.anchor ? { ...st.anchor } : null, mode: st.mode, caps: st.caps, ...extra }
}

export function emptyEditor(mode: EditorMode = 'code'): EditorState {
  return { lines: [''], cursor: { line: 0, col: 0 }, anchor: null, caps: false, mode }
}

export function editorText(st: EditorState): string {
  return st.lines.join('\n').replace(/\s+$/, '')
}

export type EditorOp =
  | { t: 'insert'; text: string }
  | { t: 'newline' }
  | { t: 'backspace'; n: number }
  | { t: 'delete'; n: number }
  | { t: 'deleteWord' }
  | { t: 'move'; dir: 'left' | 'right' | 'up' | 'down'; n: number }
  | { t: 'word'; dir: 'left' | 'right'; n: number }
  | { t: 'home' }
  | { t: 'end' }
  | { t: 'top' }
  | { t: 'bottom' }
  | { t: 'goto'; line: number; col?: number }
  | { t: 'find'; where: 'after' | 'before' | 'select'; target: string; candidates?: string[] }
  | { t: 'findNext' }
  | { t: 'select'; what: 'word' | 'line' | 'all' | 'toEnd' | 'toStart' }
  | { t: 'unselect' }
  | { t: 'clearLine' }
  | { t: 'deleteLine' }
  | { t: 'indent' }
  | { t: 'dedent' }
  | { t: 'caps'; on: boolean }

const clone = (st: EditorState): EditorState => ({
  ...st,
  lines: [...st.lines],
  cursor: { ...st.cursor },
  anchor: st.anchor ? { ...st.anchor } : null,
})

const cmp = (a: Pos, b: Pos) => a.line - b.line || a.col - b.col
const clampPos = (st: EditorState, p: Pos): Pos => {
  const line = Math.max(0, Math.min(p.line, st.lines.length - 1))
  return { line, col: Math.max(0, Math.min(p.col, st.lines[line].length)) }
}

export function selection(st: EditorState): { start: Pos; end: Pos } | null {
  if (!st.anchor || cmp(st.anchor, st.cursor) === 0) return null
  return cmp(st.anchor, st.cursor) < 0 ? { start: st.anchor, end: st.cursor } : { start: st.cursor, end: st.anchor }
}

/** Remove the selected text (if any); the cursor ends where it was. */
function deleteSelection(st: EditorState): boolean {
  const sel = selection(st)
  st.anchor = null
  if (!sel) return false
  const { start, end } = sel
  const head = st.lines[start.line].slice(0, start.col)
  const tail = st.lines[end.line].slice(end.col)
  st.lines.splice(start.line, end.line - start.line + 1, head + tail)
  st.cursor = { ...start }
  return true
}

function insertText(st: EditorState, text: string) {
  deleteSelection(st)
  const parts = text.split('\n')
  const line = st.lines[st.cursor.line]
  const head = line.slice(0, st.cursor.col)
  const tail = line.slice(st.cursor.col)
  if (parts.length === 1) {
    st.lines[st.cursor.line] = head + text + tail
    st.cursor.col += text.length
    return
  }
  const newLines = [head + parts[0], ...parts.slice(1, -1), parts[parts.length - 1] + tail]
  st.lines.splice(st.cursor.line, 1, ...newLines)
  st.cursor = { line: st.cursor.line + parts.length - 1, col: parts[parts.length - 1].length }
}

const leading = (s: string) => s.length - s.trimStart().length

function newline(st: EditorState, lang: VLang) {
  deleteSelection(st)
  const line = st.lines[st.cursor.line]
  const head = line.slice(0, st.cursor.col)
  let indent = leading(line)
  if (indent > head.length) indent = head.length
  if (lang === 'python' && /:\s*(#.*)?$/.test(head.replace(/\s+$/, ''))) indent += 4
  insertText(st, '\n' + ' '.repeat(indent))
}

const isWordChar = (c: string) => /\w/.test(c)

function wordLeft(st: EditorState) {
  let { line, col } = st.cursor
  if (col === 0) {
    if (line > 0) st.cursor = { line: line - 1, col: st.lines[line - 1].length }
    return
  }
  const s = st.lines[line]
  while (col > 0 && !isWordChar(s[col - 1])) col--
  while (col > 0 && isWordChar(s[col - 1])) col--
  st.cursor = { line, col }
}

function wordRight(st: EditorState) {
  let { line, col } = st.cursor
  const s = st.lines[line]
  if (col >= s.length) {
    if (line < st.lines.length - 1) st.cursor = { line: line + 1, col: leading(st.lines[line + 1]) }
    return
  }
  while (col < s.length && isWordChar(s[col])) col++
  while (col < s.length && !isWordChar(s[col])) col++
  st.cursor = { line, col }
}

/** Find text after the cursor (wrapping), on the current line first. Returns the match start. */
function findFrom(st: EditorState, targets: string[], from: Pos): { pos: Pos; text: string } | null {
  const n = st.lines.length
  for (let k = 0; k <= n; k++) {
    const li = (from.line + k) % n
    const s = st.lines[li]
    const startCol = k === 0 ? from.col : 0
    let best: { col: number; text: string } | null = null
    for (const t of targets) {
      if (!t) continue
      const isWord = /^\w+$/.test(t)
      let idx = s.indexOf(t, startCol)
      while (idx >= 0 && isWord && ((idx > 0 && isWordChar(s[idx - 1])) || isWordChar(s[idx + t.length] ?? ''))) {
        idx = s.indexOf(t, idx + 1)
      }
      if (idx >= 0 && (!best || idx < best.col)) best = { col: idx, text: t }
    }
    if (best) return { pos: { line: li, col: best.col }, text: best.text }
    if (k === n && from.col === 0) break
  }
  return null
}

export interface ApplyResult {
  st: EditorState
  /** Something to say, for commands that answer ("I can't find equals"). */
  note?: string
}

export function applyOps(prev: EditorState, ops: EditorOp[], lang: VLang): ApplyResult {
  const st = clone(prev)
  let note: string | undefined
  for (const op of ops) {
    switch (op.t) {
      case 'insert': {
        let text = op.text
        if (st.caps) text = text.toUpperCase()
        insertText(st, text)
        break
      }
      case 'newline':
        newline(st, lang)
        break
      case 'backspace':
        if (deleteSelection(st)) break
        for (let i = 0; i < op.n; i++) {
          const { line, col } = st.cursor
          if (col > 0) {
            const s = st.lines[line]
            st.lines[line] = s.slice(0, col - 1) + s.slice(col)
            st.cursor.col--
          } else if (line > 0) {
            const prevLen = st.lines[line - 1].length
            st.lines[line - 1] += st.lines[line]
            st.lines.splice(line, 1)
            st.cursor = { line: line - 1, col: prevLen }
          }
        }
        break
      case 'delete':
        if (deleteSelection(st)) break
        for (let i = 0; i < op.n; i++) {
          const { line, col } = st.cursor
          const s = st.lines[line]
          if (col < s.length) st.lines[line] = s.slice(0, col) + s.slice(col + 1)
          else if (line < st.lines.length - 1) {
            st.lines[line] += st.lines[line + 1]
            st.lines.splice(line + 1, 1)
          }
        }
        break
      case 'deleteWord': {
        if (deleteSelection(st)) break
        const end = { ...st.cursor }
        wordLeft(st)
        st.anchor = end
        deleteSelection(st)
        break
      }
      case 'move':
        st.anchor = null
        for (let i = 0; i < op.n; i++) {
          const { line, col } = st.cursor
          if (op.dir === 'left') st.cursor = col > 0 ? { line, col: col - 1 } : line > 0 ? { line: line - 1, col: st.lines[line - 1].length } : st.cursor
          else if (op.dir === 'right')
            st.cursor = col < st.lines[line].length ? { line, col: col + 1 } : line < st.lines.length - 1 ? { line: line + 1, col: 0 } : st.cursor
          else if (op.dir === 'up') st.cursor = clampPos(st, { line: line - 1, col })
          else st.cursor = clampPos(st, { line: line + 1, col })
        }
        break
      case 'word':
        st.anchor = null
        for (let i = 0; i < op.n; i++) (op.dir === 'left' ? wordLeft : wordRight)(st)
        break
      case 'home':
        st.anchor = null
        st.cursor.col = st.cursor.col === leading(st.lines[st.cursor.line]) ? 0 : leading(st.lines[st.cursor.line])
        break
      case 'end':
        st.anchor = null
        st.cursor.col = st.lines[st.cursor.line].length
        break
      case 'top':
        st.anchor = null
        st.cursor = { line: 0, col: 0 }
        break
      case 'bottom':
        st.anchor = null
        st.cursor = { line: st.lines.length - 1, col: st.lines[st.lines.length - 1].length }
        break
      case 'goto':
        st.anchor = null
        if (op.line < 1 || op.line > st.lines.length) {
          note = st.lines.length === 1 ? 'There is only line 1.' : `There are ${st.lines.length} lines.`
          break
        }
        st.cursor = clampPos(st, { line: op.line - 1, col: op.col === undefined ? st.lines[op.line - 1].length : op.col - 1 })
        if (op.col !== undefined && op.col - 1 > st.lines[op.line - 1].length) {
          note = `Line ${op.line} has ${st.lines[op.line - 1].length} characters, so I went to the end.`
        }
        break
      case 'find': {
        const targets = op.candidates?.length ? op.candidates : [op.target]
        // search from just after the cursor, so repeating "after x" walks forward
        const from = clampPos(st, { line: st.cursor.line, col: st.cursor.col })
        const hit = findFrom(st, targets, from) ?? findFrom(st, targets, { line: 0, col: 0 })
        if (!hit) {
          note = `I can't find ${op.target}.`
          break
        }
        st.lastFind = hit.text
        const end = { line: hit.pos.line, col: hit.pos.col + hit.text.length }
        if (op.where === 'select') {
          st.anchor = hit.pos
          st.cursor = end
        } else {
          st.anchor = null
          st.cursor = op.where === 'after' ? end : hit.pos
        }
        break
      }
      case 'findNext': {
        if (!st.lastFind) {
          note = 'Say after or before something first.'
          break
        }
        const hit = findFrom(st, [st.lastFind], clampPos(st, { line: st.cursor.line, col: st.cursor.col + 1 }))
        if (!hit) note = `No more ${st.lastFind}.`
        else st.cursor = { line: hit.pos.line, col: hit.pos.col + st.lastFind.length }
        st.anchor = null
        break
      }
      case 'select': {
        const { line, col } = st.cursor
        const s = st.lines[line]
        if (op.what === 'line') {
          st.anchor = { line, col: leading(s) }
          st.cursor = { line, col: s.length }
        } else if (op.what === 'all') {
          st.anchor = { line: 0, col: 0 }
          st.cursor = { line: st.lines.length - 1, col: st.lines[st.lines.length - 1].length }
        } else if (op.what === 'toEnd') {
          st.anchor = { line, col }
          st.cursor = { line, col: s.length }
        } else if (op.what === 'toStart') {
          st.anchor = { line, col }
          st.cursor = { line, col: leading(s) }
        } else {
          let a = col
          let b = col
          while (a > 0 && isWordChar(s[a - 1])) a--
          while (b < s.length && isWordChar(s[b])) b++
          if (a === b && b < s.length) b++ // on a symbol: select that one character
          st.anchor = { line, col: a }
          st.cursor = { line, col: b }
        }
        break
      }
      case 'unselect':
        st.anchor = null
        break
      case 'clearLine': {
        const s = st.lines[st.cursor.line]
        st.lines[st.cursor.line] = ' '.repeat(leading(s))
        st.cursor.col = leading(s)
        st.anchor = null
        break
      }
      case 'deleteLine':
        st.anchor = null
        if (st.lines.length <= 1) st.lines = ['']
        else st.lines.splice(st.cursor.line, 1)
        st.cursor = clampPos(st, { line: Math.max(0, st.cursor.line - 1), col: Infinity })
        break
      case 'indent': {
        const s = st.lines[st.cursor.line]
        st.lines[st.cursor.line] = '    ' + s
        st.cursor.col += 4
        break
      }
      case 'dedent': {
        const s = st.lines[st.cursor.line]
        const k = Math.min(4, leading(s))
        st.lines[st.cursor.line] = s.slice(k)
        st.cursor.col = Math.max(0, st.cursor.col - k)
        break
      }
      case 'caps':
        st.caps = op.on
        break
    }
  }
  return { st, note }
}

// ---------------------------------------------------------------- lexing code back into tokens

const PY_KEYWORDS = new Set(['False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del',
  'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or', 'pass',
  'raise', 'return', 'try', 'while', 'with', 'yield'])
const SQL_KEYWORDS = new Set(['SELECT', 'FROM', 'WHERE', 'GROUP', 'BY', 'ORDER', 'HAVING', 'LIMIT', 'OFFSET', 'JOIN', 'LEFT', 'RIGHT',
  'INNER', 'OUTER', 'FULL', 'CROSS', 'ON', 'AS', 'AND', 'OR', 'NOT', 'IN', 'IS', 'NULL', 'LIKE', 'BETWEEN', 'DISTINCT', 'ASC', 'DESC',
  'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'WITH', 'UNION', 'ALL', 'EXISTS', 'OVER', 'PARTITION', 'TRUE', 'FALSE', 'USING', 'INTERSECT',
  'EXCEPT', 'CAST', 'ROWS', 'RANGE', 'PRECEDING', 'FOLLOWING', 'CURRENT', 'ROW', 'UNBOUNDED', 'NULLS', 'FIRST', 'LAST'])
const OPS = ['**=', '//=', '==', '!=', '>=', '<=', '<>', '+=', '-=', '*=', '/=', '%=', '//', '**', '->', '||', '=', '+', '-', '*', '/', '%', '<', '>', '&', '|', '^', '~', '@']
const PUNCT = new Set(['(', ')', '[', ']', '{', '}', ',', ':', '.', ';'])

/** Tokens of one line of code, in the same shape Verbal Syntax builds (so it formats the same way). */
export function lexLine(src: string, lang: VLang): Tok[] {
  const toks: Tok[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (c === ' ' || c === '\t') {
      i++
      continue
    }
    if ((lang === 'python' && c === '#') || (lang === 'sql' && src.startsWith('--', i))) {
      toks.push({ kind: 'comment', text: src.slice(i) })
      break
    }
    const sm = /^(?:[fFrRbB]{1,2})?("|')/.exec(src.slice(i))
    if (sm && (sm[0].length > 1 ? /^[fFrRbB]{1,2}["']/.test(src.slice(i)) : true)) {
      const q = sm[1]
      let j = i + sm[0].length
      while (j < src.length && src[j] !== q) j += src[j] === '\\' ? 2 : 1
      toks.push({ kind: 'str', text: src.slice(i, Math.min(j + 1, src.length)) })
      i = j + 1
      continue
    }
    const num = /^\d+(?:\.\d+)?/.exec(src.slice(i))
    if (num) {
      toks.push({ kind: 'num', text: num[0] })
      i += num[0].length
      continue
    }
    const word = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))
    if (word) {
      const w = word[0]
      const kw = lang === 'python' ? PY_KEYWORDS.has(w) : SQL_KEYWORDS.has(w.toUpperCase()) || SQL_FUNCS.has(w.toUpperCase())
      toks.push({ kind: kw ? 'kw' : 'name', text: w })
      i += w.length
      continue
    }
    const op = OPS.find((o) => src.startsWith(o, i))
    if (op) {
      const prev = toks[toks.length - 1]
      const unary = (op === '-' || op === '+') && (!prev || prev.kind === 'op' || (prev.kind === 'punct' && prev.text !== ')' && prev.text !== ']') || (prev.kind === 'kw' && !/^(True|False|None|NULL|TRUE|FALSE)$/.test(prev.text)))
      toks.push(unary ? { kind: 'op', text: op, unary: true } : { kind: 'op', text: op })
      i += op.length
      continue
    }
    toks.push({ kind: PUNCT.has(c) ? 'punct' : 'op', text: c })
    i++
  }
  return toks
}

/** Code mode: Verbal Syntax at the cursor. Text before the cursor on this line is re-formatted with
 * what you said; text after the cursor stays as it was. */
export function insertVerbal(prev: EditorState, utterance: string, lang: VLang, vocab: string[]): EditorState {
  const st = clone(prev)
  deleteSelection(st)
  const line = st.lines[st.cursor.line]
  const head = line.slice(0, st.cursor.col)
  const tail = line.slice(st.cursor.col)
  // the line's indentation: its leading spaces, or the spaces before the cursor on a blank line
  const indent = Math.floor((head.trim() ? leading(line) : head.length) / 4)
  const doc: Doc = { lines: [{ indent, toks: lexLine(head.trim(), lang) }], cursor: 0 }
  const out = dictate(doc, utterance, lang, vocab)
  const rendered = out.lines.map((l) => (lang === 'sql' ? '' : '    '.repeat(l.indent)) + formatLine(l.toks, lang))
  const last = rendered.length - 1
  const lastHead = rendered[last]
  const join = gapBetween(lastHead, tail, lang)
  const replaced = [...rendered.slice(0, last), lastHead + join + tail]
  st.lines.splice(st.cursor.line, 1, ...replaced)
  st.cursor = { line: st.cursor.line + last, col: lastHead.length + join.length }
  return st
}

/** A space where two pieces of code meet, if the formatter would put one there ("count" + "+ 1"). */
export function gapBetween(left: string, right: string, lang: VLang): string {
  if (!left || !right || /\s$/.test(left) || /^\s/.test(right)) return ''
  const a = lexLine(left, lang).at(-1)
  const b = lexLine(right, lang)[0]
  return a && b && formatLine([a, b], lang).length > a.text.length + b.text.length ? ' ' : ''
}

// ---------------------------------------------------------------- reading code back

export function lexDoc(st: EditorState, lang: VLang): Doc {
  const lines = st.lines.map((s) => ({ indent: Math.floor(leading(s) / 4), toks: lexLine(s.trim(), lang) }))
  return { lines, cursor: st.cursor.line }
}

export function speakEditorLine(st: EditorState, i: number, lang: VLang): string {
  const s = st.lines[i]
  if (s === undefined) return `There's no line ${i + 1}.`
  if (!s.trim()) return `Line ${i + 1} is empty.`
  const ind = Math.floor(leading(s) / 4)
  const where = ind === 0 ? '' : ind === 1 ? ', indented once' : `, indented ${ind} times`
  return `Line ${i + 1}${where}. ${speakTokens(lexLine(s.trim(), lang), lang)}.`
}

export function speakEditor(st: EditorState, lang: VLang): string {
  const parts = st.lines.map((_, i) => i).filter((i) => st.lines[i].trim()).map((i) => speakEditorLine(st, i, lang))
  return parts.length ? parts.join(' ') : "There's no code yet."
}

const SPELL_NAMES: Record<string, string> = {
  ' ': 'space', '(': 'open paren', ')': 'close paren', '[': 'open bracket', ']': 'close bracket', '{': 'open brace',
  '}': 'close brace', ',': 'comma', ':': 'colon', '.': 'dot', ';': 'semicolon', '=': 'equals', '+': 'plus', '-': 'minus',
  '*': 'star', '/': 'slash', '%': 'percent', '<': 'less than', '>': 'greater than', '"': 'quote', "'": 'single quote',
  '_': 'underscore', '#': 'hash', '!': 'bang', '&': 'ampersand', '|': 'pipe', '@': 'at', '\\': 'backslash',
}

/** Character by character, for checking spelling: "p r i n t, open paren, x, close paren". */
export function spellLine(st: EditorState, i: number): string {
  const s = (st.lines[i] ?? '').trimStart()
  if (!s) return `Line ${i + 1} is empty.`
  const parts: string[] = []
  let run = ''
  for (const ch of s) {
    if (/[a-z0-9]/i.test(ch)) run += (run ? ' ' : '') + (/[A-Z]/.test(ch) ? `capital ${ch}` : ch)
    else {
      if (run) parts.push(run)
      run = ''
      if (ch !== ' ' || parts[parts.length - 1] !== 'space') parts.push(SPELL_NAMES[ch] ?? ch)
    }
  }
  if (run) parts.push(run)
  return `Line ${i + 1}: ${parts.join(', ')}.`
}

/** "Line 2, character 7, after equals." */
export function whereAmI(st: EditorState): string {
  const { line, col } = st.cursor
  const s = st.lines[line]
  const before = s.slice(0, col).trimEnd()
  const lastTok = before ? before.match(/(\w+|\S)$/)?.[0] : ''
  const after = !lastTok ? 'at the start of the line' : col >= s.trimEnd().length ? 'at the end of the line' : `after ${SPELL_NAMES[lastTok] ?? lastTok.replace(/_/g, ' ')}`
  return `Line ${line + 1}, character ${col + 1}, ${after}.`
}

/** Words for a search target: symbols by name, numbers, and names from the drill (joined with _). */
export function targetCandidates(words: string[], vocab: string[], lang: VLang = 'python'): string[] {
  const phrase = words.join(' ')
  const sym = SYMBOL_TARGETS[phrase]
  if (sym) return sym
  const num = readSpokenNumber(words, 0)
  if (num && num.next === words.length) return [num.value]
  const out: string[] = []
  const m = matchVocab(words, 0, buildVocab(vocab))
  if (m && m.next === words.length) out.push(m.name)
  out.push(words.join('_'), words.join(''), phrase)
  if (lang === 'sql') out.push(...out.map((x) => x.toUpperCase())) // SQL keywords are written in capitals
  return [...new Set(out)]
}

const SYMBOL_TARGETS: Record<string, string[]> = {
  'plus equals': ['+='], 'minus equals': ['-='], 'not equal': ['!='], 'not equal to': ['!='], 'is equal to': ['=='],
  'greater than or equal to': ['>='], 'at least': ['>='], 'at most': ['<='],
  equals: ['='], 'equal sign': ['='], 'double equals': ['=='], colon: [':'], comma: [','], dot: ['.'], period: ['.'],
  paren: ['(', ')'], 'open paren': ['('], 'close paren': [')'], bracket: ['[', ']'], 'open bracket': ['['],
  'close bracket': [']'], brace: ['{', '}'], quote: ['"', "'"], plus: ['+'], minus: ['-'], star: ['*'], times: ['*'],
  slash: ['/'], 'greater than': ['>'], 'less than': ['<'], semicolon: [';'], hash: ['#'], underscore: ['_'],
}
