import { describe, expect, it } from 'vitest'
import { addDays, daysBetween } from '../src/engine/dates'
import { MIN_EASE, schedule, type SchedState } from '../src/engine/scheduler'

const T = '2026-11-14'

describe('SM-2 variant', () => {
  it('starts new drills at 1 day, then 3', () => {
    const a = schedule(null, 2, T)
    expect(a.next.interval).toBe(1)
    expect(a.next.due).toBe('2026-11-15')
    expect(a.requeue).toBe(false)
    const b = schedule(a.next, 2, '2026-11-15')
    expect(b.next.interval).toBe(3)
    expect(b.next.due).toBe('2026-11-18')
  })
  it('multiplies by ease for 2 and by ease x 1.3 for 3', () => {
    const s: SchedState = { ease: 2.5, interval: 3, reps: 2, lapses: 0, due: T, lastScore: 2 }
    expect(schedule(s, 2, T).next.interval).toBe(7.5)
    expect(schedule(s, 2, T).next.due).toBe(addDays(T, 8))
    expect(schedule(s, 3, T).next.interval).toBe(9.75)
    expect(schedule(s, 3, T).next.ease).toBe(2.5)
  })
  it('a 1 grows the interval by 1.2 and lowers ease by 0.15', () => {
    const s: SchedState = { ease: 2.5, interval: 10, reps: 3, lapses: 0, due: T, lastScore: 2 }
    const r = schedule(s, 1, T)
    expect(r.next.interval).toBe(12)
    expect(r.next.ease).toBe(2.35)
  })
  it('a 0 lowers ease by 0.2, resets to 1 day and requeues once', () => {
    const s: SchedState = { ease: 2.5, interval: 20, reps: 4, lapses: 0, due: T, lastScore: 3 }
    const r = schedule(s, 0, T)
    expect(r.next.ease).toBe(2.3)
    expect(r.next.interval).toBe(1)
    expect(r.next.due).toBe('2026-11-15')
    expect(r.next.lapses).toBe(1)
    expect(r.requeue).toBe(true)
    // after a lapse the next success goes to 3 days again
    expect(schedule(r.next, 2, '2026-11-15').next.interval).toBe(3)
  })
  it('never lets ease drop below 1.3', () => {
    let s: SchedState | null = null
    for (let i = 0; i < 20; i++) s = schedule(s, 0, T).next
    expect(s!.ease).toBe(MIN_EASE)
  })
  it('a new drill scored 0 is requeued', () => {
    expect(schedule(null, 0, T).requeue).toBe(true)
  })
  it('date helpers cross month and year ends', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02')
    expect(daysBetween('2026-11-14', '2026-12-14')).toBe(30)
  })
})
