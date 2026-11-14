// Export and import (spec section 12): round trip, the API key never leaves or gets overwritten,
// damaged files are refused before anything changes.
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { backupFileName, describeBackup, exportBackup, importBackup, parseBackup } from '../src/storage/backup'
import { db, kvGet, kvSet, resetDbForTests, type Attempt, type DrillState } from '../src/storage/db'

const KEY = 'sk-ant-test-secret-do-not-export'

function attempt(i: number, score: number): Attempt {
  return {
    drillId: `sql-s1-predict-00${i}`, lang: 'sql', unit: 'S1', level: 1, type: 'predict', score,
    at: `2026-11-1${i}T16:00:00.000Z`, sessionId: 's1', profile: 'drive', gradedBy: 'auto', transcript: 'three', hints: 0,
  }
}
function state(i: number): DrillState {
  return {
    id: `sql-s1-predict-00${i}`, ease: 2.5, interval: 1, due: '2026-11-15', reps: 1, lapses: 0, lastScore: 3,
    firstSeen: '2026-11-14T16:00:00.000Z', lastSeen: '2026-11-14T16:00:00.000Z',
  }
}

async function seed() {
  const d = await db()
  await kvSet('apiKey', KEY)
  await kvSet('settings', { model: 'claude-haiku-5-5', newPerSession: 7 })
  await kvSet('noticeAccepted', true)
  for (const i of [1, 2, 3]) {
    await d.put('drillState', state(i))
    await d.add('attempts', attempt(i, i))
  }
  await d.put('notes', { ladder: 'sql-ladder-001', plan: 'select the names', updatedAt: '2026-11-14T16:00:00.000Z' })
  await d.put('sessions', { id: 's1', profile: 'drive', startedAt: '2026-11-14T16:00:00.000Z', drills: 3, scored: 3, avg: 2, minutes: 5 })
}

async function wipe() {
  const d = await db()
  for (const s of ['kv', 'drillState', 'attempts', 'notes', 'sessions'] as const) await d.clear(s)
}

beforeEach(async () => {
  resetDbForTests()
  await wipe()
})

describe('backup export', () => {
  it('includes progress, notes, sessions and settings, but never the API key', async () => {
    await seed()
    const b = await exportBackup('abc1234', new Date('2026-11-14T18:00:00Z'))
    const text = JSON.stringify(b)
    expect(text).not.toContain(KEY)
    expect(b.kv).toEqual({ settings: { model: 'claude-haiku-5-5', newPerSession: 7 }, noticeAccepted: true })
    expect(b.attempts.map((a) => a.score)).toEqual([1, 2, 3])
    expect(b.attempts[0]).not.toHaveProperty('id')
    expect(b.drillState).toHaveLength(3)
    expect(b.notes[0].plan).toBe('select the names')
    expect(b.sessions[0].id).toBe('s1')
    expect(b.build).toBe('abc1234')
    expect(describeBackup(b)).toMatch(/^3 answers on 3 drills, 1 session, saved Nov 14, 2026$/)
    expect(backupFileName(new Date(2026, 10, 4))).toBe('code-by-ear-backup-2026-11-04.json')
  })
})

describe('backup import', () => {
  it('round trip: export, wipe, import gives the same data back', async () => {
    await seed()
    const text = JSON.stringify(await exportBackup())
    await wipe()
    const parsed = parseBackup(text)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    await importBackup(parsed.backup)
    const again = await exportBackup()
    const first = JSON.parse(text)
    expect({ ...again, exportedAt: '' }).toEqual({ ...first, exportedAt: '' })
  })

  it('replaces what was there, and keeps the API key already on the phone', async () => {
    await seed()
    const backup = await exportBackup()
    const d = await db()
    await d.add('attempts', attempt(4, 0))
    await kvSet('settings', { model: 'claude-sonnet-5-5' })
    await kvSet('apiKey', 'sk-ant-the-phone-key')
    await kvSet('stray', 1)
    await importBackup({ ...backup, kv: { ...backup.kv, apiKey: 'sk-ant-from-a-file' } })
    expect((await d.getAll('attempts')).map((a) => a.score)).toEqual([1, 2, 3])
    expect(await kvGet('settings')).toEqual({ model: 'claude-haiku-5-5', newPerSession: 7 })
    expect(await kvGet('apiKey')).toBe('sk-ant-the-phone-key')
    expect(await kvGet('stray')).toBeUndefined()
  })

  it('a key inside a hand-edited file is dropped when parsed', async () => {
    await seed()
    const b = await exportBackup()
    const parsed = parseBackup(JSON.stringify({ ...b, kv: { ...b.kv, apiKey: 'sk-ant-from-a-file' } }))
    expect(parsed.ok && 'apiKey' in parsed.backup.kv).toBe(false)
  })

  it('refuses damaged or foreign files with a readable reason', async () => {
    await seed()
    const good = await exportBackup()
    const bad = (x: unknown) => {
      const r = parseBackup(typeof x === 'string' ? x : JSON.stringify(x))
      return r.ok ? 'accepted' : r.error
    }
    expect(bad('{not json')).toBe("That file isn't valid JSON.")
    expect(bad({ hello: 1 })).toBe("That file isn't a Code by Ear backup.")
    expect(bad({ ...good, version: 99 })).toMatch(/newer version/)
    expect(bad({ ...good, attempts: undefined })).toBe('The backup is missing its attempts list.')
    expect(bad({ ...good, attempts: [{ ...good.attempts[0], score: 7 }] })).toBe('Answer 1 in the backup is damaged.')
    expect(bad({ ...good, drillState: [{ id: 3 }] })).toBe('Drill state 1 in the backup is damaged.')
    expect(bad(good)).toBe('accepted')
  })
})
