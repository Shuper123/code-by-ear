// Lists every sentence the app speaks that is fixed ahead of time, for the neural voice pre-render:
// all drill text (prompts, code lines and their phrases, model answers, hints, Sketch, Dictate and Build prompts) plus the app's
// own fixed sentences, found in the string literals of the session code. For Build it also lists what the app says when a task
// is built the way its model answer says it (each clause echoed, each row count), so that path needs no on-phone voice.
// Run: npx vite-node scripts/voice_texts.ts  -> build/voice_texts.json
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { rowsPhrase } from '../src/build/feedback'
import { emptyFrame, sayClause, sayName } from '../src/build/frame'
import { applyUtterance, nameStep, parseBuildCommand } from '../src/build/parse'
import { loadBuildSchema, sayColumns, sayTables, tablesOf } from '../src/build/schema'
import { ALL_DRILLS } from '../src/data/drills'
import type { DatasetName } from '../src/data/types'
import { buildAnswer, buildPrompt } from '../src/engine/build'
import { dictatePrompt } from '../src/engine/dictate'
import { makeSketchHook } from '../src/engine/sketch'
import { codePieces, lineCountPhrase, sentences, speechKey, type SpeechStyle } from '../src/speech/chunks'
import { drillSpeech } from '../src/speech/phrasing'
import { nodeRunSql } from '../tests/nodeRunners'

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
  if (d.type === 'build') {
    add('prose', buildPrompt(d))
    add('prose', buildAnswer(d))
    // the echoes heard when the task is built the way its model answer says it
    const schema = await loadBuildSchema(d.dataset, nodeRunSql)
    let frame = emptyFrame()
    for (const step of d.say ?? []) {
      const cmd = parseBuildCommand(step, schema)
      const r = cmd?.t === 'name' ? nameStep(frame, cmd.name) : applyUtterance(frame, step, schema)
      frame = r.frame
      for (const c of r.changed) {
        add('prose', c.key === 'cte' ? `Saved as ${sayName(frame.ctes[frame.ctes.length - 1].name)}.` : sayClause(frame.main, c.key, c.index))
      }
    }
  }
}

// 1b. Build: the tables and their columns, and row counts
for (const dataset of ['factory', 'shop'] as DatasetName[]) {
  add('prose', sayTables(dataset))
  for (const t of tablesOf(dataset)) {
    add('prose', sayColumns(dataset, t.table))
    add('prose', `From ${sayName(t.table)}.`)
  }
}
for (let n = 0; n <= 200; n++) add('prose', rowsPhrase(n))

// 1c. Build: the echoes of the clauses most likely to be said on the factory data (one table, one join on a shared
// column, one grouping or ordering column, a limit), made by the same code that makes the echo, so they match it
{
  const schema = await loadBuildSchema('factory', nodeRunSql)
  const echo = (...steps: string[]) => {
    let frame = emptyFrame()
    let last = ''
    for (const step of steps) {
      const r = applyUtterance(frame, step, schema)
      frame = r.frame
      last = r.changed.map((c) => sayClause(frame.main, c.key, c.index)).join(' ')
    }
    add('prose', last)
  }
  const columns = [...new Set(schema.tables.flatMap((t) => t.columns))]
  for (const c of columns) {
    const said = sayName(c)
    echo(`group by ${said}`)
    echo(`order by ${said}`)
    echo(`order by ${said} descending`)
    echo(`select ${said}`)
  }
  for (const a of schema.tables) {
    for (const b of schema.tables) {
      if (a === b) continue
      for (const c of a.columns.filter((x) => b.columns.includes(x) && x !== 'qty')) {
        echo(`from ${sayName(a.name)}`, `join ${sayName(b.name)} using ${sayName(c)}`)
        echo(`from ${sayName(a.name)}`, `left join ${sayName(b.name)} using ${sayName(c)}`)
      }
    }
  }
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20, 25, 50, 100]) echo(`limit ${n}`)
  for (const s of ['select star', 'select count star', 'order by total descending', 'order by total', 'descending']) echo('order by total', s)
}

// 2. The app's fixed sentences: string literals in the session code, split into sentences, keeping
// only complete sentences with nothing filled in at run time.
const SOURCES = [
  ...readdirSync(join(ROOT, 'src/engine')).map((f) => join('src/engine', f)),
  ...readdirSync(join(ROOT, 'src/build')).map((f) => join('src/build', f)),
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
