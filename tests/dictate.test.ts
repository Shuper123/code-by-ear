// Dictate end to end in a simulated Parked session: fake speech, real Verbal Syntax parser, real
// Pyodide and sql.js.
import { describe, expect, it } from 'vitest'
import { makeDictateHook } from '../src/engine/dictate'
import { localDate } from '../src/engine/dates'
import { MemoryStore } from '../src/engine/progress'
import { SessionEngine, type EngineDeps } from '../src/engine/session'
import { DEFAULT_SETTINGS } from '../src/settings'
import type { ListenResult } from '../src/speech/stt'
import { loadDrills } from './helpers'
import { nodeRunners } from './nodeRunners'

const drills = loadDrills()
const TYPES = new Set(['predict', 'explain', 'spot_bug', 'plan', 'concept', 'sketch', 'dictate'])
type Answer = Partial<ListenResult> & { command?: string }

function run(drillId: string, answers: Answer[], explain: string | null = null) {
  let t = Date.UTC(2026, 10, 14, 16)
  const said: string[] = []
  const store = new MemoryStore()
  const queue = [...answers]
  let engine!: SessionEngine
  const deps: EngineDeps = {
    speak: async (text) => {
      said.push(text)
      t += 1500
    },
    stopSpeaking: () => {},
    listen: () => {
      const a = engine.view.paused ? { command: 'continue' } : (queue.shift() ?? { command: 'stop' })
      t += 3000
      const result: ListenResult = {
        text: '',
        pieces: [],
        reason: a.command ? 'command' : a.text ? 'silence' : 'no-speech',
        restarts: 0,
        heardSpeech: !!a.text,
        durationMs: 3000,
        ...a,
      }
      return { result: Promise.resolve(result), stop() {}, abort() {}, extend() {} }
    },
    cue: async () => {},
    now: () => t,
    today: () => localDate(new Date(t)),
    store,
    typeHooks: {
      dictate: makeDictateHook({ available: () => explain !== null, explainError: async () => explain }, nodeRunners),
    },
    supportedTypes: TYPES,
  }
  engine = new SessionEngine({ profile: 'parked', settings: { ...DEFAULT_SETTINGS }, drills, only: [drillId] }, deps)
  return { engine, said, store, done: engine.run() }
}

const COUNT_ABOVE = [
  'def count above open paren nums comma limit close paren colon',
  'next count equals zero',
  'next for n in nums colon',
  'next if n greater than limit colon',
  'next count plus equals one',
  'next back back return count',
]

describe('Dictate, Python', () => {
  it('dictates a function over several utterances, runs it and scores 3', async () => {
    const s = run('py-p3-dictate-005', [...COUNT_ABOVE.map((text) => ({ text })), { text: 'run it' }])
    await s.done
    expect(s.said.some((x) => x.includes('Dictate. Write a function, count above') && x.includes('Start with def count above open paren nums comma limit close paren colon'))).toBe(true)
    expect(s.said).toContain('Correct. All the tests pass.')
    expect(s.store.attempts[0]).toMatchObject({ drillId: 'py-p3-dictate-005', score: 3, gradedBy: 'auto' })
    expect(s.store.attempts[0].transcript).toContain('def count_above(nums, limit):')
  }, 60000)

  it('a syntax error is fixable: it is not graded, and start over then a clean take passes', async () => {
    const s = run('py-p3-dictate-005', [
      { text: 'def count above open paren nums comma limit close paren' }, // missing colon
      { text: 'next return zero' },
      { text: 'run it' },
      { text: 'start over' },
      { text: COUNT_ABOVE.join(' ') },
      { text: 'run it' },
    ])
    await s.done
    expect(s.said.some((x) => x.startsWith("That doesn't parse yet"))).toBe(true)
    expect(s.said).toContain('Cleared. Start again.')
    expect(s.store.attempts).toHaveLength(1)
    expect(s.store.attempts[0].score).toBe(3)
  }, 60000)

  it('read it back, go to line, scratch that and delete line', async () => {
    const s = run('py-p3-dictate-005', [
      { text: COUNT_ABOVE.slice(0, 2).join(' ') },
      { command: 'read_back' },
      { text: 'go to line one' },
      { text: 'next oops equals one' },
      { text: 'scratch that' },
      { text: 'go to line two' },
      { text: 'delete line' },
      { text: 'read it back' },
      { command: 'idk' },
    ])
    await s.done
    expect(s.said).toContain('Line 1. def count above open paren nums comma limit close paren colon. Line 2, indented once. count equals 0.')
    expect(s.said).toContain('Line 1. def count above open paren nums comma limit close paren colon.')
    expect(s.said).toContain('Scratched.')
    expect(s.said).toContain('Line deleted.')
    expect(s.store.attempts[0]).toMatchObject({ score: 0, gradedBy: 'self' })
  }, 60000)

  it('wrong logic is graded and explained; silence nudges, then pauses', async () => {
    const wrong = COUNT_ABOVE.join(' ').replace('greater than', 'at least')
    const s = run('py-p3-dictate-005', [{ text: wrong }, {}, {}, { text: 'run it' }], 'Check the comparison on line 4.')
    await s.done
    expect(s.said).toContain('Keep dictating, or say run it.')
    expect(s.said.some((x) => x.startsWith('Pausing. Say continue'))).toBe(true)
    expect(s.said).toContain('Check the comparison on line 4.')
    expect(s.store.attempts[0].score).toBe(0)
  }, 60000)
})

describe('Dictate, the section 9 worked examples in a Parked session', () => {
  it('worked example 1 in two utterances, then run it', async () => {
    const s = run('py-p3-dictate-013', [
      { text: 'def snake sum evens open paren nums close paren colon next total equals zero' },
      { text: 'next for n in nums colon next if n mod two is equal to zero colon next total plus equals n next back back return total' },
      { text: 'run it' },
    ])
    await s.done
    expect(s.said.some((x) => x.includes('Start with def sum evens open paren nums close paren colon'))).toBe(true)
    expect(s.said).toContain('Correct. All the tests pass.')
    expect(s.store.attempts[0]).toMatchObject({ drillId: 'py-p3-dictate-013', score: 3 })
  }, 60000)
  it('worked example 2 in one utterance, then run it', async () => {
    const s = run('sql-s3-dictate-013', [
      { text: 'select part id comma sum open paren qty close paren as total from lots group by part id order by total descending limit three' },
      { text: 'run it' },
    ])
    await s.done
    expect(s.said).toContain('Correct. Your rows match the answer.')
    expect(s.store.attempts[0]).toMatchObject({ drillId: 'sql-s3-dictate-013', score: 3 })
  })
  it('worked example 2 sorted the wrong way is graded wrong, with a reason', async () => {
    const s = run('sql-s3-dictate-013', [
      { text: 'select part id comma sum of qty as total from lots group by part id order by total limit three' },
      { text: 'run it' },
    ])
    await s.done
    expect(s.store.attempts[0].score).toBe(1)
    expect(s.said.some((x) => x.startsWith("It didn't pass."))).toBe(true)
  })
})

describe('Dictate, SQL', () => {
  it('dictates a query and matches the reference rows', async () => {
    const s = run('sql-s3-dictate-004', [{ text: 'select part id comma sum of qty as total from lots group by part id' }, { text: 'run it' }])
    await s.done
    expect(s.said).toContain('Correct. Your rows match the answer.')
    expect(s.store.attempts[0].score).toBe(3)
  })
  it('a misheard column is fixable, not graded', async () => {
    const s = run('sql-s3-dictate-004', [
      { text: 'select snake part ident comma sum of qty from lots group by snake part ident' },
      { text: 'run it' },
      { text: 'start over' },
      { text: 'select part id comma sum of qty from lots group by part id' },
      { text: 'run it' },
    ])
    await s.done
    expect(s.said.some((x) => x.startsWith("There's no column called part ident"))).toBe(true)
    expect(s.store.attempts).toHaveLength(1)
    expect(s.store.attempts[0].score).toBe(3)
  })
})
