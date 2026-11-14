import { describe, expect, it } from 'vitest'
import { eligibleFor, SessionQueue } from '../src/engine/queue'
import { level2Open, newDrillUnit, newPool, pickNewDrills } from '../src/engine/unlock'
import type { Attempt, DrillState } from '../src/storage/db'
import { loadDrills } from './helpers'

const drills = loadDrills()
const L1 = new Set(['predict', 'explain', 'spot_bug', 'plan', 'concept'])
const any = () => true

function attempt(unit: string, score: number, level = 1): Attempt {
  return { drillId: `${unit}-x`, lang: unit.startsWith('S') ? 'sql' : 'python', unit, level, type: 'predict', score, at: '', sessionId: 's', profile: 'drive', gradedBy: 'auto', transcript: '', hints: 0 }
}
function state(id: string, due: string, reps = 1): DrillState {
  return { id, ease: 2.5, interval: 1, due, reps, lapses: 0, lastScore: 2, firstSeen: '', lastSeen: '' }
}

describe('unlock rules', () => {
  it('new drills start at the first unit', () => {
    expect(newDrillUnit(drills, 'sql', new Set())).toBe('S1')
    expect(newDrillUnit(drills, 'python', new Set())).toBe('P1')
  })
  it('moves to the next unit once 80% of a unit has been seen', () => {
    const pool = newPool(drills, 'sql', 'S1')
    const need = Math.ceil(pool.length * 0.8)
    const almost = new Set(pool.slice(0, need - 1).map((d) => d.id))
    expect(newDrillUnit(drills, 'sql', almost)).toBe('S1')
    const enough = new Set(pool.slice(0, need).map((d) => d.id))
    expect(newDrillUnit(drills, 'sql', enough)).toBe('S2')
  })
  it('picks new drills across the 80% boundary', () => {
    const picked = pickNewDrills(drills, 'python', new Set(), 13, any)
    const units = new Set(picked.map((d) => d.unit))
    expect(units.has('P1')).toBe(true)
    expect(units.has('P2')).toBe(true)
    expect(new Set(picked.map((d) => d.id)).size).toBe(13)
  })
  it("opens a unit's level 2 at an average of 2.0 over the last 10 attempts", () => {
    expect(level2Open(Array.from({ length: 9 }, () => attempt('S1', 3)), 'S1')).toBe(false)
    expect(level2Open(Array.from({ length: 10 }, () => attempt('S1', 2)), 'S1')).toBe(true)
    const mixed = [...Array.from({ length: 10 }, () => attempt('S1', 0)), ...Array.from({ length: 10 }, () => attempt('S1', 2))]
    expect(level2Open(mixed, 'S1')).toBe(true) // only the last 10 count
    expect(level2Open(Array.from({ length: 10 }, (_, i) => attempt('S1', i % 2 ? 2 : 1)), 'S1')).toBe(false)
  })
})

describe('session queue', () => {
  const base = { drills, attempts: [], today: '2026-11-14', supportedTypes: L1, newPerSession: 5 }

  it('Drive only gets Drive-safe drills', () => {
    const ok = eligibleFor('drive', L1)
    for (const d of drills.filter(ok)) {
      expect(d.drive_ok).toBe(true)
      expect(d.level).toBeLessThanOrEqual(2)
    }
    const q = new SessionQueue({ ...base, profile: 'drive', languageMix: 'both', states: new Map(), seed: 0 })
    let it = q.next()
    let n = 0
    while (it && n < 200) {
      expect(it.drill.drive_ok).toBe(true)
      it = q.next()
      n++
    }
    expect(n).toBeGreaterThan(100) // tops up until the drive-safe pool runs out
  })

  it('puts due reviews first, then about 5 new drills, alternating languages in blocks of three', () => {
    const states = new Map<string, DrillState>()
    const sqlSeen = drills.filter((d) => d.lang === 'sql').slice(0, 4)
    const pySeen = drills.filter((d) => d.lang === 'python').slice(0, 4)
    for (const d of [...sqlSeen, ...pySeen]) states.set(d.id, state(d.id, '2026-11-13'))
    const q = new SessionQueue({ ...base, profile: 'parked', languageMix: 'both', states, seed: 0 })
    const planned = q.peekAll()
    expect(planned.length).toBe(8 + 5)
    expect(planned.slice(0, 3).every((i) => i.drill.lang === 'sql')).toBe(true)
    expect(planned.slice(3, 6).every((i) => i.drill.lang === 'python')).toBe(true)
    const reviews = planned.filter((i) => i.reason === 'review')
    const fresh = planned.filter((i) => i.reason === 'new')
    expect(reviews.length).toBe(8)
    expect(fresh.length).toBe(5)
    // within each language, reviews come before new drills
    for (const lang of ['sql', 'python']) {
      const seq = planned.filter((i) => i.drill.lang === lang).map((i) => i.reason)
      expect(seq.indexOf('new')).toBeGreaterThan(seq.lastIndexOf('review'))
    }
  })

  it('respects SQL only and Python only', () => {
    const q = new SessionQueue({ ...base, profile: 'drive', languageMix: 'sql', states: new Map(), seed: 1 })
    for (let i = 0; i < 30; i++) expect(q.next()?.drill.lang).toBe('sql')
  })

  it('requeues a drill only once', () => {
    const q = new SessionQueue({ ...base, profile: 'parked', languageMix: 'sql', states: new Map(), seed: 0, newPerSession: 1 })
    const first = q.next()!
    q.requeue(first.drill)
    q.requeue(first.drill)
    const rest = q.peekAll()
    expect(rest.filter((i) => i.drill.id === first.drill.id).length).toBe(1)
  })
})
