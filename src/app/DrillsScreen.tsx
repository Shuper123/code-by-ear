// Drills browser: every drill by language, unit and type; tap one to practice it in a Parked session.
import { useEffect, useMemo, useState } from 'preact/hooks'
import { ALL_DRILLS } from '../data/drills'
import { UNIT_NAMES, UNITS, type Lang } from '../data/types'
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

export function DrillsScreen() {
  const [lang, setLang] = useState<Lang>('sql')
  const [unit, setUnit] = useState('')
  const [type, setType] = useState('')
  const [states, setStates] = useState<Map<string, DrillState>>(new Map())
  useEffect(() => {
    void idbStore.loadStates().then(setStates)
  }, [])

  const list = useMemo(
    () => ALL_DRILLS.filter((d) => d.lang === lang && (!unit || d.unit === unit) && (!type || d.type === type)),
    [lang, unit, type],
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
        <div class="grid2">
          <label class="field">
            <span>Language</span>
            <select value={lang} onChange={(e) => (setLang((e.target as HTMLSelectElement).value as Lang), setUnit(''))}>
              <option value="sql">SQL</option>
              <option value="python">Python</option>
            </select>
          </label>
          <label class="field">
            <span>Unit</span>
            <select value={unit} onChange={(e) => setUnit((e.target as HTMLSelectElement).value)}>
              <option value="">All units</option>
              {UNITS[lang].map((u) => (
                <option value={u}>
                  {u} {UNIT_NAMES[u]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label class="field">
          <span>Type</span>
          <select value={type} onChange={(e) => setType((e.target as HTMLSelectElement).value)}>
            {TYPES.map(([v, l]) => (
              <option value={v}>{l}</option>
            ))}
          </select>
        </label>
        <p class="faint">{list.length} drills. Tap Practice to run one in a Parked session.</p>
      </div>
      <div class="card">
        {list.map((d) => {
          const s = states.get(d.id)
          const playable = SUPPORTED_TYPES.has(d.type)
          return (
            <div class="drill-item">
              <div class="t">
                <div>{d.prompt_spoken}</div>
                <div class="faint">
                  {d.id} · level {d.level}
                  {d.drive_ok ? ' · drive' : ''}
                  {s?.reps ? ` · last ${s.lastScore ?? '–'}/3, due ${s.due}` : ' · new'}
                </div>
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
