// Export and import of everything personal on the phone (spec section 12), as one JSON file.
// The API key is never written to a backup, and importing never touches the key already on the phone.
// Import replaces progress, notes, sessions and settings in one transaction, so it can't half-apply.
import { db, type Attempt, type DrillState, type LadderNote, type SessionRecord } from './db'

export const BACKUP_FORMAT = 'code-by-ear-backup'
export const BACKUP_VERSION = 1
/** kv keys that never leave the phone or get overwritten by an import. */
const PRIVATE_KEYS = new Set(['apiKey'])

export interface Backup {
  format: typeof BACKUP_FORMAT
  version: number
  exportedAt: string
  build?: string
  kv: Record<string, unknown>
  drillState: DrillState[]
  attempts: Attempt[]
  notes: LadderNote[]
  sessions: SessionRecord[]
}

export async function exportBackup(build?: string, now = new Date()): Promise<Backup> {
  const d = await db()
  const tx = d.transaction(['kv', 'drillState', 'attempts', 'notes', 'sessions'], 'readonly')
  const kvStore = tx.objectStore('kv')
  const [keys, values, drillState, attempts, notes, sessions] = await Promise.all([
    kvStore.getAllKeys(),
    kvStore.getAll(),
    tx.objectStore('drillState').getAll(),
    tx.objectStore('attempts').index('byAt').getAll(),
    tx.objectStore('notes').getAll(),
    tx.objectStore('sessions').getAll(),
  ])
  await tx.done
  const kv: Record<string, unknown> = {}
  keys.forEach((k, i) => {
    if (!PRIVATE_KEYS.has(String(k))) kv[String(k)] = values[i]
  })
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    build,
    kv,
    drillState,
    attempts: attempts.map(({ id: _id, ...a }) => a as Attempt),
    notes,
    sessions,
  }
}

export function backupFileName(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `code-by-ear-backup-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}.json`
}

export type ParseResult = { ok: true; backup: Backup } | { ok: false; error: string }

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
const isStr = (x: unknown): x is string => typeof x === 'string'

/** Checks a file's contents before anything is replaced. Errors are short and readable on a phone. */
export function parseBackup(text: string): ParseResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: "That file isn't valid JSON." }
  }
  if (!isObj(raw) || raw.format !== BACKUP_FORMAT) return { ok: false, error: "That file isn't a Code by Ear backup." }
  if (typeof raw.version !== 'number' || raw.version > BACKUP_VERSION) {
    return { ok: false, error: 'That backup comes from a newer version of the app. Update the app, then import it.' }
  }
  for (const k of ['drillState', 'attempts', 'notes', 'sessions'] as const) {
    if (!Array.isArray(raw[k])) return { ok: false, error: `The backup is missing its ${k} list.` }
  }
  if (!isObj(raw.kv)) return { ok: false, error: 'The backup is missing its settings.' }
  const states = raw.drillState as unknown[]
  const attempts = raw.attempts as unknown[]
  const notes = raw.notes as unknown[]
  const sessions = raw.sessions as unknown[]
  const badState = states.findIndex((s) => !isObj(s) || !isStr(s.id) || !isStr(s.due) || typeof s.reps !== 'number')
  if (badState >= 0) return { ok: false, error: `Drill state ${badState + 1} in the backup is damaged.` }
  const badAttempt = attempts.findIndex(
    (a) =>
      !isObj(a) ||
      !isStr(a.drillId) ||
      !isStr(a.at) ||
      typeof a.score !== 'number' ||
      a.score < 0 ||
      a.score > 3 ||
      typeof a.level !== 'number' ||
      !isStr(a.unit),
  )
  if (badAttempt >= 0) return { ok: false, error: `Answer ${badAttempt + 1} in the backup is damaged.` }
  const badNote = notes.findIndex((n) => !isObj(n) || !isStr(n.ladder))
  if (badNote >= 0) return { ok: false, error: `Note ${badNote + 1} in the backup is damaged.` }
  const badSession = sessions.findIndex((s) => !isObj(s) || !isStr(s.id) || !isStr(s.startedAt))
  if (badSession >= 0) return { ok: false, error: `Session ${badSession + 1} in the backup is damaged.` }
  const kv = Object.fromEntries(Object.entries(raw.kv).filter(([k]) => !PRIVATE_KEYS.has(k)))
  return {
    ok: true,
    backup: {
      format: BACKUP_FORMAT,
      version: raw.version,
      exportedAt: isStr(raw.exportedAt) ? raw.exportedAt : '',
      build: isStr(raw.build) ? raw.build : undefined,
      kv,
      drillState: states as DrillState[],
      attempts: (attempts as Attempt[]).map(({ id: _id, ...a }) => a as Attempt),
      notes: notes as LadderNote[],
      sessions: sessions as SessionRecord[],
    },
  }
}

/** One line for the confirm step, e.g. "312 answers on 140 drills, 18 sessions, saved Nov 14, 2026". */
export function describeBackup(b: Backup): string {
  const when = b.exportedAt
    ? new Date(b.exportedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : 'an unknown date'
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
  return `${plural(b.attempts.length, 'answer')} on ${plural(b.drillState.length, 'drill')}, ${plural(b.sessions.length, 'session')}, saved ${when}`
}

/** Replaces everything except the API key with the backup's contents, all or nothing. */
export async function importBackup(b: Backup): Promise<void> {
  const d = await db()
  const tx = d.transaction(['kv', 'drillState', 'attempts', 'notes', 'sessions'], 'readwrite')
  const kvStore = tx.objectStore('kv')
  const ops: Promise<unknown>[] = []
  for (const k of await kvStore.getAllKeys()) if (!PRIVATE_KEYS.has(String(k))) ops.push(kvStore.delete(k))
  for (const [k, v] of Object.entries(b.kv)) if (!PRIVATE_KEYS.has(k)) ops.push(kvStore.put(v, k))
  ops.push(tx.objectStore('drillState').clear(), tx.objectStore('attempts').clear(), tx.objectStore('notes').clear())
  ops.push(tx.objectStore('sessions').clear())
  for (const s of b.drillState) ops.push(tx.objectStore('drillState').put(s))
  const ordered = [...b.attempts].sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0))
  for (const { id: _id, ...a } of ordered) ops.push(tx.objectStore('attempts').add(a as Attempt))
  for (const n of b.notes) ops.push(tx.objectStore('notes').put(n))
  for (const s of b.sessions) ops.push(tx.objectStore('sessions').put(s))
  await Promise.all([...ops, tx.done])
}
