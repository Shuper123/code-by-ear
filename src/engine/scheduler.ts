// Spaced repetition: a simple SM-2 variant (spec section 7).
//   ease starts at 2.5, floor 1.3
//   new drills: 1 day, then 3 days
//   score 3: interval x ease x 1.3     score 2: interval x ease
//   score 1: interval x 1.2, ease - 0.15
//   score 0: ease - 0.2, interval back to 1 day, requeue once at the end of the session
import { addDays } from './dates'

export type Score = 0 | 1 | 2 | 3

export interface SchedState {
  ease: number
  interval: number // days (kept fractional; the due date rounds)
  reps: number // successful-review streak position: 0 new, 1 after the first look, 2+ after that
  lapses: number
  due: string // YYYY-MM-DD
  lastScore: number | null
}

export const START_EASE = 2.5
export const MIN_EASE = 1.3

export function initialState(today: string): SchedState {
  return { ease: START_EASE, interval: 0, reps: 0, lapses: 0, due: today, lastScore: null }
}

export interface ScheduleResult {
  next: SchedState
  requeue: boolean
}

const round2 = (x: number) => Math.round(x * 100) / 100

export function schedule(prev: SchedState | null | undefined, score: Score, today: string): ScheduleResult {
  const s: SchedState = prev ? { ...prev } : initialState(today)
  let requeue = false

  if (score === 0) {
    s.ease = Math.max(MIN_EASE, s.ease - 0.2)
    s.interval = 1
    s.reps = 1
    s.lapses += 1
    requeue = true
  } else if (s.reps === 0) {
    // first time seen: 1 day, whatever the score
    s.interval = 1
    s.reps = 1
    if (score === 1) s.ease = Math.max(MIN_EASE, s.ease - 0.15)
  } else if (s.reps === 1) {
    if (score === 1) {
      s.interval = Math.max(1, s.interval * 1.2)
      s.ease = Math.max(MIN_EASE, s.ease - 0.15)
    } else {
      s.interval = 3 // then 3 days
      s.reps = 2
    }
  } else {
    if (score === 3) s.interval = s.interval * s.ease * 1.3
    else if (score === 2) s.interval = s.interval * s.ease
    else {
      s.interval = s.interval * 1.2
      s.ease = Math.max(MIN_EASE, s.ease - 0.15)
    }
    s.reps += 1
  }
  s.ease = round2(s.ease)
  s.interval = round2(s.interval)
  s.due = addDays(today, Math.max(1, Math.round(s.interval)))
  s.lastScore = score
  return { next: s, requeue }
}

export function isDue(s: SchedState | undefined, today: string): boolean {
  return !!s && s.reps > 0 && s.due <= today
}
