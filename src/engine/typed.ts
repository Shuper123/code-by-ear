// Typed mode: the tasks you built by voice come back at the keyboard, run against the same reference.
// Voice practice builds the thinking; this is where the hands catch up, and its first-try pass rate is
// the scoreboard for whether the voice practice carries over.
//
// Typed attempts live in the same stores as everything else (so backups include them), under the task's
// id plus "#typed", with type "typed" and level 4. They get their own review schedule.
import type { Drill } from '../data/types'
import type { Attempt, DrillState } from '../storage/db'
import { localDate } from './dates'
import type { ProgressStore } from './progress'
import { schedule, type SchedState, type Score } from './scheduler'

export const TYPED_SUFFIX = '#typed'
export const TYPED_LEVEL = 4
export const typedId = (drillId: string) => `${drillId}${TYPED_SUFFIX}`

/** Tasks that can be typed: SQL tasks with a reference query (build tasks, and each ladder once, as its Sketch). */
export function typedTasks(drills: Drill[]): Drill[] {
  return drills.filter((d) => d.lang === 'sql' && !!d.reference && !!d.dataset && (d.type === 'build' || d.type === 'sketch'))
}

/** The drills whose voice attempts count for a typed task: itself, plus the Dictate step of its ladder. */
function voiceIds(task: Drill, drills: Drill[]): Set<string> {
  const ids = new Set([task.id])
  if (task.ladder) for (const d of drills) if (d.ladder === task.ladder && (d.type === 'sketch' || d.type === 'dictate')) ids.add(d.id)
  return ids
}

export interface TypedItem {
  drill: Drill
  /** review: a typed review is due. voice: built by voice and not typed since. */
  reason: 'review' | 'voice'
}

/** The next typed set: typed reviews that are due, then tasks passed by voice and not typed since. */
export function typedQueue(drills: Drill[], states: Map<string, DrillState>, attempts: Attempt[], today: string, max: number): TypedItem[] {
  const tasks = typedTasks(drills)
  const reviews = tasks
    .filter((d) => {
      const s = states.get(typedId(d.id))
      return !!s && s.reps > 0 && s.due <= today
    })
    .sort((a, b) => (states.get(typedId(a.id))!.due < states.get(typedId(b.id))!.due ? -1 : 1))
  const reviewIds = new Set(reviews.map((d) => d.id))
  const fromVoice: { drill: Drill; at: string }[] = []
  for (const d of tasks) {
    if (reviewIds.has(d.id)) continue
    const ids = voiceIds(d, drills)
    let passed = ''
    let typed = ''
    for (const a of attempts) {
      if (a.drillId === typedId(d.id)) typed = a.at > typed ? a.at : typed
      else if (ids.has(a.drillId) && a.score >= 2 && a.at > passed) passed = a.at
    }
    if (passed && passed > typed) fromVoice.push({ drill: d, at: passed })
  }
  fromVoice.sort((a, b) => (a.at > b.at ? -1 : 1))
  return [
    ...reviews.map((drill): TypedItem => ({ drill, reason: 'review' })),
    ...fromVoice.map(({ drill }): TypedItem => ({ drill, reason: 'voice' })),
  ].slice(0, Math.max(1, max))
}

export interface TypedOutcome {
  /** How many times Run was pressed, counting the one that matched. */
  tries: number
  /** The answer was shown before a match. */
  revealed: boolean
  sql: string
}

/** First try 3; second or third 2; later 1; answer shown 0. */
export function typedScore(o: TypedOutcome): Score {
  if (o.revealed) return 0
  return o.tries <= 1 ? 3 : o.tries <= 3 ? 2 : 1
}

/** Save a typed attempt and schedule the next typed review of that task. */
export async function recordTyped(store: ProgressStore, d: Drill, o: TypedOutcome, now: Date): Promise<Score> {
  const score = typedScore(o)
  const id = typedId(d.id)
  const states = await store.loadStates()
  const prev = states.get(id)
  const prevSched: SchedState | undefined = prev
    ? { ease: prev.ease, interval: prev.interval, reps: prev.reps, lapses: prev.lapses, due: prev.due, lastScore: prev.lastScore }
    : undefined
  const { next } = schedule(prevSched, score, localDate(now))
  const iso = now.toISOString()
  await store.saveState({ id, ...next, firstSeen: prev?.firstSeen ?? iso, lastSeen: iso })
  await store.addAttempt({
    drillId: id,
    lang: d.lang,
    unit: d.unit,
    level: TYPED_LEVEL,
    type: 'typed',
    score,
    at: iso,
    sessionId: `typed-${localDate(now)}`,
    profile: 'parked',
    gradedBy: 'auto',
    transcript: o.sql,
    hints: Math.max(0, o.tries - 1),
  })
  return score
}

export interface TypedStats {
  /** Typed attempts ever. */
  total: number
  /** Of the last `window` attempts: how many matched on the first Run. */
  recent: { n: number; firstTry: number }
  allTime: { n: number; firstTry: number }
  /** Tasks passed by voice that have not been typed since. */
  waiting: number
}

export function typedStats(drills: Drill[], states: Map<string, DrillState>, attempts: Attempt[], today: string, window = 20): TypedStats {
  const typed = attempts.filter((a) => a.type === 'typed')
  const count = (list: Attempt[]) => ({ n: list.length, firstTry: list.filter((a) => a.score === 3).length })
  return {
    total: typed.length,
    recent: count(typed.slice(-window)),
    allTime: count(typed),
    waiting: typedQueue(drills, states, attempts, today, 1000).filter((x) => x.reason === 'voice').length,
  }
}
