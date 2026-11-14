// Numbers for the Progress screen, kept pure so they're easy to test.
import type { Drill, Lang } from '../data/types'
import type { Attempt, SessionRecord } from '../storage/db'
import { addDays, localDate } from './dates'
import { ladders, type LadderSteps } from './unlock'
import { mastery } from './progress'

const dayOf = (iso: string) => localDate(new Date(iso))

/** Days in a row with at least one answer, ending today (or yesterday, if nothing yet today). */
export function practiceStreak(attempts: Attempt[], today: string): number {
  const days = new Set(attempts.map((a) => dayOf(a.at)))
  let day = days.has(today) ? today : addDays(today, -1)
  let n = 0
  while (days.has(day)) {
    n++
    day = addDays(day, -1)
  }
  return n
}

/** Answers and their average over the last `days` days, today included. */
export function recentSummary(attempts: Attempt[], today: string, days = 7): { n: number; avg: number | null } {
  const from = addDays(today, -(days - 1))
  const recent = attempts.filter((a) => {
    const d = dayOf(a.at)
    return d >= from && d <= today
  })
  return { n: recent.length, avg: recent.length ? recent.reduce((s, a) => s + a.score, 0) / recent.length : null }
}

export function totalMinutes(sessions: SessionRecord[]): number {
  return sessions.reduce((s, x) => s + (x.minutes || 0), 0)
}

/** The weakest units at Level 1 with enough answers to judge, lowest first. */
export function weakestUnits(attempts: Attempt[], units: string[], minN = 5, max = 2): { unit: string; avg: number }[] {
  return units
    .map((unit) => ({ unit, m: mastery(attempts, unit, 1) }))
    .filter((x) => x.m.avg !== null && x.m.n >= minN && x.m.avg < 2.5)
    .sort((a, b) => a.m.avg! - b.m.avg!)
    .slice(0, max)
    .map((x) => ({ unit: x.unit, avg: x.m.avg! }))
}

export interface LadderRow {
  id: string
  lang: Lang
  unit: string
  title: string
  isFunction: boolean
  plan: number | null
  sketch: number | null
  dictate: number | null
}

export function ladderTitle(l: LadderSteps): { title: string; isFunction: boolean } {
  const fn = l.sketch?.function_name ?? l.dictate?.function_name
  if (fn) return { title: fn, isFunction: true }
  const task = l.sketch?.prompt_spoken ?? l.plan?.prompt_spoken.replace(/^Plan this out loud\. /, '') ?? l.id
  const short = task
    .replace(/^Using the [\w ]+? tables?, /, '')
    .replace(/\.$/, '')
    .replace(/^\w/, (c) => c.toUpperCase())
  return { title: short, isFunction: false }
}

/** Best score so far on each step of every ladder, in content order. */
export function ladderProgress(drills: Drill[], attempts: Attempt[]): LadderRow[] {
  const best = new Map<string, number>()
  for (const a of attempts) best.set(a.drillId, Math.max(best.get(a.drillId) ?? -1, a.score))
  const get = (d?: Drill) => (d && best.has(d.id) ? best.get(d.id)! : null)
  return ladders(drills)
    .map((l) => ({ id: l.id, lang: l.lang, unit: l.unit, ...ladderTitle(l), plan: get(l.plan), sketch: get(l.sketch), dictate: get(l.dictate) }))
    .sort((a, b) =>
      a.lang !== b.lang ? (a.lang === 'sql' ? -1 : 1) : a.unit !== b.unit ? a.unit.localeCompare(b.unit) : a.id.localeCompare(b.id),
    )
}
