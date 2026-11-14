// Progress: mastery by unit and level (average of the last 10 scores), plus due counts.
import { useEffect, useState } from 'preact/hooks'
import { ALL_DRILLS } from '../data/drills'
import { LEVEL_NAMES, UNIT_NAMES, UNITS, type Lang } from '../data/types'
import { addDays, localDate } from '../engine/dates'
import { dueCount, idbStore, mastery } from '../engine/progress'
import type { Attempt, DrillState, SessionRecord } from '../storage/db'
import { db } from '../storage/db'
import { goBack } from './nav'

interface Data {
  states: Map<string, DrillState>
  attempts: Attempt[]
  sessions: SessionRecord[]
}

function fmt(avg: number | null): string {
  return avg === null ? '–' : avg.toFixed(1)
}

export function ProgressScreen() {
  const [data, setData] = useState<Data | null>(null)
  useEffect(() => {
    void (async () => {
      const [states, attempts, sessions] = await Promise.all([
        idbStore.loadStates(),
        idbStore.loadAttempts(),
        (await db()).getAll('sessions'),
      ])
      setData({ states, attempts, sessions: sessions.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1)) })
    })()
  }, [])

  if (!data) return <div class="page muted">Loading…</div>
  const today = localDate()
  const levels = [1, 2, 3]
  const table = (lang: Lang) => (
    <table class="unit-table">
      <thead>
        <tr>
          <th>Unit</th>
          {levels.map((l) => (
            <th>{LEVEL_NAMES[l]}</th>
          ))}
          <th>Seen</th>
        </tr>
      </thead>
      <tbody>
        {UNITS[lang].map((u) => {
          const drills = ALL_DRILLS.filter((d) => d.unit === u)
          const seen = drills.filter((d) => data.states.get(d.id)?.reps).length
          return (
            <tr>
              <td>
                {u} {UNIT_NAMES[u]}
              </td>
              {levels.map((l) => {
                const m = mastery(data.attempts, u, l)
                return <td class={m.avg === null ? 'muted' : `score-${Math.round(m.avg)}`}>{fmt(m.avg)}</td>
              })}
              <td class="muted">
                {seen}/{drills.length}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )

  return (
    <div class="page">
      <div class="topbar">
        <button class="back" onClick={goBack}>
          ← Back
        </button>
        <h1>Progress</h1>
      </div>
      <div class="card">
        <p>
          <strong>{dueCount(data.states, ALL_DRILLS, today)}</strong> due today ·{' '}
          <strong>{dueCount(data.states, ALL_DRILLS, addDays(today, 1))}</strong> by tomorrow · {data.attempts.length} answers
          in {data.sessions.length} sessions
        </p>
        <p class="faint">Mastery is the average of your last 10 scores per unit and level, out of 3.</p>
      </div>
      <div class="card">
        <h2>SQL</h2>
        {table('sql')}
      </div>
      <div class="card">
        <h2>Python</h2>
        {table('python')}
      </div>
      {data.sessions.length > 0 && (
        <div class="card">
          <h2>Recent sessions</h2>
          {data.sessions.slice(0, 8).map((s) => (
            <div class="drill-item">
              <div class="t">
                <div>
                  {new Date(s.startedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} ·{' '}
                  {s.profile === 'drive' ? 'Drive' : 'Parked'}
                </div>
                <div class="faint">
                  {s.scored} scored · avg {s.scored ? s.avg.toFixed(1) : '–'} · {s.minutes} min
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
