// Simulated sessions: the real engine with fake speech, a fake clock and an in-memory store.
import { describe, expect, it } from 'vitest'
import type { Drill } from '../src/data/types'
import { localDate } from '../src/engine/dates'
import { MemoryStore } from '../src/engine/progress'
import { SessionEngine, type EngineDeps } from '../src/engine/session'
import { DEFAULT_SETTINGS, type Settings } from '../src/settings'
import type { ListenOptions, ListenResult } from '../src/speech/stt'
import type { Profile } from '../src/storage/db'
import { loadDrills } from './helpers'

const drills = loadDrills()
const L1 = new Set(['predict', 'explain', 'spot_bug', 'plan', 'concept'])

interface Ctx {
  engine: SessionEngine
  lastSaid: string
  opts: ListenOptions
  drill: Drill | null
  paused: boolean
  listens: number
}
type Script = (c: Ctx) => Partial<ListenResult> & { command?: string; delayMs?: number }

function harness(script: Script, startMs = Date.UTC(2026, 10, 14, 14, 0, 0), store = new MemoryStore()) {
  let t = startMs
  const said: string[] = []
  const cues: string[] = []
  let listens = 0
  let engine!: SessionEngine
  const deps: EngineDeps = {
    speak: async (text) => {
      said.push(text)
      t += Math.max(800, text.split(/\s+/).length * 380)
    },
    stopSpeaking: () => {},
    listen: (opts) => {
      listens++
      const r = script({ engine, lastSaid: said[said.length - 1] ?? '', opts, drill: engine.view.drill, paused: engine.view.paused, listens })
      t += r.delayMs ?? 5000
      const result: ListenResult = {
        text: '',
        pieces: [],
        reason: r.command ? 'command' : r.text ? 'silence' : 'no-speech',
        restarts: 0,
        heardSpeech: !!r.text,
        durationMs: r.delayMs ?? 5000,
        ...r,
      }
      return { result: Promise.resolve(result), stop() {}, abort() {}, extend() {} }
    },
    cue: async (c) => {
      cues.push(c)
      t += 250
    },
    now: () => t,
    today: () => localDate(new Date(t)),
    store,
    supportedTypes: L1,
  }
  return {
    deps,
    store,
    said,
    cues,
    make(profile: Profile, patch: Partial<Settings> = {}) {
      engine = new SessionEngine({ profile, settings: { ...DEFAULT_SETTINGS, ...patch }, drills }, deps)
      return engine
    },
    elapsedMin: () => (t - startMs) / 60000,
  }
}

/** A learner who knows everything, answers every prompt and resumes after breaks. */
const perfect: Script = ({ lastSaid, drill, paused }) => {
  if (paused) return { command: 'continue', text: '' }
  if (/Say yes, partly/.test(lastSaid)) return { text: 'yes' }
  if (drill?.type === 'predict') return { text: drill.expected ?? '' }
  return { text: 'it adds things up and prints the result' }
}

describe('Drive session', () => {
  it('runs a 20-minute session hands-free, with a break, and ends with a spoken recap', async () => {
    const h = harness(perfect)
    const engine = h.make('drive', { sessionMinutes: 20, languageMix: 'sql' })
    await engine.run()
    expect(engine.view.phase).toBe('ended')
    expect(h.elapsedMin()).toBeGreaterThanOrEqual(20)
    expect(h.elapsedMin()).toBeLessThan(22)
    expect(h.said[0]).toMatch(/^Drive session, SQL, about 20 minutes/)
    expect(h.said.some((s) => /10 minutes done/.test(s))).toBe(true)
    expect(h.said[h.said.length - 1]).toMatch(/^Session over\. \d+ drills, average 2\.\d out of 3\./)
    expect(h.store.attempts.length).toBeGreaterThan(25)
    expect(h.store.attempts.every((a) => a.lang === 'sql')).toBe(true)
    expect(h.said.some((s) => /haven't heard an answer/.test(s))).toBe(false)
    // every drill in a Drive session is Drive-safe
    const ids = new Set(h.store.attempts.map((a) => a.drillId))
    for (const d of drills.filter((x) => ids.has(x.id))) expect(d.drive_ok).toBe(true)
  })

  it('pauses itself after two unanswered prompts in a row', async () => {
    const h = harness(({ paused }) => (paused ? { command: 'stop', text: '' } : { text: '' }))
    const engine = h.make('drive')
    await engine.run()
    expect(h.said.some((s) => s.startsWith("I didn't hear an answer. Here it is again."))).toBe(true)
    expect(h.said.some((s) => /haven't heard an answer twice in a row/.test(s))).toBe(true)
    expect(h.cues).toContain('paused')
    expect(h.said[h.said.length - 1]).toMatch(/^Session over/)
    expect(h.store.attempts.length).toBe(0)
  })

  it('handles repeat, hint, skip and "I don\'t know"', async () => {
    let step = 0
    const h = harness(({ paused, lastSaid, drill }) => {
      if (paused) return { command: 'continue' }
      if (/Say yes, partly/.test(lastSaid)) return { text: 'partly' }
      step++
      if (step === 1) return { command: 'repeat' }
      if (step === 2) return { command: 'hint' }
      if (step === 3) return { text: drill?.expected ?? 'something' }
      if (step === 4) return { command: 'skip' }
      if (step === 5) return { command: 'idk' }
      return { command: 'stop' }
    })
    const engine = h.make('parked', { languageMix: 'python' })
    await engine.run()
    // the first prompt was spoken twice (repeat), then a hint, then the answer counted with a hint (max 2)
    const firstDrill = drills.find((d) => d.id === h.store.attempts[0].drillId)!
    const prompt = firstDrill.prompt_spoken
    expect(h.said.filter((s) => s.endsWith(prompt)).length).toBeGreaterThanOrEqual(2)
    expect(h.store.attempts[0].hints).toBe(1)
    expect(h.store.attempts[0].score).toBeLessThanOrEqual(2)
    expect(h.said).toContain('Skipped.')
    const idk = h.store.attempts.find((a) => a.score === 0)
    expect(idk).toBeDefined()
    expect(h.said.some((s) => s.startsWith('No problem.'))).toBe(true)
  })

  it('a pause tapped mid-prompt resumes the same drill from the start', async () => {
    let paused = false
    const h = harness(({ paused: p, drill, lastSaid }) => {
      if (p) return { command: 'continue' }
      if (/Say yes, partly/.test(lastSaid)) return { text: 'yes' }
      if (!paused) {
        paused = true
        engine.requestPause('user')
        return { text: '' }
      }
      if (h.store.attempts.length >= 2) return { command: 'stop' }
      return { text: drill?.expected ?? 'answer' }
    })
    const engine = h.make('drive', { languageMix: 'sql' })
    await engine.run()
    expect(h.cues).toContain('paused')
    expect(h.store.attempts.length).toBeGreaterThanOrEqual(2)
  })
})

describe('progress', () => {
  it('survives into the next session: yesterday\'s drills come back as reviews', async () => {
    const store = new MemoryStore()
    const day1 = harness(({ paused, lastSaid, drill }) => {
      if (paused) return { command: 'continue' }
      if (/Say yes, partly/.test(lastSaid)) return { text: 'yes' }
      if (day1.store.attempts.length >= 6) return { command: 'stop' }
      return { text: drill?.expected ?? 'answer' }
    }, Date.UTC(2026, 10, 14, 14), store)
    await day1.make('parked', { languageMix: 'python' }).run()
    const seenDay1 = new Set(store.attempts.map((a) => a.drillId))
    expect(store.states.size).toBe(seenDay1.size)

    const reviewed: string[] = []
    const day2 = harness(({ paused, lastSaid, drill }) => {
      if (paused) return { command: 'continue' }
      if (/Say yes, partly/.test(lastSaid)) return { text: 'yes' }
      if (drill) reviewed.push(drill.id)
      if (reviewed.length > seenDay1.size) return { command: 'stop' }
      return { text: drill?.expected ?? 'answer' }
    }, Date.UTC(2026, 10, 15, 14), store)
    await day2.make('parked', { languageMix: 'python' }).run()
    const firstDay2 = reviewed.slice(0, seenDay1.size)
    expect(new Set(firstDay2)).toEqual(seenDay1)
  })
})
