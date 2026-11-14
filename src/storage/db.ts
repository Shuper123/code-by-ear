// IndexedDB storage. Everything personal (progress, notes, settings, API key) lives here, on the phone.
import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

export type Lang = 'sql' | 'python'
export type Profile = 'drive' | 'parked'

export interface DrillState {
  id: string
  ease: number
  interval: number // days, may be fractional
  due: string // YYYY-MM-DD local date
  reps: number
  lapses: number
  lastScore: number | null
  firstSeen: string // ISO timestamp
  lastSeen: string // ISO timestamp
}

export interface Attempt {
  id?: number
  drillId: string
  lang: Lang
  unit: string
  level: number
  type: string
  score: number // 0..3
  at: string // ISO timestamp
  sessionId: string
  profile: Profile
  gradedBy: 'auto' | 'ai' | 'self'
  transcript: string
  hints: number
}

export interface LadderNote {
  ladder: string
  plan?: string
  sketch?: string
  dictate?: string
  updatedAt: string
}

export interface SessionRecord {
  id: string
  profile: Profile
  startedAt: string
  endedAt?: string
  drills: number
  scored: number
  avg: number
  minutes: number
}

interface CbeDB extends DBSchema {
  kv: { key: string; value: unknown }
  drillState: { key: string; value: DrillState }
  attempts: {
    key: number
    value: Attempt
    indexes: { byDrill: string; byUnit: string; byAt: string }
  }
  notes: { key: string; value: LadderNote }
  sessions: { key: string; value: SessionRecord }
}

export const DB_NAME = 'code-by-ear'
let dbp: Promise<IDBPDatabase<CbeDB>> | null = null

export function db(): Promise<IDBPDatabase<CbeDB>> {
  if (!dbp) {
    dbp = openDB<CbeDB>(DB_NAME, 1, {
      upgrade(d) {
        d.createObjectStore('kv')
        d.createObjectStore('drillState', { keyPath: 'id' })
        const a = d.createObjectStore('attempts', { keyPath: 'id', autoIncrement: true })
        a.createIndex('byDrill', 'drillId')
        a.createIndex('byUnit', 'unit')
        a.createIndex('byAt', 'at')
        d.createObjectStore('notes', { keyPath: 'ladder' })
        d.createObjectStore('sessions', { keyPath: 'id' })
      },
    })
  }
  return dbp
}

/** Test hook: forget the cached connection (used with fake-indexeddb). */
export function resetDbForTests(): void {
  dbp = null
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  return (await (await db()).get('kv', key)) as T | undefined
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  await (await db()).put('kv', value, key)
}

export async function kvDelete(key: string): Promise<void> {
  await (await db()).delete('kv', key)
}

/** Ask the browser not to evict our data under storage pressure. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true
    return (await navigator.storage?.persist?.()) ?? false
  } catch {
    return false
  }
}
