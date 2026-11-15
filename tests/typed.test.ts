// Typed mode: which tasks come back at the keyboard, how a typed attempt is scored and scheduled, and
// the first-try scoreboard. Also Build sessions in the queue, and the SQL-first settings change.
import { describe, expect, it } from 'vitest'
import { formatSql } from '../src/build/format'
import { MemoryStore } from '../src/engine/progress'
import { eligibleFor, SessionQueue } from '../src/engine/queue'
import { recordTyped, typedId, typedQueue, typedScore, typedStats, typedTasks, TYPED_LEVEL } from '../src/engine/typed'
import { DEFAULT_SETTINGS, migrateSettings } from '../src/settings'
import type { Attempt, DrillState } from '../src/storage/db'
import { loadDrills } from './helpers'

const drills = loadDrills()
const TYPES = new Set(['predict', 'explain', 'spot_bug', 'plan', 'concept', 'sketch', 'dictate', 'build'])
const builds = drills.filter((d) => d.type === 'build')

function attempt(drillId: string, score: number, at: string, type = 'build'): Attempt {
  const d = drills.find((x) => x.id === drillId.replace('#typed', ''))!
  return { drillId, lang: d.lang, unit: d.unit, level: type === 'typed' ? TYPED_LEVEL : d.level, type, score, at, sessionId: 's', profile: 'parked', gradedBy: 'auto', transcript: '', hints: 0 }
}

describe('which tasks can be typed', () => {
  it('every build task, and each SQL ladder once', () => {
    const tasks = typedTasks(drills)
    expect(tasks.filter((d) => d.type === 'build')).toHaveLength(20)
    expect(tasks.filter((d) => d.type === 'sketch')).toHaveLength(13)
    expect(tasks.every((d) => d.lang === 'sql' && d.reference && d.dataset)).toBe(true)
  })
})

describe('the typed set', () => {
  const [a, b, c] = builds
  it('is empty until something has been built by voice', () => {
    expect(typedQueue(drills, new Map(), [], '2026-11-15', 5)).toEqual([])
    expect(typedQueue(drills, new Map(), [attempt(a.id, 1, '2026-11-15T10:00:00.000Z')], '2026-11-15', 5)).toEqual([]) // not passed
  })
  it('holds tasks passed by voice, most recent first, until they are typed', () => {
    const attempts = [attempt(a.id, 3, '2026-11-15T10:00:00.000Z'), attempt(b.id, 2, '2026-11-15T11:00:00.000Z'), attempt(c.id, 0, '2026-11-15T12:00:00.000Z')]
    expect(typedQueue(drills, new Map(), attempts, '2026-11-15', 5).map((x) => [x.drill.id, x.reason])).toEqual([[b.id, 'voice'], [a.id, 'voice']])
    const typedSince = [...attempts, attempt(typedId(b.id), 3, '2026-11-15T13:00:00.000Z', 'typed')]
    expect(typedQueue(drills, new Map(), typedSince, '2026-11-15', 5).map((x) => x.drill.id)).toEqual([a.id])
    // built again by voice after typing it: it comes back
    const again = [...typedSince, attempt(b.id, 3, '2026-11-16T09:00:00.000Z')]
    expect(typedQueue(drills, new Map(), again, '2026-11-16', 5).map((x) => x.drill.id)).toEqual([b.id, a.id])
  })
  it('puts typed reviews that are due first, and respects the set size', () => {
    const states = new Map<string, DrillState>([
      [typedId(c.id), { id: typedId(c.id), ease: 2.5, interval: 1, due: '2026-11-15', reps: 1, lapses: 0, lastScore: 3, firstSeen: '', lastSeen: '' }],
    ])
    const attempts = [attempt(a.id, 3, '2026-11-15T10:00:00.000Z'), attempt(b.id, 3, '2026-11-15T11:00:00.000Z'), attempt(typedId(c.id), 3, '2026-11-14T11:00:00.000Z', 'typed')]
    expect(typedQueue(drills, states, attempts, '2026-11-15', 5).map((x) => [x.drill.id, x.reason])).toEqual([[c.id, 'review'], [b.id, 'voice'], [a.id, 'voice']])
    expect(typedQueue(drills, states, attempts, '2026-11-15', 2)).toHaveLength(2)
    expect(typedQueue(drills, states, attempts, '2026-11-14', 5).map((x) => x.drill.id)).toEqual([b.id, a.id]) // review not due yet
  })
  it('a ladder passed as Sketch or Dictate by voice can be typed too', () => {
    const dictate = drills.find((d) => d.id === 'sql-s3-dictate-013')!
    const sketch = drills.find((d) => d.ladder === dictate.ladder && d.type === 'sketch')!
    const q = typedQueue(drills, new Map(), [attempt(dictate.id, 3, '2026-11-15T10:00:00.000Z', 'dictate')], '2026-11-15', 5)
    expect(q.map((x) => x.drill.id)).toEqual([sketch.id])
  })
})

describe('scoring and scheduling a typed attempt', () => {
  it('first try 3, second or third 2, later 1, answer shown 0', () => {
    expect(typedScore({ tries: 1, revealed: false, sql: '' })).toBe(3)
    expect(typedScore({ tries: 2, revealed: false, sql: '' })).toBe(2)
    expect(typedScore({ tries: 3, revealed: false, sql: '' })).toBe(2)
    expect(typedScore({ tries: 4, revealed: false, sql: '' })).toBe(1)
    expect(typedScore({ tries: 2, revealed: true, sql: '' })).toBe(0)
  })
  it('saves under its own id, with its own review schedule, apart from the voice drill', async () => {
    const store = new MemoryStore()
    const d = builds[0]
    const score = await recordTyped(store, d, { tries: 1, revealed: false, sql: 'SELECT 1' }, new Date('2026-11-15T18:00:00'))
    expect(score).toBe(3)
    expect(store.attempts[0]).toMatchObject({ drillId: typedId(d.id), type: 'typed', level: TYPED_LEVEL, score: 3, transcript: 'SELECT 1', hints: 0, unit: d.unit })
    expect(store.states.get(typedId(d.id))).toMatchObject({ reps: 1, due: '2026-11-16', lastScore: 3 })
    expect(store.states.has(d.id)).toBe(false)
    await recordTyped(store, d, { tries: 1, revealed: false, sql: 'SELECT 1' }, new Date('2026-11-16T18:00:00'))
    expect(store.states.get(typedId(d.id))).toMatchObject({ reps: 2, due: '2026-11-19' })
    await recordTyped(store, d, { tries: 3, revealed: true, sql: '' }, new Date('2026-11-19T18:00:00'))
    expect(store.states.get(typedId(d.id))).toMatchObject({ due: '2026-11-20', lastScore: 0, lapses: 1 })
    expect(store.attempts[2]).toMatchObject({ score: 0, hints: 2 })
  })
})

describe('the scoreboard', () => {
  it('counts first-try matches among typed attempts, and what is still waiting', () => {
    const [a, b, c] = builds
    const attempts = [
      attempt(a.id, 3, '2026-11-15T10:00:00.000Z'), attempt(b.id, 3, '2026-11-15T10:05:00.000Z'), attempt(c.id, 3, '2026-11-15T10:10:00.000Z'),
      attempt(typedId(a.id), 3, '2026-11-15T18:00:00.000Z', 'typed'), attempt(typedId(b.id), 2, '2026-11-15T18:05:00.000Z', 'typed'),
    ]
    const s = typedStats(drills, new Map(), attempts, '2026-11-15')
    expect(s).toEqual({ total: 2, recent: { n: 2, firstTry: 1 }, allTime: { n: 2, firstTry: 1 }, waiting: 1 })
    const many = Array.from({ length: 30 }, (_, i) => attempt(typedId(a.id), i < 10 ? 0 : 3, `2026-11-${String(10 + Math.floor(i / 6)).padStart(2, '0')}T10:00:${String(i).padStart(2, '0')}.000Z`, 'typed'))
    expect(typedStats(drills, new Map(), many, '2026-11-15').recent).toEqual({ n: 20, firstTry: 20 })
    expect(typedStats(drills, new Map(), many, '2026-11-15').allTime).toEqual({ n: 30, firstTry: 20 })
  })
})

describe('showing an answer', () => {
  it('lays a reference query out on lines', () => {
    expect(formatSql("SELECT lot_id, qty FROM lots WHERE shift = 'night' AND qty > 400;")).toBe("SELECT lot_id, qty\nFROM lots\nWHERE shift = 'night' AND qty > 400")
    expect(formatSql('SELECT l.machine_id, SUM(d.qty) FROM defects d JOIN lots l ON l.lot_id = d.lot_id GROUP BY l.machine_id;')).toBe(
      'SELECT l.machine_id, SUM(d.qty)\nFROM defects d\nJOIN lots l ON l.lot_id = d.lot_id\nGROUP BY l.machine_id',
    )
    expect(formatSql('SELECT lot_id, qty FROM lots WHERE qty > (SELECT AVG(qty) FROM lots);')).toBe('SELECT lot_id, qty\nFROM lots\nWHERE qty > (SELECT AVG(qty) FROM lots)')
    expect(formatSql('WITH ranked AS (SELECT machine_id, lot_id, qty, RANK() OVER (PARTITION BY machine_id ORDER BY qty DESC) AS r FROM lots) SELECT machine_id, lot_id, qty FROM ranked WHERE r = 1;')).toBe(
      'WITH ranked AS (\n  SELECT machine_id, lot_id, qty, RANK() OVER (PARTITION BY machine_id ORDER BY qty DESC) AS r\n  FROM lots\n)\nSELECT machine_id, lot_id, qty\nFROM ranked\nWHERE r = 1',
    )
  })
  it('every typed task has a reference that formats without losing anything', () => {
    for (const d of typedTasks(drills)) {
      const squash = (s: string) => s.replace(/\s+/g, '').replace(/;$/, '')
      expect(squash(formatSql(d.reference!))).toBe(squash(d.reference!))
    }
  })
})

describe('Build sessions', () => {
  const base = { drills, newPerSession: 5, attempts: [], today: '2026-11-15', seed: 0, supportedTypes: TYPES, languageMix: 'sql' as const }
  it('queue only build tasks: easiest first, in content order', () => {
    const q = new SessionQueue({ ...base, profile: 'parked', states: new Map(), focus: 'build' })
    const first = q.peekAll().map((i) => i.drill)
    expect(first.map((d) => d.id)).toEqual(['sql-s2-build-001', 'sql-s2-build-002', 'sql-s2-build-003', 'sql-s3-build-001', 'sql-s3-build-002'])
    expect(first.every((d) => d.type === 'build')).toBe(true)
    // then they top up with the rest, and stop when every task has been used
    const ids: string[] = []
    for (let it = q.next(); it; it = q.next()) {
      q.markSeen(it.drill.id)
      ids.push(it.drill.id)
    }
    expect(ids).toHaveLength(20)
    expect(new Set(ids).size).toBe(20)
  })
  it('reviews that are due come before new tasks', () => {
    const due: DrillState = { id: 'sql-s4-build-001', ease: 2.5, interval: 1, due: '2026-11-15', reps: 1, lapses: 0, lastScore: 2, firstSeen: '', lastSeen: '' }
    const q = new SessionQueue({ ...base, profile: 'parked', states: new Map([[due.id, due]]), focus: 'build' })
    expect(q.peekAll().slice(0, 2).map((i) => [i.drill.id, i.reason])).toEqual([['sql-s4-build-001', 'review'], ['sql-s2-build-001', 'new']])
  })
  it('ignore the language mix, since build is SQL', () => {
    const q = new SessionQueue({ ...base, languageMix: 'python', profile: 'parked', states: new Map(), focus: 'build' })
    expect(q.peekAll()).toHaveLength(5)
  })
  it('never appear in Drive, and ordinary Parked sessions only get them as reviews', () => {
    expect(builds.some(eligibleFor('drive', TYPES))).toBe(false)
    expect(builds.every(eligibleFor('parked', TYPES))).toBe(true)
    const drive = new SessionQueue({ ...base, profile: 'drive', states: new Map() })
    const parked = new SessionQueue({ ...base, profile: 'parked', states: new Map() })
    expect(drive.peekAll().some((i) => i.drill.type === 'build')).toBe(false)
    expect(parked.peekAll().some((i) => i.drill.type === 'build')).toBe(false)
  })
})

describe('SQL first', () => {
  it('is the default for a new install', () => {
    expect(DEFAULT_SETTINGS.languageMix).toBe('sql')
  })
  it('moves a saved "both" to SQL once, and leaves a chosen language alone', () => {
    expect(migrateSettings({ languageMix: 'both', rateDrive: 1.1 }, 1)).toEqual({ languageMix: 'sql', rateDrive: 1.1 })
    expect(migrateSettings({ rateDrive: 1.1 }, 1)).toEqual({ languageMix: 'sql', rateDrive: 1.1 })
    expect(migrateSettings({ languageMix: 'python' }, 1)).toEqual({ languageMix: 'python' })
    expect(migrateSettings({ languageMix: 'both' }, 2)).toEqual({ languageMix: 'both' }) // chosen again after the change: kept
  })
})
