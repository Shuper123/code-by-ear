// Progress: mastery by unit and level (average of the last 10 scores), due counts, streak, ladders,
// recent sessions, and backup (export and import).
import { useEffect, useState } from 'preact/hooks'
import { ALL_DRILLS } from '../data/drills'
import { LEVEL_NAMES, UNIT_NAMES, UNITS, type Lang } from '../data/types'
import { addDays, localDate } from '../engine/dates'
import { dueCount, idbStore, mastery } from '../engine/progress'
import { ladderProgress, practiceStreak, recentSummary, totalMinutes, weakestUnits, type LadderRow } from '../engine/stats'
import { typedId, typedStats } from '../engine/typed'
import type { Attempt, DrillState, SessionRecord } from '../storage/db'
import { db } from '../storage/db'
import { BackupCard } from './BackupCard'
import { goBack, navigate } from './nav'

interface Data {
  states: Map<string, DrillState>
  attempts: Attempt[]
  sessions: SessionRecord[]
}

function fmt(avg: number | null): string {
  return avg === null ? '–' : avg.toFixed(1)
}

function hours(min: number): string {
  return min < 60 ? `${min} min` : `${(min / 60).toFixed(1)} hours`
}

function StepCell({ score }: { score: number | null }) {
  return <td class={score === null ? 'muted' : `score-${score}`}>{score === null ? '–' : score}</td>
}

function LadderTable({ rows }: { rows: LadderRow[] }) {
  return (
    <table class="unit-table">
      <thead>
        <tr>
          <th>Problem</th>
          <th>Plan</th>
          <th>Sketch</th>
          <th>Dictate</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td>
              <span class="ladder-title">
                <span class="faint">{r.unit}</span> {r.isFunction ? <code>{r.title}</code> : r.title}
              </span>
            </td>
            <StepCell score={r.plan} />
            <StepCell score={r.sketch} />
            <StepCell score={r.dictate} />
          </tr>
        ))}
      </tbody>
    </table>
  )
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
  const streak = practiceStreak(data.attempts, today)
  const week = recentSummary(data.attempts, today, 7)
  const weak = weakestUnits(data.attempts, [...UNITS.sql, ...UNITS.python])
  const ladderRows = ladderProgress(ALL_DRILLS, data.attempts)
  const laddersStarted = ladderRows.filter((r) => r.plan !== null || r.sketch !== null || r.dictate !== null).length
  const levels = [1, 2, 3]
  const typed = typedStats(ALL_DRILLS, data.states, data.attempts, today)
  const pct = (x: { n: number; firstTry: number }) => (x.n ? `${Math.round((100 * x.firstTry) / x.n)}%` : '–')
  const best = new Map<string, number>()
  for (const a of data.attempts) best.set(a.drillId, Math.max(best.get(a.drillId) ?? -1, a.score))
  const buildTasks = ALL_DRILLS.filter((d) => d.type === 'build')
  const builtCount = buildTasks.filter((d) => (best.get(d.id) ?? -1) >= 2).length
  const table = (lang: Lang) => (
    <table class="unit-table">
      <thead>
        <tr>
          <th>Unit</th>
          {levels.map((l) => (
            <th>{l === 2 && lang === 'sql' ? 'Sketch, Build' : LEVEL_NAMES[l]}</th>
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
          <strong>{dueCount(data.states, ALL_DRILLS, addDays(today, 1))}</strong> by tomorrow
        </p>
        <p>
          Streak: <strong>{streak}</strong> {streak === 1 ? 'day' : 'days'} · Last 7 days: <strong>{week.n}</strong> answers
          {week.avg !== null && <>, average {week.avg.toFixed(1)}</>}
        </p>
        <p class="muted">
          All time: {data.attempts.length} answers in {data.sessions.length} sessions, {hours(totalMinutes(data.sessions))}
        </p>
        {weak.length > 0 && (
          <p>
            Needs work: {weak.map((w, i) => `${i ? ', ' : ''}${w.unit} ${UNIT_NAMES[w.unit]} ${w.avg.toFixed(1)}`).join('')}
          </p>
        )}
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
      <div class="card">
        <h2>Build and typed</h2>
        <p>
          Built by voice: <strong>{builtCount}</strong> of {buildTasks.length} tasks
        </p>
        <p>
          Typed, first try: <strong>{pct(typed.recent)}</strong> of the last {typed.recent.n || 20}
          {typed.allTime.n > typed.recent.n && <> · {pct(typed.allTime)} of all {typed.allTime.n}</>}
        </p>
        <p class="faint">
          The typed first-try rate is the scoreboard: it says whether what you build by voice comes out of your hands too.{' '}
          {typed.waiting} waiting to be typed.
        </p>
        <button class="btn" onClick={() => navigate('typed')}>
          Typed set
        </button>
        <table class="unit-table" style={{ marginTop: '12px' }}>
          <thead>
            <tr>
              <th>Task</th>
              <th>Voice</th>
              <th>Typed</th>
            </tr>
          </thead>
          <tbody>
            {buildTasks.map((d) => (
              <tr key={d.id}>
                <td>
                  <span class="ladder-title">
                    <span class="faint">{d.unit}</span> {(d.pattern ?? d.id).replace(/-/g, ' ')}
                  </span>
                </td>
                <StepCell score={best.has(d.id) ? best.get(d.id)! : null} />
                <StepCell score={best.has(typedId(d.id)) ? best.get(typedId(d.id))! : null} />
              </tr>
            ))}
          </tbody>
        </table>
        <p class="faint">Best score out of 3. Voice: 3 is a match with no hints. Typed: 3 is a match on the first Run.</p>
      </div>
      <div class="card">
        <h2>Ladders</h2>
        <p class="faint">
          Best score on each step, out of 3. {laddersStarted} of {ladderRows.length} started. Sketch opens after a Plan of
          2 or more and a Level 1 unit average of 2.0; Dictate (Parked only) after Sketch passes. Drills plays any step now.
        </p>
        <h3>SQL</h3>
        <LadderTable rows={ladderRows.filter((r) => r.lang === 'sql')} />
        <h3>Python</h3>
        <LadderTable rows={ladderRows.filter((r) => r.lang === 'python')} />
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
      <BackupCard />
    </div>
  )
}
