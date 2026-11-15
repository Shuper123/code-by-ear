// Lists every sentence the app speaks that is fixed ahead of time, for the neural voice pre-render:
// all drill text (prompts, code lines and their phrases, model answers, hints, Sketch and Dictate prompts) plus the app's own
// fixed sentences, found in the string literals of the session code.
// Run: npx vite-node scripts/voice_texts.ts  -> build/voice_texts.json
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ALL_DRILLS } from '../src/data/drills'
import { dictatePrompt } from '../src/engine/dictate'
import { makeSketchHook } from '../src/engine/sketch'
import { codePieces, lineCountPhrase, sentences, speechKey, type SpeechStyle } from '../src/speech/chunks'
import { drillSpeech } from '../src/speech/phrasing'

const ROOT = join(import.meta.dirname ?? __dirname, '..')
const out = new Map<string, { key: string; style: SpeechStyle; text: string }>()
const add = (style: SpeechStyle, text: string | undefined) => {
  for (const s of sentences(text ?? '')) out.set(speechKey(style, s), { key: speechKey(style, s), style, text: s })
}

// 1. Drill text
const noRunners = { runSql: async () => ({ ok: false }), runPyTests: async () => ({ ok: false }), pythonReady: () => false, preloadPython: () => {} }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sketchWithAi = makeSketchHook({ available: () => true } as any, noRunners as any)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sketchNoAi = makeSketchHook(null, noRunners as any)
for (const d of ALL_DRILLS) {
  for (const x of drillSpeech(d)) add(x.style, x.text)
  add('prose', lineCountPhrase(d.code, codePieces(d.code_spoken)) ?? '')
  if (d.type === 'dictate') add('prose', dictatePrompt(d))
  if (d.type === 'sketch') {
    add('prose', sketchWithAi.promptText!(d))
    add('prose', sketchNoAi.promptText!(d))
  }
}

// 2. The app's fixed sentences: string literals in the session code, split into sentences, keeping
// only complete sentences with nothing filled in at run time.
const SOURCES = [
  ...readdirSync(join(ROOT, 'src/engine')).map((f) => join('src/engine', f)),
  'src/app/SessionScreen.tsx',
  'src/app/ButtonTest.tsx',
]
const literal = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g
for (const file of SOURCES.filter((f) => /\.(ts|tsx)$/.test(f))) {
  const src = readFileSync(join(ROOT, file), 'utf8')
  for (const m of src.matchAll(literal)) {
    const raw = (m[1] ?? m[2] ?? m[3] ?? '').replace(/\\'/g, "'").replace(/\\"/g, '"')
    for (const part of raw.split(/\$\{[^}]*\}/)) {
      for (const s of sentences(part)) {
        if (/^[A-Z][a-z']*[ ,.?!]/.test(s) && /[.?!]$/.test(s) && !/[{}<>=_/\\|`$]/.test(s) && s.length <= 200) add('prose', s)
      }
    }
  }
}
for (const fixed of ['SQL.', 'Python.', 'Again.', 'Spot the bug.']) add('prose', fixed)
for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) add('prose', lineCountPhrase(Array(n).fill('x').join('\n'), Array(n).fill('x')) ?? '')

const list = [...out.values()].sort((a, b) => a.key.localeCompare(b.key))
mkdirSync(join(ROOT, 'build'), { recursive: true })
writeFileSync(join(ROOT, 'build/voice_texts.json'), JSON.stringify(list, null, 1))
const chars = list.reduce((s, x) => s + x.text.length, 0)
const count = (st: SpeechStyle) => list.filter((x) => x.style === st).length
console.log(`voice_texts: ${list.length} sentences, ${chars} characters (${count('code')} code lines, ${count('phrase')} code phrases)`)
