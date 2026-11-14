// Normalizing spoken Predict answers (spec section 6): number words become digits, "true" and
// "none" match True and None, "one, two, three" matches a list, "index error" matches IndexError.
// Both the transcript and the expected output go through the same pipeline, then the token lists
// are compared (numbers compare by value unless the drill needs 3 and 3.0 kept apart).

const ONES: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19,
}
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
}
const DIGIT_WORDS: Record<string, string> = {
  zero: '0', oh: '0', o: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9',
}

const ERROR_PREFIXES = [
  'zero division', 'index', 'key', 'type', 'value', 'name', 'attribute', 'syntax', 'recursion', 'assertion',
  'runtime', 'overflow', 'import', 'lookup', 'arithmetic', 'not implemented', 'unbound local', 'file not found',
  'module not found', 'stop iteration', 'indentation',
]

// Removed wherever they appear (longest first). Both sides are normalized the same way.
const FILLER_PHRASES = [
  "i'm pretty sure", 'i am pretty sure', 'i think that', 'i think', 'i believe', 'i guess', 'pretty sure',
  'my answer is', 'the answer is', 'answer is', 'the output is', 'output is', 'the result is', 'result is',
  'it will print out', 'it would print out', 'it prints out', 'prints out', 'it will print', 'it would print',
  'it should print', 'it prints', 'that prints', 'this prints', 'it printed', 'it will output', 'it outputs',
  'it will return', 'it would return', 'it should return', 'it returns', 'that returns', 'this returns',
  'the query will return', 'the query returns', 'query returns', 'you get back', 'you get', 'we get',
  'it gives you', 'it gives', 'it shows', 'it says', 'it displays',
  'it will raise', 'it would raise', 'it raises', 'that raises', 'it throws', 'throws', 'you get an',
  "there's an", 'there is an', "there's a", 'there is a',
  'each on its own line', 'on its own line', 'on separate lines', 'one per line', 'in that order',
  "it's", 'it is', "that's", 'that is', 'which is', 'is printed', 'gets printed', 'are printed', 'is returned',
  'is raised', 'gets raised',
  'open bracket', 'close bracket', 'open paren', 'close paren', 'open brace', 'close brace', 'open quote',
  'close quote', 'end quote', 'quote', 'quotes',
  'a list of', 'the list of', 'the list', 'a list', 'list of', 'the strings', 'the string', 'a string',
  'the number', 'a number', 'the value', 'a value', 'a tuple of', 'a tuple', 'the tuple', 'a dictionary with',
  'a dictionary where', 'a dictionary', 'the dictionary', 'a dict', 'a set of', 'the set', 'the word',
  'the letters', 'the letter', 'the pairs', 'pairs', 'a pair', 'with just', 'just', 'only', 'exactly',
  'probably', 'maybe', 'um', 'uh', 'er', 'okay', 'ok', 'well', 'so',
]
// Words that separate items. They become boundaries so "ninety and one twenty" stays two numbers.
// ("and" is handled inside number parsing, so "a hundred and five" still reads as 105.)
const SEPARATORS = [
  'and then', 'followed by', 'new line', 'newline', 'next line', 'maps to', 'mapped to', 'map to', 'comma',
  'colon', 'space', 'then', 'with',
]
const BOUNDARY = '|'
const EXPLANATION_MARKERS = [' because ', ' since ', ' cause ', " 'cause ", ' which means ', ' so that ', ' meaning ']
const CONTEXT_NOUNS = new Set(['lot', 'lots', 'row', 'rows', 'machine', 'part', 'customer', 'order', 'product', 'number', 'rank', 'value'])

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
const FILLER_RE = new RegExp(`\\b(${[...FILLER_PHRASES].sort((a, b) => b.length - a.length).map(escapeRe).join('|')})\\b`, 'g')
const SEP_RE = new RegExp(`\\b(${[...SEPARATORS].sort((a, b) => b.length - a.length).map(escapeRe).join('|')})\\b`, 'g')
const ERROR_RE = new RegExp(`\\b(${ERROR_PREFIXES.map(escapeRe).join('|')}) ?errors?\\b`, 'g')

function isNumericToken(t: string): boolean {
  return /^-?\d+(\.\d+)?$/.test(t)
}

interface ReadNum {
  value: string
  next: number
}

function readNumberWords(tokens: string[], start: number): ReadNum | null {
  let i = start
  let total = 0
  let current = 0
  let any = false
  let last: 'none' | 'ones' | 'teen' | 'tens' | 'scale' = 'none'
  if (tokens[i] === 'a' && (tokens[i + 1] === 'hundred' || tokens[i + 1] === 'thousand')) {
    current = 1
    any = true
    last = 'ones'
    i++
  }
  while (i < tokens.length) {
    const w = tokens[i]
    if (w in ONES) {
      const v = ONES[w]
      if (last === 'ones' || last === 'teen') break
      if (last === 'tens' && v >= 10) break
      if (last === 'tens' && v === 0) break
      current += v
      any = true
      last = v >= 10 ? 'teen' : 'ones'
      i++
      continue
    }
    if (w in TENS) {
      if (last === 'ones' || last === 'teen' || last === 'tens') break
      current += TENS[w]
      any = true
      last = 'tens'
      i++
      continue
    }
    if (w === 'hundred') {
      if (!any || last === 'scale') break
      current = (current || 1) * 100
      last = 'scale'
      i++
      continue
    }
    if (w === 'thousand' || w === 'million') {
      if (!any) break
      total += (current || 1) * (w === 'thousand' ? 1000 : 1_000_000)
      current = 0
      last = 'scale'
      i++
      continue
    }
    if (w === 'and' && any && last === 'scale' && (tokens[i + 1] in ONES || tokens[i + 1] in TENS)) {
      i++
      continue
    }
    break
  }
  if (!any) return null
  const value = total + current
  return readDecimal(tokens, i, String(value))
}

function readDecimal(tokens: string[], i: number, intPart: string): ReadNum {
  if (tokens[i] === 'point' && i + 1 < tokens.length && (tokens[i + 1] in DIGIT_WORDS || /^\d+$/.test(tokens[i + 1]))) {
    let digits = ''
    i++
    while (i < tokens.length && (tokens[i] in DIGIT_WORDS || /^\d+$/.test(tokens[i]))) {
      digits += tokens[i] in DIGIT_WORDS ? DIGIT_WORDS[tokens[i]] : tokens[i]
      i++
    }
    return { value: `${intPart}.${digits}`, next: i }
  }
  return { value: intPart, next: i }
}

function convertNumbers(tokens: string[]): string[] {
  const out: string[] = []
  let i = 0
  while (i < tokens.length) {
    let t = tokens[i]
    let neg = false
    let j = i
    if ((t === 'negative' || t === 'minus') && j + 1 < tokens.length) {
      const nxt = tokens[j + 1]
      if (isNumericToken(nxt) || nxt in ONES || nxt in TENS || nxt === 'point') {
        neg = true
        j++
        t = tokens[j]
      }
    }
    if (isNumericToken(t)) {
      // "3 point 5" -> 3.5; a digit token already holding a decimal or a minus sign stays as it is
      const r: ReadNum = /^\d+$/.test(t) ? readDecimal(tokens, j + 1, t) : { value: t, next: j + 1 }
      let v = r.value
      if (neg) v = v.startsWith('-') ? v.slice(1) : `-${v}`
      out.push(v)
      i = r.next
      continue
    }
    if (t === 'point' && j + 1 < tokens.length && tokens[j + 1] in DIGIT_WORDS) {
      const r = readDecimal(tokens, j, '0')
      out.push((neg ? '-' : '') + r.value)
      i = r.next
      continue
    }
    const r = readNumberWords(tokens, j)
    if (r) {
      out.push((neg ? '-' : '') + r.value)
      i = r.next
      continue
    }
    out.push(tokens[i])
    i++
  }
  return out
}

/** Normalize an answer or an expected output into comparable tokens. */
export function answerTokens(input: string, opts: { cutExplanation?: boolean } = {}): string[] {
  let s = ` ${input.toLowerCase().replace(/[’‘`]/g, "'").replace(/[“”]/g, '"')} `
  // empty containers become words before brackets are stripped
  s = s
    .replace(/set\(\)/g, ' emptyset ')
    .replace(/\[\s*\]/g, ' emptylist ')
    .replace(/\{\s*\}/g, ' emptydict ')
    .replace(/\(\s*\)/g, ' emptytuple ')
    .replace(/(^|\s)(''|"")(?=\s|$)/g, ' emptystring ')
    .replace(/\ban? empty (list|dictionary|dict|set|tuple|string)\b|\bempty (list|dictionary|dict|set|tuple|string)\b/g, (_m, a, b) => {
      const k = (a ?? b) as string
      return ` empty${k === 'dictionary' ? 'dict' : k} `
    })
  if (opts.cutExplanation) {
    for (const m of EXPLANATION_MARKERS) {
      const at = s.indexOf(m)
      if (at > 0) s = s.slice(0, at)
    }
  }
  // thousands separators: 1,000 -> 1000
  s = s.replace(/\b(\d{1,3})((?:,\d{3})+)\b/g, (_m, a: string, b: string) => a + b.replace(/,/g, ''))
  // punctuation: keep decimal points between digits, a minus sign before a digit, and apostrophes inside words
  s = s
    .replace(/(\d)\.(\d)/g, '$1\u0000$2')
    .replace(/(^|[^\w])-(\d)/g, '$1\u0001$2')
    .replace(/(\w)'(\w)/g, '$1\u0002$2')
    .replace(/[^\w\s\u0000\u0001\u0002]/g, ` ${BOUNDARY} `)
    .replace(/\n/g, ` ${BOUNDARY} `)
    .replace(/_/g, ' ')
    .replace(/\u0000/g, '.')
    .replace(/\u0001/g, '-')
    .replace(/\u0002/g, "'")
  s = ` ${s.replace(/\s+/g, ' ').trim()} `
  s = s.replace(ERROR_RE, (_m, p: string) => ` ${p.replace(/ /g, '')}error `)
  s = s.replace(FILLER_RE, ' ').replace(SEP_RE, ` ${BOUNDARY} `)
  let tokens = s.split(/\s+/).filter(Boolean)
  tokens = convertNumbers(tokens).filter((t) => t !== BOUNDARY && t !== 'and')
  // drop context nouns in front of numbers ("lot 2" -> "2") and articles in front of words
  const out: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    const next = tokens[i + 1]
    if (CONTEXT_NOUNS.has(t) && next !== undefined && isNumericToken(next)) continue
    if ((t === 'a' || t === 'an' || t === 'the') && next !== undefined && /^[a-z][a-z']+$/.test(next)) continue
    out.push(t)
  }
  return out
}

function tokenEqual(a: string, b: string, strictNumbers: boolean): boolean {
  if (a === b) return true
  if (strictNumbers) return false
  if (isNumericToken(a) && isNumericToken(b)) return Number(a) === Number(b)
  return false
}

export function tokensEqual(a: string[], b: string[], strictNumbers = false): boolean {
  return a.length === b.length && a.every((t, i) => tokenEqual(t, b[i], strictNumbers))
}

export interface MatchOptions {
  strictNumbers?: boolean
}

/** Does a spoken answer match the expected output (or one of the accepted variants)? */
export function answersMatch(spoken: string, expected: string, accept: string[] = [], opts: MatchOptions = {}): boolean {
  const s = answerTokens(spoken, { cutExplanation: true })
  if (!s.length) return false
  for (const candidate of [expected, ...accept]) {
    const e = answerTokens(candidate)
    if (!e.length) continue
    if (tokensEqual(s, e, !!opts.strictNumbers)) return true
    // "clip clip" for clipclip, "1 2 3" heard as "123": compare with the spaces removed
    if (!opts.strictNumbers && s.join('') === e.join('')) return true
  }
  return false
}

/** Pull spoken line numbers out of an answer ("line 3", "the third line", "line three"). */
export function mentionedLines(spoken: string): number[] {
  const ordinals: Record<string, number> = {
    first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, last: -1,
  }
  const out = new Set<number>()
  const t = answerTokens(spoken)
  const raw = spoken.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/)
  for (let i = 0; i < t.length - 1; i++) if (t[i] === 'line' && /^\d+$/.test(t[i + 1])) out.add(Number(t[i + 1]))
  for (let i = 0; i < raw.length - 1; i++) if (raw[i] in ordinals && raw[i + 1] === 'line') out.add(ordinals[raw[i]])
  return [...out]
}
