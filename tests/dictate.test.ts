// Dictate end to end in a simulated Parked session: fake speech, real Verbal Syntax parser, real
// Pyodide and sql.js.
import { describe, expect, it } from 'vitest'
import type { EditReply } from '../src/ai/prompts'
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

describe('Dictate with the voice editor', () => {
  const SUM_EVENS = [
    'def snake sum evens open paren nums close paren colon next total equals zero',
    'next for n in nums colon next if n mod two is equal to zero colon next total plus equals n next back back return total',
  ]
  function editorTrail(s: ReturnType<typeof run>) {
    const seen: { lines: string[]; error?: string; mode: string }[] = []
    s.engine.subscribe((v) => {
      const e = v.detail.editor
      if (e) seen.push({ lines: e.lines, error: e.error?.message, mode: e.mode })
    })
    return seen
  }

  it('shows a real Python syntax error live, then a keys-mode fix clears it', async () => {
    const s = run('py-p3-dictate-013', [
      { text: 'def snake sum evens open paren nums close paren' }, // no colon yet: unfinished, not an error
      { text: 'next total equals zero' }, // now line 1 is wrong
      { text: 'go to line one' },
      { text: 'keys mode' },
      { text: 'colon' }, // now line 2 needs indenting, and Python says so
      { text: 'go to line two' },
      { text: 'indent' },
      { text: 'code mode' },
      { text: SUM_EVENS[1] },
      { text: 'check' },
      { text: 'run it' },
    ])
    const trail = editorTrail(s)
    await s.done
    expect(trail.some((t) => t.error === "SyntaxError: expected ':'")).toBe(true)
    expect(trail.some((t) => t.error?.startsWith('IndentationError: expected an indented block'))).toBe(true)
    expect(s.said).toContain('Keys mode. Every word is a keystroke.')
    expect(s.said).toContain('No syntax errors.')
    expect(s.said).toContain('Correct. All the tests pass.')
    expect(trail.at(-1)!.error).toBeUndefined()
    expect(s.store.attempts[0]).toMatchObject({ drillId: 'py-p3-dictate-013', score: 3 })
  }, 60000)

  it('your editing example: edit at line, character, backspace, typed letters', async () => {
    const s = run('py-p3-dictate-013', [
      { text: SUM_EVENS[0] },
      { text: SUM_EVENS[1].replace('plus equals n', 'plus equals m') }, // a typo: m
      { text: 'edit at line five character twenty three' },
      { text: 'where am I' },
      { text: 'keys mode' },
      { text: 'backspace n' },
      { text: 'run it' },
    ])
    await s.done
    expect(s.said).toContain('Line 5, character 23, at the end of the line.')
    expect(s.store.attempts[0]).toMatchObject({ score: 3 })
    expect(s.store.attempts[0].transcript).toContain('            total += n')
  }, 60000)

  it('starts in keys mode when that is the setting, and spells a line back', async () => {
    let t = Date.UTC(2026, 10, 14, 16)
    const said: string[] = []
    const answers = ['S E L E C T space star space F R O M space L O T S', 'spell line', 'run it', 'idk']
    let engine!: SessionEngine
    const deps: EngineDeps = {
      speak: async (text) => void said.push(text),
      stopSpeaking: () => {},
      listen: () => {
        const text = engine.view.paused ? '' : answers.shift() ?? ''
        const result = { text, pieces: [], reason: text ? 'silence' : 'command', command: text ? undefined : 'stop', restarts: 0, heardSpeech: !!text, durationMs: 1 } as ListenResult
        return { result: Promise.resolve(result), stop() {}, abort() {}, extend() {} }
      },
      cue: async () => {},
      now: () => (t += 1000),
      today: () => localDate(new Date(t)),
      store: new MemoryStore(),
      typeHooks: { dictate: makeDictateHook(null, nodeRunners, { startMode: () => 'keys' }) },
      supportedTypes: TYPES,
    }
    engine = new SessionEngine({ profile: 'parked', settings: { ...DEFAULT_SETTINGS }, drills, only: ['sql-s3-dictate-013'] }, deps)
    await engine.run()
    // spelled letters type lowercase unless you say capital
    expect(said).toContain('Line 1: s e l e c t, space, star, space, f r o m, space, l o t s.')
    // select * from lots runs but isn't the answer: graded, not fixable
    expect(said.some((x) => x.startsWith("It didn't pass."))).toBe(true)
  }, 60000)
})

describe('Dictate: plain-English edits', () => {
  const START = 'def snake sum evens open paren nums close paren colon next total equals zero next for n in nums colon'
  function session(answers: string[], editCode?: (code: string, instruction: string) => EditReply | null) {
    let t = Date.UTC(2026, 10, 14, 16)
    const said: string[] = []
    const queue = [...answers]
    let engine!: SessionEngine
    const store = new MemoryStore()
    const calls: string[] = []
    const deps: EngineDeps = {
      speak: async (text) => void said.push(text),
      stopSpeaking: () => {},
      listen: () => {
        const text = engine.view.paused ? '' : queue.shift() ?? ''
        const result = { text, pieces: [], reason: text ? 'silence' : 'command', command: text ? undefined : 'stop', restarts: 0, heardSpeech: !!text, durationMs: 1 } as ListenResult
        return { result: Promise.resolve(result), stop() {}, abort() {}, extend() {} }
      },
      cue: async () => {},
      now: () => (t += 1000),
      today: () => localDate(new Date(t)),
      store,
      typeHooks: {
        dictate: makeDictateHook(
          {
            available: () => !!editCode,
            explainError: async () => null,
            editCode: async (_d, code, instruction) => {
              calls.push(instruction)
              return editCode ? editCode(code, instruction) : null
            },
          },
          nodeRunners,
        ),
      },
      supportedTypes: TYPES,
    }
    engine = new SessionEngine({ profile: 'parked', settings: { ...DEFAULT_SETTINGS }, drills, only: ['py-p3-dictate-013'] }, deps)
    return { said, store, calls, done: engine.run() }
  }

  it('a rule edit fixes a wrong name, with no AI involved', async () => {
    const s = session([
      START,
      'next if n mod two is equal to zero colon next count plus equals n next back back return total',
      'change count to total',
      'run it',
    ])
    await s.done
    expect(s.calls).toHaveLength(0)
    expect(s.store.attempts[0]).toMatchObject({ score: 3 })
  }, 60000)

  it("Claude handles an edit the rules can't, and only that edit is applied", async () => {
    const s = session(
      [START, 'next if n mod two is equal to one colon next total plus equals n next back back return total', 'make the if test for even numbers', 'run it'],
      (code) => ({ code: code.replace('n % 2 == 1', 'n % 2 == 0'), summary: 'The if now tests for even numbers.' }),
    )
    await s.done
    expect(s.calls).toEqual(['make the if test for even numbers'])
    expect(s.said).toContain('The if now tests for even numbers.')
    expect(s.store.attempts[0]).toMatchObject({ score: 3 })
  }, 60000)

  it('an AI edit that rewrites more than asked is refused', async () => {
    const s = session(
      [START, 'next if n mod two is equal to one colon next total plus equals n next back back return total', 'fix it for me', 'idk'],
      () => ({ code: 'def sum_evens(nums):\n    return sum(n for n in nums if n % 2 == 0)\n# a\n# b\n# c\n# d', summary: 'Rewrote it.' }),
    )
    await s.done
    expect(s.said).toContain('That would change more than you asked, so I left the code alone. Try a smaller edit.')
  }, 60000)

  it('without AI, an unknown edit gets a hint about the phrasing', async () => {
    const s = session([START, 'make it faster', 'idk'])
    await s.done
    expect(s.said.some((x) => x.startsWith("I didn't understand that edit."))).toBe(true)
  }, 60000)
})

