import { describe, expect, it } from 'vitest'
import { ladderProgress, practiceStreak, recentSummary, totalMinutes, weakestUnits } from '../src/engine/stats'
import type { Attempt } from '../src/storage/db'
import { loadDrills } from './helpers'

const drills = loadDrills()
// local noon on the given day, so the local date is that day in any time zone the tests run in
const at = (day: string) => new Date(`${day}T12:00:00`).toISOString()
function att(day: string, score: number, unit = 'S1', drillId = 'sql-s1-predict-001', level = 1): Attempt {
  return { drillId, lang: 'sql', unit, level, type: 'predict', score, at: at(day), sessionId: 's', profile: 'drive', gradedBy: 'auto', transcript: '', hints: 0 }
}

describe('progress stats', () => {
  it('streak counts days in a row ending today or yesterday', () => {
    const a = [att('2026-11-11', 2), att('2026-11-12', 2), att('2026-11-13', 3), att('2026-11-13', 1)]
    expect(practiceStreak(a, '2026-11-13')).toBe(3)
    expect(practiceStreak(a, '2026-11-14')).toBe(3) // nothing yet today: the streak isn't broken until tomorrow
    expect(practiceStreak(a, '2026-11-15')).toBe(0)
    expect(practiceStreak([], '2026-11-15')).toBe(0)
  })
  it('recent summary covers the last 7 days', () => {
    const a = [att('2026-11-01', 0), att('2026-11-08', 3), att('2026-11-14', 2)]
    expect(recentSummary(a, '2026-11-14')).toEqual({ n: 2, avg: 2.5 })
    expect(recentSummary([], '2026-11-14')).toEqual({ n: 0, avg: null })
  })
  it('total minutes', () => {
    expect(totalMinutes([{ id: 'a', profile: 'drive', startedAt: '', drills: 1, scored: 1, avg: 2, minutes: 12 }, { id: 'b', profile: 'parked', startedAt: '', drills: 1, scored: 1, avg: 2, minutes: 8 }])).toBe(20)
  })
  it('weakest units need enough answers and skip strong units', () => {
    const a = [
      ...Array.from({ length: 5 }, () => att('2026-11-14', 1, 'S4')),
      ...Array.from({ length: 5 }, () => att('2026-11-14', 2, 'S2')),
      ...Array.from({ length: 5 }, () => att('2026-11-14', 3, 'S1')),
      att('2026-11-14', 0, 'S5'),
    ]
    expect(weakestUnits(a, ['S1', 'S2', 'S3', 'S4', 'S5'])).toEqual([{ unit: 'S4', avg: 1 }, { unit: 'S2', avg: 2 }])
  })
  it('ladder progress lists every ladder with the best score per step', () => {
    const rows = ladderProgress(drills, [
      att('2026-11-14', 1, 'P3', 'py-p3-sketch-013', 2),
      att('2026-11-14', 3, 'P3', 'py-p3-sketch-013', 2),
      att('2026-11-14', 2, 'S3', 'sql-s3-plan-l013', 1),
    ])
    expect(rows).toHaveLength(26)
    expect(rows[0].lang).toBe('sql')
    const sumEvens = rows.find((r) => r.id === 'py-ladder-013')!
    expect(sumEvens).toMatchObject({ title: 'sum_evens', isFunction: true, plan: null, sketch: 3, dictate: null })
    const top3 = rows.find((r) => r.id === 'sql-ladder-013')!
    expect(top3).toMatchObject({ title: 'Find the three parts with the largest total quantity, largest first', plan: 2 })
    expect(rows.map((r) => r.unit)).toEqual([...rows.map((r) => r.unit)].sort((x, y) => (x[0] === y[0] ? x.localeCompare(y) : x[0] === 'S' ? -1 : 1)))
  })
})
