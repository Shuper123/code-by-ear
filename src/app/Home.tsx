import { useEffect, useState } from 'preact/hooks'
import { ALL_DRILLS } from '../data/drills'
import { UNIT_NAMES } from '../data/types'
import { localDate } from '../engine/dates'
import { dueCount, idbStore } from '../engine/progress'
import { typedQueue } from '../engine/typed'
import { languagesFor } from '../engine/queue'
import { newDrillUnit } from '../engine/unlock'
import { isStandalone, pwa } from '../pwa'
import { warmPythonCache } from '../runtimes/py'
import { ensureNeural } from '../speech/neural'
import { getSettings } from '../settings'
import { useSettings } from '../settings'
import { unlockAudio } from '../speech/cues'
import { ttsSupported } from '../speech/tts'
import type { Profile } from '../storage/db'
import { buildLabel } from '../version'
import { navigate } from './nav'

function UpdateBanner() {
  const [, force] = useState(0)
  useEffect(() => pwa.subscribe(() => force((n) => n + 1)), [])
  if (!pwa.updateReady()) return null
  return (
    <div class="banner">
      <span>A new version is ready.</span>
      <button class="btn primary" onClick={pwa.applyUpdate}>
        Reload
      </button>
    </div>
  )
}

/** Start buttons run inside a tap, which lets the page play audio and speech afterwards. */
function startSession(profile: Profile, focus?: 'build') {
  unlockAudio()
  if (ttsSupported()) {
    const u = new SpeechSynthesisUtterance(' ')
    u.volume = 0
    window.speechSynthesis.speak(u)
  }
  navigate('session', focus ? { profile, focus } : { profile })
}

interface Today {
  due: number
  seen: number
  next: string[]
  /** Build tasks passed by voice, out of how many there are. */
  built: number
  buildTotal: number
  /** Tasks waiting in the typed set. */
  toType: number
}

export function Home() {
  const { settings, hasKey } = useSettings()
  const [today, setToday] = useState<Today | null>(null)
  const standalone = isStandalone()

  useEffect(() => {
    void (async () => {
      const [states, attempts] = await Promise.all([idbStore.loadStates(), idbStore.loadAttempts()])
      const langs = languagesFor(settings.languageMix)
      const buildIds = new Set(ALL_DRILLS.filter((d) => d.type === 'build').map((d) => d.id))
      const built = new Set(attempts.filter((a) => buildIds.has(a.drillId) && a.score >= 2).map((a) => a.drillId)).size
      const drills = ALL_DRILLS.filter((d) => langs.includes(d.lang))
      const seen = new Set([...states.values()].filter((s) => s.reps > 0).map((s) => s.id))
      const next = langs
        .map((l) => newDrillUnit(ALL_DRILLS, l, seen))
        .filter((u): u is string => !!u)
        .map((u) => `${u} ${UNIT_NAMES[u]}`)
      setToday({
        due: dueCount(states, drills, localDate()),
        seen: [...seen].filter((id) => drills.some((d) => d.id === id)).length,
        next,
        built,
        buildTotal: buildIds.size,
        toType: typedQueue(ALL_DRILLS, states, attempts, localDate(), 1000).length,
      })
    })()
  }, [settings.languageMix])

  // Python Sketch needs Pyodide (several megabytes): fetch it in the background so it's cached.
  useEffect(() => {
    if (!hasKey || settings.languageMix === 'sql') return
    const saveData = (navigator as unknown as { connection?: { saveData?: boolean } }).connection?.saveData
    if (saveData) return
    const t = setTimeout(() => void warmPythonCache(), 5000)
    return () => clearTimeout(t)
  }, [hasKey, settings.languageMix])
  useEffect(() => {
    // the on-phone neural voice, if chosen: start loading it in the background (it keeps going if you
    // leave this screen) so sessions can use it
    setTimeout(() => ensureNeural(getSettings()), 1500)
  }, [settings.voiceEngine, settings.neuralModel])

  const mix = settings.languageMix === 'both' ? 'SQL and Python' : settings.languageMix === 'sql' ? 'SQL only' : 'Python only'
  return (
    <div class="page">
      <UpdateBanner />
      <div class="brand">
        <img src={`${import.meta.env.BASE_URL}icons/icon-192.png`} alt="" />
        <div>
          <h1>Code by Ear</h1>
          <div class="sub">Hands-free SQL and Python practice</div>
        </div>
      </div>

      <div class="card">
        <h2>Today</h2>
        {today ? (
          <>
            <p>
              <strong>{today.due}</strong> review{today.due === 1 ? '' : 's'} due · {today.seen} drill{today.seen === 1 ? '' : 's'} seen so far
            </p>
            <p class="muted small">
              {mix}. New drills from {today.next.length ? today.next.join(' and ') : 'any unit (all units mostly seen)'}.
            </p>
            <p class="muted small">
              Build: {today.built} of {today.buildTotal} tasks passed by voice · {today.toType} waiting to be typed
            </p>
          </>
        ) : (
          <p class="muted">Loading…</p>
        )}
      </div>

      <button class="btn primary block big" onClick={() => startSession('drive')}>
        Start Drive
      </button>
      <p class="faint" style={{ margin: '6px 4px 14px' }}>
        {settings.sessionMinutes} minutes, voice only. Press before you pull out.
      </p>
      <button class="btn teal block big" onClick={() => startSession('parked', 'build')}>
        Start Build
      </button>
      <p class="faint" style={{ margin: '6px 4px 14px' }}>
        Write SQL out loud, one clause at a time, and hear what the database returns. Parked for now.
      </p>
      <div class="grid2" style={{ marginBottom: '6px' }}>
        <button class="btn big" onClick={() => startSession('parked')}>
          Start Parked
        </button>
        <button class="btn big" onClick={() => navigate('typed')}>
          Typed set{today?.toType ? ` (${Math.min(today.toType, settings.typedPerSet)})` : ''}
        </button>
      </div>
      <p class="faint" style={{ margin: '6px 4px 14px' }}>
        Parked: drills with code and transcript on screen. Typed: the tasks you built by voice, at the keyboard.
      </p>

      <div class="row" style={{ marginBottom: '14px' }}>
        <button class="btn" onClick={() => navigate('progress')}>
          Progress
        </button>
        <button class="btn" onClick={() => navigate('drills')}>
          Drills
        </button>
        <button class="btn" onClick={() => navigate('settings')}>
          Settings
        </button>
        <button class="btn" onClick={() => navigate('spike')}>
          Voice check
        </button>
      </div>

      <div class="row">
        <span class={`pill ${hasKey ? 'ok' : ''}`}>{hasKey ? 'AI grading on' : 'Self-rating (no API key)'}</span>
        <span class={`pill ${standalone ? 'ok' : 'warn'}`}>{standalone ? 'Installed app' : 'Running in browser'}</span>
      </div>
      {!standalone && <p class="faint">To install: Chrome menu, then Add to Home screen or Install app.</p>}
      <p class="faint">{buildLabel()}</p>
    </div>
  )
}
