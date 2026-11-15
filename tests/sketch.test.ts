// Sketch end to end in a simulated session: fake speech and fake AI, real sql.js and real Pyodide.
import { describe, expect, it, vi } from 'vitest'
import type { ConverterReply } from '../src/ai/prompts'
import type { Drill } from '../src/data/types'
import { localDate } from '../src/engine/dates'
import { MemoryStore } from '../src/engine/progress'
import { SessionEngine, type EngineDeps } from '../src/engine/session'
import { makeSketchHook, type SketchAi } from '../src/engine/sketch'
import { DEFAULT_SETTINGS } from '../src/settings'
import type { ListenResult } from '../src/speech/stt'
import { heard, loadDrills } from './helpers'
import { nodeRunners } from './nodeRunners'

const drills = loadDrills()
const TYPES = new Set(['predict', 'explain', 'spot_bug', 'plan', 'concept', 'sketch'])

type Answer = Partial<ListenResult> & { command?: string }

function run(drillId: string, answers: Answer[], ai: SketchAi & { grade?: unknown }, profile: 'parked' | 'drive' = 'parked') {
  let t = Date.UTC(2026, 10, 14, 15)
  const said: string[] = []
  const cues: string[] = []
  const store = new MemoryStore()
  const queue = [...answers]
  const deps: EngineDeps = {
    speak: async (text) => {
      said.push(heard(text))
      t += 2000
    },
    stopSpeaking: () => {},
    listen: () => {
      const a = queue.shift() ?? { command: 'stop' }
      t += 4000
      const result: ListenResult = {
        text: '',
        pieces: [],
        reason: a.command ? 'command' : a.text ? 'silence' : 'no-speech',
        restarts: 0,
        heardSpeech: !!a.text,
        durationMs: 4000,
        ...a,
      }
      return { result: Promise.resolve(result), stop() {}, abort() {}, extend() {} }
    },
    cue: async (c) => {
      cues.push(c)
    },
    now: () => t,
    today: () => localDate(new Date(t)),
    store,
    typeHooks: { sketch: makeSketchHook(ai, nodeRunners) },
    supportedTypes: TYPES,
  }
  const engine = new SessionEngine({ profile, settings: { ...DEFAULT_SETTINGS }, drills, only: [drillId] }, deps)
  return { engine, said, cues, store, done: engine.run() }
}

function fakeAi(code: string | null, opts: { assumptions?: string[]; available?: boolean } = {}) {
  const convert = vi.fn(async (): Promise<ConverterReply | null> =>
    code === null ? null : { code, assumptions: opts.assumptions ?? [], unclear: [] },
  )
  const explainError = vi.fn(async (_d: Drill, _c: string, failure: string) => `Look at the grouping. ${failure.slice(0, 40)}`)
  return { available: () => opts.available ?? true, convert, explainError }
}

describe('SQL Sketch', () => {
  it('converts, reads back, runs on real data and scores a correct query 3', async () => {
    const ai = fakeAi('SELECT part_id, SUM(qty) FROM lots GROUP BY part_id;', { assumptions: ['I took quantity to mean qty.'] })
    const s = run('sql-s3-sketch-004', [{ text: 'select part id and the sum of quantity from lots grouped by part id' }, { command: 'go' }], ai)
    await s.done
    expect(s.said.some((x) => x.includes('Sketch. The lots table has'))).toBe(true)
    const readBack = s.said.find((x) => x.startsWith('I heard:'))!
    expect(readBack).toContain('I assumed: I took quantity to mean qty.')
    expect(readBack).toMatch(/Say go to run it, or redo\.$/)
    expect(s.said).toContain('Correct. Your rows match the answer.')
    expect(s.store.attempts).toHaveLength(1)
    expect(s.store.attempts[0]).toMatchObject({ drillId: 'sql-s3-sketch-004', score: 3, gradedBy: 'auto' })
    expect(ai.explainError).not.toHaveBeenCalled()
  })

  it('keeps a buggy query buggy: wrong rows score 1 and get an explanation', async () => {
    const ai = fakeAi('SELECT part_id, SUM(qty) FROM lots;')
    const s = run('sql-s3-sketch-004', [{ text: 'select part id and the sum of quantity from lots' }, { command: 'go' }, {}], ai)
    await s.done
    expect(s.store.attempts[0].score).toBe(1)
    expect(ai.explainError).toHaveBeenCalledTimes(1)
    const failure = ai.explainError.mock.calls[0][2]
    expect(failure).toMatch(/returns 1 rows; the answer has 12/)
    expect(s.cues).toContain('partial')
  })

  it('a query error scores 0 and plays the model answer', async () => {
    const ai = fakeAi('SELECT part_id, SUM(qty FROM lots GROUP BY part_id;')
    const s = run('sql-s3-sketch-004', [{ text: 'select part id sum quantity' }, { command: 'go' }], ai)
    await s.done
    expect(s.store.attempts[0].score).toBe(0)
    expect(s.said.some((x) => x.includes("Here's one way to do it."))).toBe(true)
  })

  it('"redo" goes back to answering before anything runs', async () => {
    const ai = fakeAi('SELECT part_id, SUM(qty) FROM lots GROUP BY part_id;')
    const s = run(
      'sql-s3-sketch-004',
      [{ text: 'select something wrong' }, { command: 'redo' }, { text: 'select part id and sum of qty from lots grouped by part id' }, { command: 'go' }],
      ai,
    )
    await s.done
    expect(s.said).toContain('Okay, say it again.')
    expect(ai.convert).toHaveBeenCalledTimes(2)
    expect(s.store.attempts).toHaveLength(1)
    expect(s.store.attempts[0].score).toBe(3)
  })
})

describe('Python Sketch', () => {
  it('passes every test in Pyodide and scores 3', async () => {
    const code = 'def count_above(nums, limit):\n    count = 0\n    for n in nums:\n        if n > limit:\n            count += 1\n    return count\n'
    const s = run('py-p3-sketch-005', [{ text: 'count is zero, for each n in nums if n is greater than limit add one, return count' }, { command: 'go' }], fakeAi(code))
    await s.done
    expect(s.said).toContain('Correct. All the tests pass.')
    expect(s.store.attempts[0].score).toBe(3)
  }, 60000)

  it('a literal off-by-one (>= for >) fails the tests and is explained', async () => {
    const code = 'def count_above(nums, limit):\n    count = 0\n    for n in nums:\n        if n >= limit:\n            count += 1\n    return count\n'
    const ai = fakeAi(code)
    const s = run('py-p3-sketch-005', [{ text: 'if n is at least limit add one' }, { command: 'go' }], ai)
    await s.done
    expect(s.store.attempts[0].score).toBe(0)
    expect(ai.explainError.mock.calls[0][2]).toMatch(/expected 2 but the code returned 3/)
  }, 60000)
})

describe('fallbacks', () => {
  it('without AI grading, Sketch is offered as a Plan with self-rating', async () => {
    const ai = fakeAi('irrelevant', { available: false })
    const s = run('sql-s3-sketch-004', [{ text: 'group lots by part and sum quantity' }, { text: 'yes' }], ai)
    await s.done
    expect(s.said.some((x) => x.includes('Sketch, as a plan for now'))).toBe(true)
    expect(ai.convert).not.toHaveBeenCalled()
    expect(s.store.attempts[0]).toMatchObject({ score: 2, gradedBy: 'self' })
  })
  it('if the converter fails, it says grading is offline and falls back to self-rating', async () => {
    const s = run('sql-s3-sketch-004', [{ text: 'select part id' }, { text: 'partly' }], fakeAi(null))
    await s.done
    expect(s.said).toContain('Grading is offline, rate yourself.')
    expect(s.store.attempts[0]).toMatchObject({ score: 1, gradedBy: 'self' })
  })
})
