// Pacing: code is read one line at a time (slower, with pauses), with a line count, twice in Drive,
// and "repeat line N" replays one line.
import { describe, expect, it } from 'vitest'
import { localDate } from '../src/engine/dates'
import { MemoryStore } from '../src/engine/progress'
import { SessionEngine, type EngineDeps } from '../src/engine/session'
import { codePieces, lineCountPhrase, normalizeSpeech, sentences, speechKey } from '../src/speech/chunks'
import { parseRepeatLine } from '../src/speech/commands'
import { DEFAULT_SETTINGS } from '../src/settings'
import type { ListenResult } from '../src/speech/stt'
import { loadDrills } from './helpers'

const drills = loadDrills()
const TYPES = new Set(['predict', 'explain', 'spot_bug', 'plan', 'concept'])
type Spoken = { text: string; rate: number; style?: string }

function run(profile: 'drive' | 'parked', drillId: string, answers: string[]) {
  let t = Date.UTC(2026, 10, 14, 16)
  const spoken: Spoken[] = []
  const sleeps: number[] = []
  const queue = [...answers]
  let engine!: SessionEngine
  const deps: EngineDeps = {
    speak: async (text, rate, _signal, style) => {
      spoken.push({ text, rate, style })
      t += 1500
    },
    sleep: async (ms) => {
      sleeps.push(ms)
      t += ms
    },
    stopSpeaking: () => {},
    listen: () => {
      const text = engine.view.paused ? '' : (queue.shift() ?? '')
      const command = engine.view.paused ? 'continue' : text ? undefined : 'stop'
      t += 3000
      const result: ListenResult = { text, pieces: [], reason: command ? 'command' : 'silence', restarts: 0, heardSpeech: !!text, durationMs: 3000, command } as ListenResult
      return { result: Promise.resolve(result), stop() {}, abort() {}, extend() {} }
    },
    cue: async () => {},
    now: () => t,
    today: () => localDate(new Date(t)),
    store: new MemoryStore(),
    supportedTypes: TYPES,
  }
  engine = new SessionEngine({ profile, settings: { ...DEFAULT_SETTINGS }, drills, only: [drillId] }, deps)
  return { engine, spoken, sleeps, done: engine.run() }
}

describe('speech pieces', () => {
  it('sentences split at sentence ends only, and keep decimals whole', () => {
    expect(sentences('Print 3.5 times 2. Then stop! Okay? Done')).toEqual(['Print 3.5 times 2.', 'Then stop!', 'Okay?', 'Done'])
    expect(sentences('')).toEqual([])
    const long = `${'word '.repeat(30)}and more, ${'other '.repeat(30)}end.`
    expect(sentences(long).every((s) => s.length <= 200)).toBe(true)
  })
  it('code pieces: one per labeled line for spot the bug, one per sentence otherwise', () => {
    expect(codePieces('Line 1, x equals 5. Line 2, print x.')).toEqual(['Line 1, x equals 5.', 'Line 2, print x.'])
    expect(codePieces('x equals 7. Then x equals x plus 3. Then print x.')).toEqual(['x equals 7.', 'Then x equals x plus 3.', 'Then print x.'])
    expect(lineCountPhrase('x = 7\nx = x + 3\nprint(x)', ['a', 'b', 'c'])).toBe('Three lines.')
    expect(lineCountPhrase('if x:\n    print(x)', ['one sentence'])).toBeNull()
  })
  it('keys are stable, depend on style and ignore extra spaces', () => {
    expect(speechKey('prose', 'Hello  there.')).toBe(speechKey('prose', ' Hello there. '))
    expect(speechKey('prose', 'x equals 7.')).not.toBe(speechKey('code', 'x equals 7.'))
    expect(speechKey('prose', 'Hello there.')).toMatch(/^[0-9a-f]{14}$/)
    expect(normalizeSpeech(' a \n b ')).toBe('a b')
  })
  it('repeat line parsing', () => {
    expect(parseRepeatLine('repeat line 2')).toBe(2)
    expect(parseRepeatLine('Repeat line two.')).toBe(2)
    expect(parseRepeatLine('say line three again')).toBe(3)
    expect(parseRepeatLine('read the last line')).toBe(-1)
    expect(parseRepeatLine('repeat the second line')).toBe(2)
    expect(parseRepeatLine('line two')).toBeNull() // a spot-the-bug answer, not a command
    expect(parseRepeatLine('repeat')).toBeNull()
  })
})

describe('pacing in sessions', () => {
  it('Drive reads code line by line, slower, twice, with pauses, then the question', async () => {
    const s = run('drive', 'py-p1-predict-001', ['ten'])
    await s.done
    const texts = s.spoken.map((x) => x.text)
    const i = texts.indexOf('Python. Three lines.')
    expect(i).toBeGreaterThanOrEqual(0)
    expect(texts.slice(i + 1, i + 9)).toEqual([
      'x equals 7.', 'Then x equals x plus 3.', 'Then print x.', 'Again.',
      'x equals 7.', 'Then x equals x plus 3.', 'Then print x.', drills.find((d) => d.id === 'py-p1-predict-001')!.prompt_spoken,
    ])
    const code = s.spoken.filter((x) => x.style === 'code')
    expect(code).toHaveLength(6)
    expect(code[0].rate).toBeCloseTo(DEFAULT_SETTINGS.rateDrive * DEFAULT_SETTINGS.codeSpeed)
    expect(s.sleeps.filter((ms) => ms === DEFAULT_SETTINGS.linePauseMs)).toHaveLength(4)
  })
  it('Parked reads the code once', async () => {
    const s = run('parked', 'py-p1-predict-001', ['ten', 'yes'])
    await s.done
    expect(s.spoken.filter((x) => x.style === 'code')).toHaveLength(3)
    expect(s.spoken.some((x) => x.text === 'Again.')).toBe(false)
  })
  it('spot the bug announces itself and the line count', async () => {
    const s = run('drive', 'py-p1-bug-001', ['line one'])
    await s.done
    expect(s.spoken.some((x) => x.text === 'Python. Spot the bug. Three lines.')).toBe(true)
    expect(s.spoken.filter((x) => x.style === 'code')[0].text).toBe('Line 1, count equals the string 5.')
  })
  it('"repeat line 2" replays just that line and asks again', async () => {
    const s = run('drive', 'py-p1-predict-001', ['repeat line two', 'repeat line nine', 'ten'])
    await s.done
    const texts = s.spoken.map((x) => x.text)
    const k = texts.lastIndexOf('Then x equals x plus 3.')
    expect(texts[k + 1]).toBe('There are 3 lines.')
    expect(s.engine.view.done).toBe(1)
  })
})
