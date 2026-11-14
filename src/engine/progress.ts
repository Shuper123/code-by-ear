// Progress persistence and the numbers derived from it (mastery, due counts).
import type { Drill, Lang } from '../data/types'
import { db, type Attempt, type DrillState, type LadderNote, type SessionRecord } from '../storage/db'

export interface ProgressStore {
  loadStates(): Promise<Map<string, DrillState>>
  loadAttempts(): Promise<Attempt[]>
  saveState(s: DrillState): Promise<void>
  addAttempt(a: Attempt): Promise<void>
  getNote(ladder: string): Promise<LadderNote | undefined>
  saveNote(ladder: string, field: 'plan' | 'sketch' | 'dictate', text: string): Promise<void>
  saveSession(rec: SessionRecord): Promise<void>
}

export const idbStore: ProgressStore = {
  async loadStates() {
    const all = await (await db()).getAll('drillState')
    return new Map(all.map((s) => [s.id, s]))
  },
  async loadAttempts() {
    const all = await (await db()).getAllFromIndex('attempts', 'byAt')
    return all
  },
  async saveState(s) {
    await (await db()).put('drillState', s)
  },
  async addAttempt(a) {
    const { id: _ignored, ...rest } = a
    await (await db()).add('attempts', rest as Attempt)
  },
  async getNote(ladder) {
    return (await db()).get('notes', ladder)
  },
  async saveNote(ladder, field, text) {
    const d = await db()
    const prev = (await d.get('notes', ladder)) ?? { ladder, updatedAt: '' }
    await d.put('notes', { ...prev, [field]: text, updatedAt: new Date().toISOString() })
  },
  async saveSession(rec) {
    await (await db()).put('sessions', rec)
  },
}

/** In-memory store for tests and previews. */
export class MemoryStore implements ProgressStore {
  states = new Map<string, DrillState>()
  attempts: Attempt[] = []
  notes = new Map<string, LadderNote>()
  sessions: SessionRecord[] = []
  async loadStates() {
    return new Map(this.states)
  }
  async loadAttempts() {
    return [...this.attempts]
  }
  async saveState(s: DrillState) {
    this.states.set(s.id, { ...s })
  }
  async addAttempt(a: Attempt) {
    this.attempts.push({ ...a, id: this.attempts.length + 1 })
  }
  async getNote(ladder: string) {
    return this.notes.get(ladder)
  }
  async saveNote(ladder: string, field: 'plan' | 'sketch' | 'dictate', text: string) {
    const prev = this.notes.get(ladder) ?? { ladder, updatedAt: '' }
    this.notes.set(ladder, { ...prev, [field]: text, updatedAt: new Date().toISOString() })
  }
  async saveSession(rec: SessionRecord) {
    this.sessions = this.sessions.filter((s) => s.id !== rec.id).concat(rec)
  }
}

/** Mastery: the average of the last 10 scores for a unit and level (null when never attempted). */
export function mastery(attempts: Attempt[], unit: string, level: number): { avg: number | null; n: number } {
  const scores = attempts.filter((a) => a.unit === unit && a.level === level).map((a) => a.score)
  const last = scores.slice(-10)
  if (!last.length) return { avg: null, n: 0 }
  return { avg: last.reduce((s, x) => s + x, 0) / last.length, n: last.length }
}

export function dueCount(states: Map<string, DrillState>, drills: Drill[], onOrBefore: string, lang?: Lang): number {
  const ids = new Set(drills.filter((d) => !lang || d.lang === lang).map((d) => d.id))
  let n = 0
  for (const s of states.values()) if (ids.has(s.id) && s.reps > 0 && s.due <= onOrBefore) n++
  return n
}
