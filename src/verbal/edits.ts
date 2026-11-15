// Plain-English edits in the dictation editor: "change total to count", "replace 3 with 5 on line 2",
// "rename x to total", "add a colon at the end of line 1", "insert count after equals", "delete the colon
// on line 2", "swap lines 2 and 3", "move line 4 up". Rules handle these instantly; anything else that
// starts with an edit word can go to Claude, which may make only the change asked for.
import { readSpokenNumber } from '../grading/normalize'
import { gapBetween, targetCandidates, type EditorState } from './editor'
import { verbalToCode, type VLang } from './syntax'

export type NaturalEdit =
  | { t: 'replace'; find: string[]; findSaid: string; with: string; line?: number; all: boolean }
  | { t: 'insert'; text: string; at: 'end' | 'start'; line?: number }
  | { t: 'insertAt'; text: string; where: 'after' | 'before'; find: string[]; findSaid: string; line?: number }
  | { t: 'remove'; find: string[]; findSaid: string; line?: number }
  | { t: 'swap'; a: number; b: number }
  | { t: 'moveLine'; line?: number; dir: 'up' | 'down' }

/** Starts like an edit request (rules or AI may handle it). */
export const EDIT_VERB = /^(?:please\s+)?(change|replace|rename|swap|switch|add|insert|put|append|prepend|delete|remove|take out|move|fix|make|turn|use)\b/i

function clean(s: string): string {
  return s
    .toLowerCase()
    .replace(/[.!?]+$/, '')
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function lineNo(words: string): number | undefined {
  const r = readSpokenNumber(words.split(' '), 0)
  return r && /^\d+$/.test(r.value) ? Number(r.value) : undefined
}

/** Pulls "on line 3" / "in line three" off the end. */
function splitLine(s: string): { rest: string; line?: number } {
  const m = /^(.*?)\s+(?:on|in|at)\s+line\s+(\S+(?:\s\S+)?)$/.exec(s)
  if (!m) return { rest: s }
  const n = lineNo(m[2])
  return n ? { rest: m[1], line: n } : { rest: s }
}

const stripThe = (s: string) => s.replace(/^(?:the|a|an)\s+/, '')

export function parseNaturalEdit(utterance: string, lang: VLang, vocab: string[]): NaturalEdit | null {
  const c = clean(utterance).replace(/^please /, '')
  if (!EDIT_VERB.test(c)) return null
  const code = (said: string) => verbalToCode(stripThe(said), lang, vocab)
  const cands = (said: string) => targetCandidates(stripThe(said).split(' '), vocab, lang)
  let m: RegExpExecArray | null

  // swap lines 2 and 3
  m = /^(?:swap|switch) lines? (\S+(?: \S+)?) (?:and|with) (?:line )?(\S+(?: \S+)?)$/.exec(c)
  if (m) {
    const a = lineNo(m[1])
    const b = lineNo(m[2])
    if (a && b) return { t: 'swap', a, b }
  }
  // move line 4 up / move this line down
  m = /^move (?:line (\S+(?: \S+)?)|this line|the line|it) (up|down)$/.exec(c)
  if (m) return { t: 'moveLine', line: m[1] ? lineNo(m[1]) : undefined, dir: m[2] as 'up' | 'down' }

  // rename x to total (every one)
  m = /^rename (.+?) (?:to|as) (.+)$/.exec(c)
  if (m) return { t: 'replace', find: cands(m[1]), findSaid: stripThe(m[1]), with: code(m[2]), all: true }

  // change / replace A to / with B [on line N]
  m = /^(?:change|replace|swap|switch|make|turn) (.+?) (?:to|with|into|for) (.+)$/.exec(c)
  if (m) {
    const { rest, line } = splitLine(m[2])
    const left = splitLine(m[1])
    return { t: 'replace', find: cands(left.rest), findSaid: stripThe(left.rest), with: code(rest), line: line ?? left.line, all: false }
  }
  // add / insert / put B at the end (or start) of line N
  m = /^(?:add|insert|put|append|prepend) (.+?) (?:at|to) the (end|start|beginning) of (?:line (\S+(?: \S+)?)|the line|this line)$/.exec(c)
  if (m) return { t: 'insert', text: code(m[1]), at: m[2] === 'end' ? 'end' : 'start', line: m[3] ? lineNo(m[3]) : undefined }
  m = /^(?:append|add) (.+?) (?:on|to) line (\S+(?: \S+)?)$/.exec(c)
  if (m && lineNo(m[2])) return { t: 'insert', text: code(m[1]), at: 'end', line: lineNo(m[2]) }
  // insert B after / before A [on line N]
  m = /^(?:add|insert|put) (.+?) (after|before) (.+)$/.exec(c)
  if (m) {
    const { rest, line } = splitLine(m[3])
    return { t: 'insertAt', text: code(m[1]), where: m[2] as 'after' | 'before', find: cands(rest), findSaid: stripThe(rest), line }
  }
  // delete / remove A [on line N]
  m = /^(?:delete|remove|take out) (.+)$/.exec(c)
  if (m && !/^(?:line|the line|this line|word|the word|that|it|selection|the selection)$/.test(m[1])) {
    const { rest, line } = splitLine(m[1])
    return { t: 'remove', find: cands(rest), findSaid: stripThe(rest), line }
  }
  return null
}

function findIn(line: string, targets: string[]): { col: number; text: string } | null {
  let best: { col: number; text: string } | null = null
  for (const t of targets) {
    if (!t) continue
    const isWord = /^\w+$/.test(t)
    let idx = line.indexOf(t)
    while (idx >= 0 && isWord && ((idx > 0 && /\w/.test(line[idx - 1])) || /\w/.test(line[idx + t.length] ?? ''))) idx = line.indexOf(t, idx + 1)
    if (idx >= 0 && (!best || idx < best.col)) best = { col: idx, text: t }
  }
  return best
}

/** The line to search: the one named, else the cursor's line, else the first line that has it. */
function locate(st: EditorState, targets: string[], line?: number): { line: number; col: number; text: string } | null {
  if (line !== undefined) {
    const hit = st.lines[line - 1] !== undefined ? findIn(st.lines[line - 1], targets) : null
    return hit ? { line: line - 1, ...hit } : null
  }
  const order = [st.cursor.line, ...st.lines.map((_, i) => i).filter((i) => i !== st.cursor.line)]
  for (const li of order) {
    const hit = findIn(st.lines[li], targets)
    if (hit) return { line: li, ...hit }
  }
  return null
}


export function applyNaturalEdit(prev: EditorState, e: NaturalEdit, lang: VLang): { st: EditorState; note?: string; changedLine?: number } {
  const join = (a: string, b: string) => a + gapBetween(a, b, lang) + b
  const st: EditorState = { ...prev, lines: [...prev.lines], cursor: { ...prev.cursor }, anchor: null }
  const lineErr = (n?: number) => (n !== undefined && (n < 1 || n > st.lines.length) ? `There's no line ${n}.` : null)
  switch (e.t) {
    case 'swap': {
      const err = lineErr(e.a) ?? lineErr(e.b)
      if (err) return { st: prev, note: err }
      ;[st.lines[e.a - 1], st.lines[e.b - 1]] = [st.lines[e.b - 1], st.lines[e.a - 1]]
      st.cursor = { line: e.b - 1, col: st.lines[e.b - 1].length }
      return { st, changedLine: e.b }
    }
    case 'moveLine': {
      const li = (e.line ?? st.cursor.line + 1) - 1
      const to = e.dir === 'up' ? li - 1 : li + 1
      if (lineErr(li + 1) || to < 0 || to >= st.lines.length) return { st: prev, note: lineErr(li + 1) ?? `Line ${li + 1} can't move ${e.dir}.` }
      ;[st.lines[li], st.lines[to]] = [st.lines[to], st.lines[li]]
      st.cursor = { line: to, col: st.lines[to].length }
      return { st, changedLine: to + 1 }
    }
    case 'insert': {
      const li = (e.line ?? st.cursor.line + 1) - 1
      if (lineErr(li + 1)) return { st: prev, note: lineErr(li + 1)! }
      const s = st.lines[li]
      if (e.at === 'end') st.lines[li] = /^[,:;)\].]/.test(e.text) ? s.replace(/\s+$/, '') + e.text : join(s.replace(/\s+$/, ''), e.text)
      else {
        const ind = s.length - s.trimStart().length
        st.lines[li] = s.slice(0, ind) + join(e.text, s.slice(ind))
      }
      st.cursor = { line: li, col: e.at === 'end' ? st.lines[li].length : s.length - s.trimStart().length + e.text.length }
      return { st, changedLine: li + 1 }
    }
    case 'insertAt': {
      const hit = locate(st, e.find, e.line)
      if (!hit) return { st: prev, note: `I can't find ${e.findSaid}${e.line ? ` on line ${e.line}` : ''}.` }
      const s = st.lines[hit.line]
      const at = e.where === 'after' ? hit.col + hit.text.length : hit.col
      const head = s.slice(0, at)
      const tail = s.slice(at)
      const left = head + gapBetween(head, e.text, lang)
      st.lines[hit.line] = left + e.text + gapBetween(e.text, tail, lang) + tail
      st.cursor = { line: hit.line, col: (left + e.text).length }
      return { st, changedLine: hit.line + 1 }
    }
    case 'remove': {
      const hit = locate(st, e.find, e.line)
      if (!hit) return { st: prev, note: `I can't find ${e.findSaid}${e.line ? ` on line ${e.line}` : ''}.` }
      const s = st.lines[hit.line]
      let head = s.slice(0, hit.col)
      let tail = s.slice(hit.col + hit.text.length)
      if (/\s$/.test(head) && /^\s/.test(tail)) tail = tail.replace(/^\s+/, '')
      else if (/^\w/.test(hit.text) && /\s$/.test(head) && !tail) head = head.replace(/\s+$/, '')
      st.lines[hit.line] = head + tail
      st.cursor = { line: hit.line, col: head.length }
      return { st, changedLine: hit.line + 1 }
    }
    case 'replace': {
      if (!e.with) return { st: prev, note: "I didn't catch what to change it to." }
      if (e.all) {
        const t = e.find.find((x) => st.lines.some((l) => findIn(l, [x])))
        if (!t) return { st: prev, note: `I can't find ${e.findSaid}.` }
        const re = /^\w+$/.test(t) ? new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g') : new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')
        let first = -1
        st.lines = st.lines.map((l, i) => {
          const n = l.replace(re, e.with)
          if (n !== l && first < 0) first = i
          return n
        })
        return { st, changedLine: first + 1 }
      }
      const hit = locate(st, e.find, e.line)
      if (!hit) return { st: prev, note: `I can't find ${e.findSaid}${e.line ? ` on line ${e.line}` : ''}.` }
      const s = st.lines[hit.line]
      st.lines[hit.line] = s.slice(0, hit.col) + e.with + s.slice(hit.col + hit.text.length)
      st.cursor = { line: hit.line, col: hit.col + e.with.length }
      return { st, changedLine: hit.line + 1 }
    }
  }
}

/** Lines that differ between two versions (for keeping AI edits small). */
export function changedLines(a: string[], b: string[]): number {
  let n = Math.abs(a.length - b.length)
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) n++
  return n
}
