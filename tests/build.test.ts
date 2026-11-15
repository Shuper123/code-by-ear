// The build loop end to end in a simulated Parked session: fake speech, the real clause parser, and real
// SQLite (sql.js). Every build task's spoken solution must reach a match with its reference query.
import { describe, expect, it } from 'vitest'
import { buildAnswer, makeBuildHook } from '../src/engine/build'
import { localDate } from '../src/engine/dates'
import { MemoryStore } from '../src/engine/progress'
import { SessionEngine, type EngineDeps } from '../src/engine/session'
import { DEFAULT_SETTINGS } from '../src/settings'
import type { ListenResult } from '../src/speech/stt'
import { heard, loadDrills } from './helpers'
import { nodeRunners } from './nodeRunners'

const drills = loadDrills()
const builds = drills.filter((d) => d.type === 'build')
const TYPES = new Set(['predict', 'explain', 'spot_bug', 'plan', 'concept', 'sketch', 'dictate', 'build'])
type Answer = Partial<ListenResult> & { command?: string }
const say = (...texts: string[]): Answer[] => texts.map((text) => ({ text }))

function run(drillId: string, answers: Answer[], echo = true) {
  let t = Date.UTC(2026, 10, 15, 16)
  const said: string[] = []
  const cues: string[] = []
  const store = new MemoryStore()
  const queue = [...answers]
  let engine!: SessionEngine
  const deps: EngineDeps = {
    speak: async (text) => {
      said.push(heard(text))
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
    cue: async (name) => void cues.push(name),
    now: () => t,
    today: () => localDate(new Date(t)),
    store,
    typeHooks: { build: makeBuildHook(nodeRunners, { echo: () => echo }) },
    supportedTypes: TYPES,
  }
  engine = new SessionEngine({ profile: 'parked', settings: { ...DEFAULT_SETTINGS }, drills, only: [drillId] }, deps)
  return { engine, said, cues, store, done: engine.run() }
}

describe('build tasks', () => {
  it('there are 20, all Parked only, each with spoken steps and a pattern', () => {
    expect(builds).toHaveLength(20)
    expect(builds.every((d) => d.lang === 'sql' && !d.drive_ok && d.reference && d.say?.length && d.pattern && d.hints_spoken?.length)).toBe(true)
    expect(new Set(builds.map((d) => d.pattern)).size).toBe(20)
  })

  for (const d of builds) {
    it(`${d.id} (${d.pattern}): saying the model steps builds a query that matches the reference`, async () => {
      const s = run(d.id, say(...d.say!))
      await s.done
      expect(s.said.filter((x) => x.includes("That's a match."))).toHaveLength(1)
      expect(s.store.attempts).toHaveLength(1)
      expect(s.store.attempts[0]).toMatchObject({ drillId: d.id, score: 3, gradedBy: 'auto', type: 'build' })
      expect(s.cues).toContain('correct')
    }, 30000)
  }
})

describe('the build loop', () => {
  const TOP3 = 'sql-s3-build-002'

  it('speaks the task, then echoes each clause and the row count after every step', async () => {
    const s = run(TOP3, say('from lots', 'group by machine id', 'select machine id, sum of quantity as total', 'order by total descending', 'limit 3'))
    await s.done
    const i = s.said.findIndex((x) => x.startsWith('SQL. Build. Which three machines'))
    expect(i).toBeGreaterThan(0)
    expect(s.said[i - 1]).toMatch(/^Say one clause at a time/)
    expect(s.said.slice(i + 1, i + 6)).toEqual([
      'From lots. 120 rows.',
      'Group by machine id. 5 rows.',
      'Select machine id, sum of quantity as total. 5 rows.',
      'Order by total descending. 5 rows.',
      "Limit 3. 3 rows. That's a match.",
    ])
    expect(s.store.attempts[0].transcript).toBe('SELECT machine_id, SUM(qty) AS total\nFROM lots\nGROUP BY machine_id\nORDER BY total DESC\nLIMIT 3')
    expect(s.engine.view.detail.build?.matched).toBe(true)
    expect(s.engine.view.detail.build?.result?.rows).toEqual([[5, 12340], [4, 6790], [1, 4860]])
  })

  it('with the echo off, only the result is spoken', async () => {
    const s = run(TOP3, say('from lots', 'group by machine id'), false)
    await s.done
    expect(s.said).toContain('120 rows.')
    expect(s.said).toContain('5 rows.')
  })

  it("says SQLite's own error, and undo takes the step back", async () => {
    const s = run(TOP3, [...say('from lots', 'select widget, sum of quantity'), ...say('undo', 'select machine id, sum of quantity as total', 'group by machine id', 'order by total descending', 'limit 3')])
    await s.done
    expect(s.said).toContain('Select widget, sum of quantity. Error. No such column: widget.')
    expect(s.said).toContain('Undone. 120 rows.')
    expect(s.store.attempts[0].score).toBe(3)
  })

  it('a join with a column in both tables: the error names it', async () => {
    const s = run('sql-s4-build-001', say('from defects', 'join lots using lot id', 'group by machine id', 'select machine id, sum of quantity', 'select machine id, sum of defects dot quantity'))
    await s.done
    expect(s.said).toContain('Select machine id, sum of quantity. Error. Ambiguous column name: quantity.')
    expect(s.store.attempts[0].score).toBe(3)
  })

  it('hints: the written ones first, then the first missing piece; a hint caps the score at 2', async () => {
    const s = run(TOP3, [
      ...say('from lots'), { command: 'hint' }, { command: 'hint' }, { command: 'hint' },
      ...say('group by machine id', 'select machine id, sum of quantity as total', 'order by total descending'), { command: 'hint' }, ...say('limit 3'),
    ])
    await s.done
    const d = builds.find((x) => x.id === TOP3)!
    expect(s.said).toContain(d.hints_spoken![0])
    expect(s.said).toContain(d.hints_spoken![1])
    expect(s.said).toContain('You need a group by.')
    expect(s.said).toContain('You need a limit.')
    expect(s.store.attempts[0]).toMatchObject({ score: 2 })
  })

  it('"done" before it matches says how the rows differ and keeps going', async () => {
    const s = run(TOP3, [...say('from lots', 'group by machine id', 'select machine id, sum of quantity as total', 'done', 'order by total', 'compare', 'descending', 'limit 3')])
    await s.done
    expect(s.said).toContain('Not a match yet. You have 5 rows. The answer has 3. Keep going, or say show me.')
    expect(s.said).toContain('You have 5 rows. The answer has 3.')
    expect(s.store.attempts[0].score).toBe(3)
  })

  it('the right rows in the wrong order are not a match when the order matters', async () => {
    const s = run(TOP3, [...say('from lots where machine id in 1 comma 4 comma 5', 'group by machine id', 'select machine id, sum of quantity as total', 'compare', 'order by total descending')])
    await s.done
    expect(s.said).toContain('Right rows, wrong order.')
    expect(s.said.some((x) => x.endsWith("That's a match."))).toBe(true)
  })

  it('tables, columns, results and read it back answer without changing the query', async () => {
    const s = run(TOP3, [...say('tables', 'columns of lots', 'from lots', 'group by machine id', 'select machine id, sum of quantity as total', 'results'), { command: 'read_back' }, { command: 'skip' }])
    await s.done
    expect(s.said).toContain('The tables are parts, machines, lots, defects, and defect codes.')
    expect(s.said).toContain('The lots table has lot id, part id, machine id, produced on, quantity, and shift.')
    expect(s.said).toContain('The first 3 of 5 rows. Row 1: machine id 1, total 4860. Row 2: machine id 2, total 4360. Row 3: machine id 3, total 4490.')
    expect(s.said).toContain('Select machine id, sum of quantity as total. From lots. Group by machine id.')
    expect(s.said).toContain('Skipped.')
    expect(s.store.attempts).toHaveLength(0)
  })

  it('"show me" reads the idea and the clauses as you would say them, and scores 0', async () => {
    const d = builds.find((x) => x.id === TOP3)!
    const s = run(TOP3, say('from lots', 'show me'))
    await s.done
    expect(buildAnswer(d)).toBe(
      "Here's one way. Group lots by machine id, sum the quantity, order by that total descending, and limit to 3. Say it like this. From lots. Group by machine id. Select machine id, sum of quantity as total. Order by total descending. Limit 3.",
    )
    expect(s.said).toContain(buildAnswer(d))
    expect(s.store.attempts[0]).toMatchObject({ score: 0, gradedBy: 'self' })
  })

  it('"I don\'t know" before the first clause also gets the spoken steps', async () => {
    const d = builds.find((x) => x.id === TOP3)!
    const s = run(TOP3, [{ command: 'idk' }])
    await s.done
    expect(s.said).toContain(`No problem. ${buildAnswer(d)}`)
    expect(s.store.attempts[0].score).toBe(0)
  })

  it('remove and start over', async () => {
    const s = run(TOP3, say('from lots', 'where shift equals night', 'remove where', 'start over', 'from lots', 'undo'))
    await s.done
    expect(s.said).toContain('Where shift equals night. 59 rows.')
    expect(s.said).toContain('Removed. 120 rows.')
    expect(s.said).toContain('Cleared. Start again.')
    expect(s.said).toContain('Undone.')
  })

  it('two steps: name the first query, then build on it', async () => {
    const s = run('sql-s5-build-003', say('from lots', 'group by machine id', 'select machine id, count star as lots made', 'name it per machine', 'select average of lots made'))
    await s.done
    expect(s.said).toContain('Saved as per machine. From per machine. 5 rows.')
    expect(s.said).toContain("Select average of lots made. 1 row. That's a match.")
    expect(s.store.attempts[0].transcript).toBe(
      'WITH per_machine AS (\n  SELECT machine_id, COUNT(*) AS lots_made\n  FROM lots\n  GROUP BY machine_id\n)\nSELECT AVG(lots_made)\nFROM per_machine',
    )
  })

  it('the naive join on the fan-out task runs but does not match', async () => {
    const s = run('sql-s5-build-005', say('from lots', 'left join defects using lot id', 'group by machine id', 'select machine id, sum of defects dot quantity times 1.0 divided by sum of lots dot quantity', 'compare'))
    await s.done
    expect(s.said.some((x) => x.includes("That's a match."))).toBe(false)
    expect(s.said.some((x) => x.startsWith('Right number of rows, but some values differ.'))).toBe(true)
  })

  it('silence gets one nudge, then the session pauses', async () => {
    const s = run(TOP3, [...say('from lots'), {}, {}, { command: 'skip' }])
    await s.done
    expect(s.said).toContain('Keep going. Say hint if you are stuck.')
    expect(s.said.some((x) => x.startsWith('Pausing.'))).toBe(true)
  })
})
