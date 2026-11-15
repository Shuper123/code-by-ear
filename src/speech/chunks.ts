// How speech is cut into pieces. Shared by the app and the build script that pre-renders the
// neural voice (scripts/voice_texts.ts), so the same sentence always gets the same audio file.

// prose: ordinary sentences. code: a whole line of code, read slower. phrase: one phrase of a line of
// code, read at the code speed with its silence trimmed, so the pauses between phrases are only the
// ones the settings ask for.
export type SpeechStyle = 'prose' | 'code' | 'phrase'

export function normalizeSpeech(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** Sentences, split only where ., ! or ? is followed by a space (so "3.5" stays whole).
 * Sentences over `max` characters are cut at a comma, then at a space. */
export function sentences(text: string, max = 200): string[] {
  const clean = normalizeSpeech(text)
  if (!clean) return []
  const out: string[] = []
  let start = 0
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i]
    if (c !== '.' && c !== '!' && c !== '?') continue
    let j = i + 1
    while (j < clean.length && /[.!?"')\]]/.test(clean[j])) j++
    if (j === clean.length || clean[j] === ' ') {
      out.push(clean.slice(start, j).trim())
      start = j + 1
      i = j
    }
  }
  if (start < clean.length) out.push(clean.slice(start).trim())
  const result: string[] = []
  for (const s of out.filter(Boolean)) {
    let rest = s
    while (rest.length > max) {
      let cut = rest.lastIndexOf(', ', max)
      if (cut < max / 3) cut = rest.lastIndexOf(' ', max)
      if (cut <= 0) cut = max
      result.push(rest.slice(0, cut + 1).trim())
      rest = rest.slice(cut + 1).trim()
    }
    if (rest) result.push(rest)
  }
  return result
}

/** The spoken code of a drill, one piece per line of code, so it can be read with a pause after each.
 * Spot-the-bug code numbers its lines ("Line 1, ..."); other code is mostly one sentence per line. */
export function codePieces(codeSpoken: string | undefined): string[] {
  const clean = normalizeSpeech(codeSpoken ?? '')
  if (!clean) return []
  if (/^Line 1\b/.test(clean)) {
    return clean
      .split(/(?=\bLine \d+[.,])/)
      .map((s) => s.trim())
      .filter(Boolean)
  }
  return sentences(clean)
}

const COUNT_WORDS = ['', 'One line.', 'Two lines.', 'Three lines.', 'Four lines.', 'Five lines.', 'Six lines.',
  'Seven lines.', 'Eight lines.', 'Nine lines.', 'Ten lines.']

/** "Two lines." when the spoken pieces match the code line by line; otherwise nothing. */
export function lineCountPhrase(code: string | undefined, pieces: string[]): string | null {
  const n = (code ?? '').split('\n').filter((l) => l.trim()).length
  if (!n || n !== pieces.length || n >= COUNT_WORDS.length) return null
  return COUNT_WORDS[n]
}

/** cyrb53: a small, fast 53-bit string hash, written as 14 hex digits. */
function cyrb53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0')
}

/** The file name (without extension) of a sentence's audio. */
export function speechKey(style: SpeechStyle, sentence: string): string {
  return cyrb53(`${style}|${normalizeSpeech(sentence)}`)
}
