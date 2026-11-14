// Drills browser: every drill by language, unit, type and status, with search; tap a drill to see its code,
// tap Practice to run it in a Parked session. Filters survive going to a session and back.
import { useEffect, useMemo, useState } from 'preact/hooks'
import { ALL_DRILLS } from '../data/drills'
import { UNIT_NAMES, UNITS, type Drill, type Lang } from '../data/types'
import { localDate } from '../engine/dates'
import { idbStore } from '../engine/progress'
import { unlockAudio } from '../speech/cues'
import type { DrillState } from '../storage/db'
import { goBack, navigate } from './nav'
import { SUPPORTED_TYPES } from './SessionScreen'

const TYPES: [string, string][] = [
  ['', 'All types'],
  ['predict', 'Predict'],
  ['explain', 'Explain'],
  ['spot_bug', 'Spot the bug'],
  ['plan', 'Plan'],
  ['concept', 'Concept'],
  ['sketch', 'Sketch'],
  ['dictate', 'Dictate'],
]
const TYPE_NAME = Object.fromEntries(TYPES.slice(1))

const STATUSES: [Status, string][] = [
  ['', 'Any status'],
  ['new', 'New'],
  ['due', 'Due now'],
  ['weak', 'Last score 0 or 1'],
  ['seen', 'Seen'],
]
type Status = '' | 'new' | 'due' | 'weak' | 'seen'

interface Filters {
  lang: Lang
  unit: string
  type: string
  status: Status
  q: string
}
// kept in memory so coming back from a practice session shows the same list
let saved: Filters = { lang: 'sql', unit: '', type: '', status: '', q: '' }

function matchesStatus(s: DrillState | undefined, status: Status, today: string): boolean {
  switch (status) {
    case 'new':
      return !s?.reps
    case 'due':
      return !!s?.reps && s.due <= today
    case 'weak':
      return !!s?.reps && (s.lastScore ?? 3) <= 1
    case 'seen':
      return !!s?.reps
    default:
      return true
  }
}

function matchesText(d: Drill, q: string): boolean {
  if (!q) return true
  const hay = `${d.id} ${d.prompt_spoken} ${(d.topics ?? []).join(' ')} ${d.function_name ?? ''}`.toLowerCase()
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w))
}

export function DrillsScreen() {
  const [f, setF] = useState<Filters>(saved)
  const [open, setOpen] = useState<string | null>(null)
  const [states, setStates] = useState<Map<string, DrillState>>(new Map())
  useEffect(() => {
    void idbStore.loadStates().then(setStates)
  }, [])
  const set = (patch: Partial<Filters>) => {
    saved = { ...f, ...patch }
    setF(saved)
  }
  const today = localDate()

  const list = useMemo(
    () =>
      ALL_DRILLS.filter(
        (d) =>
          d.lang === f.lang &&
          (!f.unit || d.unit === f.unit) &&
          (!f.type || d.type === f.type) &&
          matchesStatus(states.get(d.id), f.status, today) &&
          matchesText(d, f.q.trim()),
      ),
    [f, states, today],
  )

  const practice = (id: string) => {
    unlockAudio()
    navigate('session', { profile: 'parked', drill: id })
  }

  return (
    <div class="page">
      <div class="topbar">
        <button class="back" onClick={goBack}>
          ← Back
        </button>
        <h1>Drills</h1>
      </div>
      <div class="card">
        <div class="filters">
          <label class="field">
            <span>Language</span>
            <select value={f.lang} onChange={(e) => set({ lang: (e.target as HTMLSelectElement).value as Lang, unit: '' })}>
              <option value="sql">SQL</option>
              <option value="python">Python</option>
            </select>
          </label>
          <label class="field">
            <span>Unit</span>
            <select value={f.unit} onChange={(e) => set({ unit: (e.target as HTMLSelectElement).value })}>
              <option value="">All units</option>
              {UNITS[f.lang].map((u) => (
                <option value={u}>
                  {u} {UNIT_NAMES[u]}
                </option>
              ))}
            </select>
          </label>
          <label class="field">
            <span>Type</span>
            <select value={f.type} onChange={(e) => set({ type: (e.target as HTMLSelectElement).value })}>
              {TYPES.map(([v, l]) => (
                <option value={v}>{l}</option>
              ))}
            </select>
          </label>
          <label class="field">
            <span>Status</span>
            <select value={f.status} onChange={(e) => set({ status: (e.target as HTMLSelectElement).value as Status })}>
              {STATUSES.map(([v, l]) => (
                <option value={v}>{l}</option>
              ))}
            </select>
          </label>
        </div>
        <label class="field">
          <span>Search</span>
          <input
            type="search"
            placeholder="words, topic or drill ID"
            value={f.q}
            onInput={(e) => set({ q: (e.target as HTMLInputElement).value })}
          />
        </label>
        <p class="faint">
          {list.length} {list.length === 1 ? 'drill' : 'drills'}. Tap a drill to see its code; Practice runs it in a Parked
          session, whatever its lock.
        </p>
      </div>
      <div class="card">
        {list.length === 0 && <p class="muted">No drills match.</p>}
        {list.map((d) => {
          const s = states.get(d.id)
          const playable = SUPPORTED_TYPES.has(d.type)
          const isOpen = open === d.id
          const due = !!s?.reps && s.due <= today
          return (
            <div class="drill-item" key={d.id}>
              <div class={`t${isOpen ? ' open' : ''}`} onClick={() => setOpen(isOpen ? null : d.id)} style={{ cursor: 'pointer' }}>
                <div>{d.prompt_spoken}</div>
                <div class="faint">
                  {d.id} · {TYPE_NAME[d.type] ?? d.type} · level {d.level}
                  {d.drive_ok ? ' · Drive' : ' · Parked only'}
                  {s?.reps ? ` · last ${s.lastScore ?? '–'}/3` : ' · new'}
                  {due ? ' · due' : s?.reps ? ` · next ${s.due}` : ''}
                </div>
                {isOpen && (
                  <div style={{ marginTop: '8px' }}>
                    {d.code && <div class="code">{d.code}</div>}
                    {d.signature && <div class="code">{d.signature}</div>}
                    <p class="faint">
                      {UNIT_NAMES[d.unit]}
                      {d.topics?.length ? ` · ${d.topics.join(', ')}` : ''}
                      {d.dataset ? ` · ${d.dataset} data` : ''}
                    </p>
                  </div>
                )}
              </div>
              <button class="btn" disabled={!playable} onClick={() => practice(d.id)}>
                {playable ? 'Practice' : 'Soon'}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
