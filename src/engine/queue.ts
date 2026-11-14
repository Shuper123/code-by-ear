// Builds the order of drills for a session (spec sections 5 and 7):
// items due for review first, then about 5 new items, then one ladder step. Languages alternate
// in blocks of three. When that runs out before the session time is up, the queue tops up with
// more new drills, then with reviews that are not due yet.
import type { Drill, Lang } from '../data/types'
import type { Attempt, DrillState, Profile } from '../storage/db'
import { nextLadderStep, pickNewDrills } from './unlock'

export const DRIVE_MAX_LEVEL = 2

export interface QueueItem {
  drill: Drill
  reason: 'review' | 'new' | 'ladder' | 'extra-new' | 'early-review' | 'requeue'
}

export interface QueueInput {
  drills: Drill[]
  profile: Profile
  languageMix: 'both' | 'sql' | 'python'
  newPerSession: number
  states: Map<string, DrillState>
  attempts: Attempt[]
  today: string
  /** Changes which language starts and gets the odd new drill; use the day number. */
  seed: number
  /** Drill types the app can run in this build. */
  supportedTypes: ReadonlySet<string>
  /** Practice exactly these drills (from the Drills browser), in this order, with no top-ups. */
  only?: string[]
}

export function languagesFor(mix: QueueInput['languageMix']): Lang[] {
  return mix === 'sql' ? ['sql'] : mix === 'python' ? ['python'] : ['sql', 'python']
}

/** Drive allows Level 1 and short Level 2 drills only; Dictate is Parked only (spec section 12). */
export function eligibleFor(profile: Profile, supported: ReadonlySet<string>) {
  return (d: Drill): boolean => {
    if (!supported.has(d.type)) return false
    if (profile === 'drive') return d.drive_ok && d.level <= DRIVE_MAX_LEVEL && d.type !== 'dictate'
    return true
  }
}

export class SessionQueue {
  private items: QueueItem[] = []
  private used = new Set<string>()
  private requeued = new Set<string>()
  private langs: Lang[]
  private eligible: (d: Drill) => boolean
  private seen: Set<string>
  private topUpTurn = 0
  private earlyPool: Drill[] | null = null

  constructor(private input: QueueInput) {
    this.langs = languagesFor(input.languageMix)
    this.eligible = eligibleFor(input.profile, input.supportedTypes)
    this.seen = new Set([...input.states.values()].filter((s) => s.reps > 0).map((s) => s.id))
    this.build()
  }

  private byLang(lang: Lang) {
    return this.input.drills.filter((d) => d.lang === lang && this.eligible(d))
  }

  private build() {
    if (this.input.only) {
      const byId = new Map(this.input.drills.map((d) => [d.id, d]))
      for (const id of this.input.only) {
        const d = byId.get(id)
        if (d && this.input.supportedTypes.has(d.type)) this.items.push({ drill: d, reason: this.seen.has(id) ? 'review' : 'new' })
      }
      for (const it of this.items) this.used.add(it.drill.id)
      return
    }
    const { states, today, newPerSession, seed } = this.input
    const perLang = new Map<Lang, QueueItem[]>()
    // split new drills between languages; the odd one alternates by day
    const newCounts = new Map<Lang, number>()
    if (this.langs.length === 1) newCounts.set(this.langs[0], newPerSession)
    else {
      const first = seed % 2 === 0 ? 'sql' : 'python'
      newCounts.set(first, Math.ceil(newPerSession / 2))
      newCounts.set(first === 'sql' ? 'python' : 'sql', Math.floor(newPerSession / 2))
    }
    for (const lang of this.langs) {
      const due = this.byLang(lang)
        .filter((d) => {
          const s = states.get(d.id)
          return !!s && s.reps > 0 && s.due <= today
        })
        .sort((a, b) => {
          const sa = states.get(a.id)!
          const sb = states.get(b.id)!
          return sa.due === sb.due ? sa.ease - sb.ease : sa.due < sb.due ? -1 : 1
        })
        .map((drill): QueueItem => ({ drill, reason: 'review' }))
      const fresh = pickNewDrills(this.input.drills, lang, this.seen, newCounts.get(lang) ?? 0, this.eligible).map(
        (drill): QueueItem => ({ drill, reason: 'new' }),
      )
      perLang.set(lang, [...due, ...fresh])
    }
    // interleave in blocks of three, starting with a language that alternates by day
    const order = this.langs.length === 2 && seed % 2 === 1 ? ['python', 'sql'] as Lang[] : this.langs
    const lists = order.map((l) => [...(perLang.get(l) ?? [])])
    while (lists.some((l) => l.length)) {
      for (const l of lists) this.items.push(...l.splice(0, 3))
    }
    const ladder = nextLadderStep(this.input.drills, this.langs, this.input.attempts, this.seen, this.input.profile, this.eligible)
    if (ladder) this.items.push({ drill: ladder, reason: 'ladder' })
    for (const it of this.items) this.used.add(it.drill.id)
  }

  /** Planned items left (not counting top-ups). */
  remaining(): number {
    return this.items.length
  }

  peekAll(): QueueItem[] {
    return [...this.items]
  }

  next(): QueueItem | null {
    const it = this.items.shift()
    if (it) return it
    return this.topUp()
  }

  /** A drill scored 0 comes back once at the end of the session. */
  requeue(drill: Drill): void {
    if (this.requeued.has(drill.id)) return
    this.requeued.add(drill.id)
    this.items.push({ drill, reason: 'requeue' })
  }

  /** Record that a drill was seen this session (so top-ups move on to the next drills). */
  markSeen(id: string): void {
    this.seen.add(id)
    this.used.add(id)
  }

  private topUp(): QueueItem | null {
    if (this.input.only) return null
    // more new drills, alternating languages in blocks of three
    for (let tries = 0; tries < this.langs.length; tries++) {
      const lang = this.langs[(this.topUpTurn + tries) % this.langs.length]
      const extra = pickNewDrills(this.input.drills, lang, new Set([...this.seen, ...this.used]), 3, this.eligible)
      if (extra.length) {
        this.topUpTurn = (this.topUpTurn + tries + 1) % this.langs.length
        for (const d of extra) {
          this.used.add(d.id)
          this.items.push({ drill: d, reason: 'extra-new' })
        }
        return this.items.shift() ?? null
      }
    }
    // then reviews that are not due yet, soonest first
    if (!this.earlyPool) {
      const { states } = this.input
      this.earlyPool = this.input.drills
        .filter((d) => this.langs.includes(d.lang) && this.eligible(d) && states.get(d.id)?.reps)
        .sort((a, b) => (states.get(a.id)!.due < states.get(b.id)!.due ? -1 : 1))
    }
    while (this.earlyPool.length) {
      const d = this.earlyPool.shift()!
      if (this.used.has(d.id)) continue
      this.used.add(d.id)
      return { drill: d, reason: 'early-review' }
    }
    return null
  }
}
