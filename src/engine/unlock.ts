// What unlocks (spec section 7):
//  - New drills come from the lowest unit where under 80% of its drills have been seen.
//  - A unit's level 2 opens when its level 1 average over the last 10 attempts reaches 2.0.
//  - On a ladder, Sketch opens after Plan scores 2 or more, and Dictate opens after Sketch passes.
import type { Drill, Lang } from '../data/types'
import { UNITS } from '../data/types'
import type { Attempt, Profile } from '../storage/db'

export const NEW_UNIT_SEEN_FRACTION = 0.8
export const LEVEL2_MIN_ATTEMPTS = 10
export const LEVEL2_MIN_AVG = 2.0

/** Level 1 drills that are not ladder steps: the pool new drills come from. */
export function newPool(drills: Drill[], lang: Lang, unit: string): Drill[] {
  return drills.filter((d) => d.lang === lang && d.unit === unit && d.level === 1 && !d.ladder)
}

/** The unit new drills come from right now, or null when every unit is at least 80% seen. */
export function newDrillUnit(drills: Drill[], lang: Lang, seen: Set<string>): string | null {
  for (const unit of UNITS[lang]) {
    const pool = newPool(drills, lang, unit)
    if (!pool.length) continue
    const seenCount = pool.filter((d) => seen.has(d.id)).length
    if (seenCount / pool.length < NEW_UNIT_SEEN_FRACTION) return unit
  }
  return null
}

/** Units the learner has reached: everything up to and including the current new-drill unit. */
export function reachedUnits(drills: Drill[], lang: Lang, seen: Set<string>): string[] {
  const current = newDrillUnit(drills, lang, seen)
  const units = UNITS[lang]
  if (current === null) return [...units]
  return units.slice(0, units.indexOf(current) + 1)
}

/**
 * Pick up to `count` unseen drills, following the 80% rule after each pick so that new drills
 * move to the next unit as soon as the current one is mostly seen.
 */
export function pickNewDrills(
  drills: Drill[],
  lang: Lang,
  seen: Set<string>,
  count: number,
  eligible: (d: Drill) => boolean,
  preferShort = false,
): Drill[] {
  const picked: Drill[] = []
  const long = (d: Drill) => (preferShort && (d.code ?? '').split('\n').filter((l) => l.trim()).length > 3 ? 1 : 0)
  const seenNow = new Set(seen)
  while (picked.length < count) {
    let unit = newDrillUnit(drills, lang, seenNow)
    let candidates: Drill[] = []
    if (unit) {
      candidates = newPool(drills, lang, unit).filter((d) => !seenNow.has(d.id) && eligible(d))
    }
    if (!candidates.length) {
      // the current unit has nothing usable for this profile: take the next unseen drill anywhere
      unit = null
      candidates = drills.filter((d) => d.lang === lang && d.level === 1 && !d.ladder && !seenNow.has(d.id) && eligible(d))
      candidates.sort((a, b) => UNITS[lang].indexOf(a.unit) - UNITS[lang].indexOf(b.unit))
    }
    if (!candidates.length) break
    // easier drills first (and in Drive, code of 3 lines or fewer first), otherwise the authored order
    const next = [...candidates].sort((a, b) => long(a) - long(b) || a.difficulty - b.difficulty)[0]
    picked.push(next)
    seenNow.add(next.id)
  }
  return picked
}

export function level2Open(attempts: Attempt[], unit: string): boolean {
  const scores = attempts.filter((a) => a.unit === unit && a.level === 1).map((a) => a.score)
  if (scores.length < LEVEL2_MIN_ATTEMPTS) return false
  const last = scores.slice(-10)
  return last.reduce((s, x) => s + x, 0) / last.length >= LEVEL2_MIN_AVG
}

export interface LadderSteps {
  id: string
  lang: Lang
  unit: string
  plan?: Drill
  sketch?: Drill
  dictate?: Drill
}

export function ladders(drills: Drill[]): LadderSteps[] {
  const map = new Map<string, LadderSteps>()
  for (const d of drills) {
    if (!d.ladder) continue
    const l = map.get(d.ladder) ?? { id: d.ladder, lang: d.lang, unit: d.unit }
    if (d.type === 'plan' || d.type === 'sketch' || d.type === 'dictate') l[d.type] = d
    map.set(d.ladder, l)
  }
  return [...map.values()]
}

function bestScore(attempts: Attempt[], drillId: string): number | null {
  let best: number | null = null
  for (const a of attempts) if (a.drillId === drillId && (best === null || a.score > best)) best = a.score
  return best
}

/**
 * The next ladder step to offer: finish ladders already started (Dictate, then Sketch) before
 * opening a new Plan. Steps already attempted come back through normal reviews instead.
 */
export function nextLadderStep(
  drills: Drill[],
  langs: Lang[],
  attempts: Attempt[],
  seen: Set<string>,
  profile: Profile,
  eligible: (d: Drill) => boolean,
): Drill | null {
  const all = ladders(drills).filter((l) => langs.includes(l.lang))
  const reached = new Set(langs.flatMap((lang) => reachedUnits(drills, lang, seen)))
  const candidates: { drill: Drill; rank: number }[] = []
  for (const l of all) {
    if (!reached.has(l.unit)) continue
    const planBest = l.plan ? bestScore(attempts, l.plan.id) : null
    const sketchBest = l.sketch ? bestScore(attempts, l.sketch.id) : null
    if (profile === 'parked' && l.dictate && !seen.has(l.dictate.id) && sketchBest !== null && sketchBest >= 2) {
      candidates.push({ drill: l.dictate, rank: 0 })
    } else if (l.sketch && !seen.has(l.sketch.id) && planBest !== null && planBest >= 2 && level2Open(attempts, l.unit)) {
      candidates.push({ drill: l.sketch, rank: 1 })
    } else if (l.plan && !seen.has(l.plan.id)) {
      candidates.push({ drill: l.plan, rank: 2 })
    }
  }
  const ok = candidates.filter((c) => eligible(c.drill))
  ok.sort((a, b) => a.rank - b.rank)
  return ok[0]?.drill ?? null
}
