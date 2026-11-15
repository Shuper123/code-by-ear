// Session screen. Drive: dark, one full-screen Pause target, no code shown. Parked: code,
// transcript and results shown, with buttons for the common commands.
import { useEffect, useRef, useState } from 'preact/hooks'
import { ALL_DRILLS } from '../data/drills'
import { LEVEL_NAMES, UNIT_NAMES } from '../data/types'
import { localDate } from '../engine/dates'
import { idbStore } from '../engine/progress'
import { SessionEngine, type EngineDeps, type EngineView } from '../engine/session'
import { mediaButtons } from '../platform/mediaButtons'
import { holdWakeLock, releaseWakeLock } from '../platform/wakelock'
import { getSettings, updateSettings } from '../settings'
import type { Command } from '../speech/commands'
import { playCue } from '../speech/cues'
import { listen } from '../speech/stt'
import { ensureNeural } from '../speech/neural'
import { prefetchDrills, voice } from '../speech/voice'
import type { Profile } from '../storage/db'
import { AiServices } from '../ai/services'
import { makeDictateHook } from '../engine/dictate'
import { classifySqlError, makeSketchHook, type Runners } from '../engine/sketch'
import { checkPythonSyntax, loadPython, pythonState, runPythonTests } from '../runtimes/py'
import { runSql } from '../runtimes/sql'
import { goBack, navigate } from './nav'
import { EditorView } from './EditorView'
import { VerbalCheatSheet } from './VerbalCheatSheet'

/** Drill types this build can run in sessions. */
export const SUPPORTED_TYPES: ReadonlySet<string> = new Set(['predict', 'explain', 'spot_bug', 'plan', 'concept', 'sketch', 'dictate'])

export const runners: Runners = {
  runSql: (dataset, sql) => runSql(dataset, sql),
  runPyTests: (code, fn, tests) => runPythonTests(code, fn, tests),
  pythonReady: () => pythonState() === 'ready',
  preloadPython: () => void loadPython().catch(() => {}),
  loadPython: () => loadPython(),
  checkSyntax: async (lang, dataset, code) => {
    if (lang === 'python') return checkPythonSyntax(code)
    const r = await runSql(dataset, code)
    return r.ok ? { status: 'ok' } : classifySqlError(r.error)
  },
}

const TYPE_LABEL: Record<string, string> = {
  predict: 'Predict',
  explain: 'Explain',
  spot_bug: 'Spot the bug',
  plan: 'Plan',
  concept: 'Concept',
  sketch: 'Sketch',
  dictate: 'Dictate',
}

function mmss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function phaseLabel(v: EngineView): string {
  if (v.paused) return v.pauseReason === 'break' ? 'Break' : 'Paused'
  switch (v.phase) {
    case 'starting':
      return 'Starting'
    case 'speaking':
      return 'Speaking'
    case 'listening':
      return 'Listening'
    case 'grading':
      return 'Checking'
    case 'recap':
      return 'Recap'
    case 'ended':
      return 'Done'
    default:
      return ''
  }
}

export function SessionScreen({ profile, drillId }: { profile: Profile; drillId?: string }) {
  const [view, setView] = useState<EngineView | null>(null)
  const [now, setNow] = useState(Date.now())
  const engineRef = useRef<SessionEngine | null>(null)
  const startRef = useRef(Date.now())

  useEffect(() => {
    const s = getSettings()
    const ai = new AiServices()
    const deps: EngineDeps = {
      speak: (text, rate, signal, style) => voice.speak(text, rate, signal, style),
      sleep: (ms, signal) =>
        new Promise<void>((resolve) => {
          const t = setTimeout(resolve, ms)
          signal.addEventListener('abort', () => (clearTimeout(t), resolve()), { once: true })
        }),
      onQueue: (drills) => void prefetchDrills(drills),
      stopSpeaking: () => voice.stop(),
      listen,
      cue: (name) => playCue(name, s.cueVolume),
      now: () => Date.now(),
      today: () => localDate(),
      store: idbStore,
      grader: ai,
      typeHooks: { sketch: makeSketchHook(ai, runners), dictate: makeDictateHook(ai, runners, { startMode: () => getSettings().dictateMode }) },
      onRateChange: (p, rate) => void updateSettings(p === 'drive' ? { rateDrive: rate } : { rateParked: rate }),
      supportedTypes: SUPPORTED_TYPES,
    }
    const engine = new SessionEngine(
      { profile, settings: s, drills: ALL_DRILLS, only: drillId ? [drillId] : undefined },
      deps,
    )
    engineRef.current = engine
    startRef.current = Date.now()
    const unsub = engine.subscribe(setView)
    let unsubButtons = () => {}
    if (s.mediaButtons) {
      void mediaButtons.start(
        {
          togglePause: () => engine.togglePause(),
          skip: () => engine.injectCommand('skip'),
          repeat: () => engine.injectCommand('repeat'),
        },
        'Code by Ear',
        profile === 'drive' ? 'Drive session' : 'Parked session',
      )
      let wasPaused = false
      unsubButtons = engine.subscribe((v) => {
        if (v.paused !== wasPaused) mediaButtons.setPaused((wasPaused = v.paused))
        if (v.phase === 'recap' || v.phase === 'ended') mediaButtons.stop()
      })
    }
    ensureNeural(s)
    void holdWakeLock()
    const onVis = () => {
      if (document.visibilityState === 'hidden') engine.requestPause('hidden')
      else engine.onVisible()
    }
    document.addEventListener('visibilitychange', onVis)
    const tick = setInterval(() => setNow(Date.now()), 1000)
    void engine.run().finally(() => void releaseWakeLock())
    return () => {
      clearInterval(tick)
      document.removeEventListener('visibilitychange', onVis)
      unsub()
      unsubButtons()
      if (s.mediaButtons) mediaButtons.stop()
      engine.quit()
      voice.stop()
      void releaseWakeLock()
    }
  }, [profile, drillId])

  const engine = engineRef.current
  if (!view || !engine) return <div class="drive">Starting…</div>
  const elapsed = now - startRef.current
  const cmd = (c: Command) => engine.injectCommand(c)

  if (view.phase === 'ended' || view.phase === 'recap') {
    return (
      <div class="page">
        <div class="topbar">
          <h1>{view.phase === 'recap' ? 'Recap' : 'Session done'}</h1>
        </div>
        <div class="card">
          <p style={{ fontSize: '1.1rem' }}>{view.recap}</p>
          <p class="muted small">
            {view.scored} scored · {view.done} drill{view.done === 1 ? '' : 's'} · {mmss(elapsed)}
          </p>
        </div>
        <div class="grid2">
          <button class="btn primary big" onClick={goBack}>
            Home
          </button>
          <button class="btn big" onClick={() => navigate('progress')}>
            Progress
          </button>
        </div>
      </div>
    )
  }

  if (profile === 'drive') {
    const dot = view.paused ? '' : view.phase === 'listening' ? 'listening' : view.phase === 'speaking' ? 'speaking' : ''
    const hint = view.paused
      ? 'Tap anywhere, or say continue'
      : view.phase === 'listening'
        ? 'Answer out loud'
        : 'Tap anywhere to pause'
    return (
      <>
        <button
          class={`drive ${view.paused ? 'paused' : ''}`}
          onClick={() => engine.togglePause()}
          aria-label={view.paused ? 'Resume session' : 'Pause session'}
        >
          <div class={`dot ${dot}`} />
          <div class="state">{phaseLabel(view)}</div>
          <div class="hint">{hint}</div>
          <div class="meta">
            {view.done} drill{view.done === 1 ? '' : 's'} · {mmss(elapsed)}
          </div>
        </button>
        {view.paused && (
          <div style={{ position: 'fixed', top: 'calc(env(safe-area-inset-top) + 16px)', right: '16px', zIndex: 10 }}>
            <button class="btn danger" onClick={() => engine.requestStop()}>
              End session
            </button>
          </div>
        )}
      </>
    )
  }

  // Parked
  const d = view.drill
  return (
    <div class="page">
      <div class="topbar">
        <h1>Parked · {mmss(elapsed)}</h1>
        <button class="btn" onClick={() => engine.togglePause()}>
          {view.paused ? 'Resume' : 'Pause'}
        </button>
        <button class="btn danger" onClick={() => engine.requestStop()}>
          End
        </button>
      </div>
      <div class="row" style={{ marginBottom: '10px' }}>
        <span class={`pill ${view.paused ? 'warn' : view.phase === 'listening' ? 'ok' : ''}`}>{phaseLabel(view)}</span>
        <span class="pill">
          {view.done} done · avg {view.scored ? (view.scoreSum / view.scored).toFixed(1) : '–'}
        </span>
        {view.lastScore !== null && <span class={`pill score-${view.lastScore}`}>last: {view.lastScore}/3</span>}
      </div>
      {d && (
        <div class="card">
          <div class="step">
            {d.lang === 'sql' ? 'SQL' : 'Python'} · {UNIT_NAMES[d.unit]} · {TYPE_LABEL[d.type]}
            {TYPE_LABEL[d.type] === LEVEL_NAMES[d.level] ? ` · Level ${d.level}` : ` · Level ${d.level} ${LEVEL_NAMES[d.level]}`}
          </div>
          {d.code && (
            <div class="code" style={{ marginTop: '8px' }}>
              {d.code}
            </div>
          )}
          <p style={{ fontSize: '1.05rem' }}>{d.prompt_spoken}</p>
        </div>
      )}
      {view.detail.editor && d && <EditorView ed={view.detail.editor} lang={d.lang} />}
      <div class="card">
        <div class="step">You</div>
        <div class="transcript">
          {view.phase === 'listening' || d?.type === 'dictate' ? view.heard || '…' : view.lastAnswer || view.heard || '…'}
        </div>
        {view.phase === 'listening' && /Say go to run it, or redo\.$/.test(view.said) && (
          <div class="row" style={{ marginTop: '10px' }}>
            <button class="btn primary" onClick={() => cmd('go')}>
              Go
            </button>
            <button class="btn" onClick={() => cmd('redo')}>
              Redo
            </button>
          </div>
        )}
        {d?.type === 'dictate' && (
          <div class="row" style={{ marginTop: '10px' }}>
            <button class="btn primary" disabled={view.phase !== 'listening'} onClick={() => engine.injectText('run it')}>
              Run it
            </button>
            <button class="btn" disabled={view.phase !== 'listening'} onClick={() => engine.injectText('check')}>
              Check
            </button>
            <button class="btn" disabled={view.phase !== 'listening'} onClick={() => engine.injectText('scratch that')}>
              Undo
            </button>
            <button class="btn" disabled={view.phase !== 'listening'} onClick={() => engine.injectText('read it back')}>
              Read it back
            </button>
            <button class="btn" disabled={view.phase !== 'listening'}
              onClick={() => engine.injectText(view.detail.editor?.mode === 'keys' ? 'code mode' : 'keys mode')}>
              {view.detail.editor?.mode === 'keys' ? 'Code mode' : 'Keys mode'}
            </button>
          </div>
        )}
        <div class="row" style={{ marginTop: '10px' }}>
          <button class="btn teal" disabled={view.phase !== 'listening'} onClick={() => engine.finishAnswer()}>
            Done talking
          </button>
          <button class="btn" disabled={view.phase !== 'listening'} onClick={() => cmd('repeat')}>
            Repeat
          </button>
          <button class="btn" disabled={view.phase !== 'listening'} onClick={() => cmd('hint')}>
            Hint
          </button>
          <button class="btn" disabled={view.phase !== 'listening'} onClick={() => cmd('skip')}>
            Skip
          </button>
          <button class="btn" disabled={view.phase !== 'listening'} onClick={() => cmd('idk')}>
            I don't know
          </button>
        </div>
      </div>
      {view.detail.code && !view.detail.editor && (
        <div class="card">
          <div class="step">{d?.type === 'dictate' ? 'Your code' : 'Your code, converted'}</div>
          <div class="code" style={{ marginTop: '8px' }}>
            {view.detail.code}
          </div>
          {view.detail.note && <p class="small">{view.detail.note}</p>}
        </div>
      )}
      {d?.type === 'dictate' && <VerbalCheatSheet lang={d.lang} />}
      <div class="card">
        <div class="step">App</div>
        <p>{view.said}</p>
        {view.error && <p class="small" style={{ color: 'var(--red)' }}>{view.error}</p>}
      </div>
    </div>
  )
}
