// Milestone 0 spike screen: proves the phone's speech stack, tones, wake lock and one AI call
// before the session engine is built on top of them. Also produces a copyable diagnostics report.
import { useEffect, useRef, useState } from 'preact/hooks'
import { AiError, describeAiError, sendMessage } from '../ai/anthropic'
import { isStandalone } from '../pwa'
import { getApiKey, useSettings } from '../settings'
import { audioSupported, CUE_LABELS, playCue, unlockAudio, type CueName } from '../speech/cues'
import {
  describeSttError,
  listen,
  speechRecognitionSupported,
  type ListenHandle,
  type PieceAction,
} from '../speech/stt'
import { chooseVoice, speak, stopSpeaking, ttsSupported, waitForVoices } from '../speech/tts'
import { holdWakeLock, onWakeLockChange, releaseWakeLock, wakeLockState, wakeLockSupported } from '../platform/wakelock'
import { buildLabel } from '../version'
import { neural } from '../speech/neural'
import { voice } from '../speech/voice'
import { ButtonTest, buttonReportLines } from './ButtonTest'
import { neuralStatusText } from './VoiceSettings'
import { goBack } from './nav'

const SAMPLE = {
  id: 'py-p2-predict-007',
  code: 'nums = [3, 1, 2]\nnums.sort()\nprint(nums[0])',
  code_spoken: 'nums equals the list 3, 1, 2. Then nums dot sort. Then print nums at index 0.',
  prompt_spoken: 'What does this print?',
  model_answer_spoken: 'It prints 1. Sorting puts the smallest value first.',
}

interface LogLine {
  t: number
  ev: string
  detail?: string
}

interface LongStats {
  text: string
  pieces: string[]
  restarts: number
  reason: string
  durationMs: number
  gaps: number[]
}

/** Spike-only classifier: "done" ends the answer, "wait" extends it. Full commands come in M1. */
function doneOrWait(piece: string): PieceAction | null {
  const p = piece.trim().toLowerCase().replace(/[.!?,]+$/g, '')
  if (p === 'wait') return { kind: 'extend', ms: 10000 }
  if (p === 'done' || p === "i'm done") return { kind: 'end', keep: '' }
  const m = piece.match(/^(.*?)[\s,.]*\bdone[.!?]*$/i)
  if (m) return { kind: 'end', keep: m[1] }
  return null
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function gapsFrom(lines: LogLine[]): number[] {
  const gaps: number[] = []
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].ev !== 'end') continue
    const next = lines.slice(i + 1).find((l) => l.ev === 'audiostart' || l.ev === 'finish')
    if (next && next.ev === 'audiostart') gaps.push(next.t - lines[i].t)
  }
  return gaps
}

export function Spike() {
  const { settings: s, hasKey } = useSettings()
  const t0 = useRef(Date.now())
  const logRef = useRef<LogLine[]>([])
  const [log, setLog] = useState<LogLine[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [step, setStep] = useState('')
  const [live, setLive] = useState('')
  const [loopResult, setLoopResult] = useState('')
  const [longStats, setLongStats] = useState<LongStats | null>(null)
  const [ai, setAi] = useState('')
  const [wake, setWake] = useState(wakeLockState())
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [reportText, setReportText] = useState('')
  const handleRef = useRef<ListenHandle | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    void waitForVoices(3000).then(setVoices)
    const off = onWakeLockChange(() => setWake(wakeLockState()))
    return () => {
      off()
      abortRef.current?.abort()
      handleRef.current?.abort()
      stopSpeaking()
    }
  }, [])

  const chosen = chooseVoice(voices, s.voiceURI)
  const say = (text: string, signal?: AbortSignal) => speak(text, { rate: s.rateDrive, voiceURI: s.voiceURI }, signal)

  function addLog(ev: string, detail?: string) {
    logRef.current = [...logRef.current.slice(-500), { t: Date.now() - t0.current, ev, detail }]
    setLog(logRef.current)
  }

  function listenOpts(maxMs: number) {
    return {
      silenceMs: s.silenceDriveMs,
      initialWaitMs: s.thinkMs,
      maxMs,
      continuous: s.sttContinuous,
      restartDelayMs: s.restartDelayMs,
      classify: doneOrWait,
      onUpdate: (p: { text: string }) => setLive(p.text),
      log: addLog,
    }
  }

  async function begin(name: string) {
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setBusy(name)
    setLive('')
    unlockAudio()
    await holdWakeLock()
    addLog('test', `begin ${name}`)
    return ctrl
  }

  async function end() {
    addLog('test', 'end')
    abortRef.current = null
    handleRef.current = null
    setBusy(null)
    setStep('')
    await releaseWakeLock()
  }

  function stopAll() {
    abortRef.current?.abort()
    handleRef.current?.abort()
    stopSpeaking()
  }

  async function runLoop() {
    const ctrl = await begin('voice loop')
    setLoopResult('')
    try {
      setStep('Speaking the drill')
      await say(`Here is a practice drill. ${SAMPLE.code_spoken} ${SAMPLE.prompt_spoken}`, ctrl.signal)
      if (ctrl.signal.aborted) return
      setStep('Listening. Answer out loud.')
      await playCue('listening', s.cueVolume)
      const h = listen(listenOpts(45000))
      handleRef.current = h
      const r = await h.result
      handleRef.current = null
      addLog('answer', `${r.reason} "${r.text}" restarts=${r.restarts}`)
      if (ctrl.signal.aborted) return
      await playCue('gotIt', s.cueVolume)
      if (r.error) {
        const msg = describeSttError(r.error)
        setLoopResult(msg)
        await say(msg, ctrl.signal)
        return
      }
      if (!r.text) {
        setLoopResult(`No answer heard (${r.reason}).`)
        await say("I didn't hear an answer.", ctrl.signal)
        return
      }
      const right = /\b(1|one)\b/i.test(r.text)
      setStep('Feedback')
      await say(`I heard: ${r.text}.`, ctrl.signal)
      await playCue(right ? 'correct' : 'incorrect', s.cueVolume)
      await say(right ? 'That is right. It prints 1, because sorting puts the smallest value first.' : SAMPLE.model_answer_spoken, ctrl.signal)
      setLoopResult(
        `${right ? 'Correct' : 'Not matched'} · heard "${r.text}" · ${r.restarts} restart(s) · ${(r.durationMs / 1000).toFixed(1)} s listening · ended by ${r.reason}`,
      )
    } finally {
      await end()
    }
  }

  async function runLong() {
    const ctrl = await begin('long answer')
    setLongStats(null)
    const startT = Date.now() - t0.current
    try {
      setStep('Instructions')
      await say('Talk for about twenty seconds, with a few short pauses. Say done when you finish.', ctrl.signal)
      if (ctrl.signal.aborted) return
      setStep('Listening. Talk with pauses, then say done.')
      await playCue('listening', s.cueVolume)
      const h = listen({ ...listenOpts(70000), initialWaitMs: Math.max(s.thinkMs, 15000) })
      handleRef.current = h
      const r = await h.result
      handleRef.current = null
      await playCue('gotIt', s.cueVolume)
      const stats: LongStats = {
        text: r.text,
        pieces: r.pieces,
        restarts: r.restarts,
        reason: r.error ? `${r.reason} (${r.error})` : r.reason,
        durationMs: r.durationMs,
        gaps: gapsFrom(logRef.current.filter((l) => l.t >= startT)),
      }
      setLongStats(stats)
      addLog('long', `${r.reason} pieces=${r.pieces.length} restarts=${r.restarts}`)
      if (ctrl.signal.aborted) return
      if (r.error) await say(describeSttError(r.error), ctrl.signal)
      else if (r.text) await say(`I heard ${r.pieces.length} pieces. Here they are joined. ${r.text}`, ctrl.signal)
      else await say("I didn't hear anything.", ctrl.signal)
    } finally {
      await end()
    }
  }

  async function playAllTones() {
    unlockAudio()
    for (const c of Object.keys(CUE_LABELS) as CueName[]) {
      setStep(`Tone: ${CUE_LABELS[c]}`)
      await playCue(c, s.cueVolume)
      await sleep(450)
    }
    setStep('')
  }

  async function testAi() {
    setAi('Calling the API…')
    addLog('ai', 'call')
    try {
      const r = await sendMessage(
        { apiKey: getApiKey(), workspaceId: s.workspaceId },
        { model: s.model, maxTokens: 16, system: 'Reply with the single word: ready', user: 'Are you there?', cacheSystem: true },
      )
      const msg = `OK · ${r.model} replied "${r.text.trim()}" in ${(r.latencyMs / 1000).toFixed(1)} s (attempts: ${r.attempts})`
      setAi(msg)
      addLog('ai', msg)
    } catch (e) {
      const detail = e instanceof AiError ? `${e.kind}${e.status ? ` HTTP ${e.status}` : ''}: ${e.message}` : String(e)
      setAi(`${describeAiError(e)} [${detail}]`)
      addLog('ai', `error ${detail}`)
    }
  }

  function buildReport(): string {
    return [
      'Code by Ear · M0 spike report',
      `Build: ${buildLabel()}`,
      `When: ${new Date().toISOString()}`,
      `Device: ${navigator.userAgent}`,
      `Installed app: ${isStandalone()} · online: ${navigator.onLine}`,
      `SpeechRecognition: ${speechRecognitionSupported()} · speechSynthesis: ${ttsSupported()} (${voices.length} voices)`,
      `Voice: ${chosen ? `${chosen.name} ${chosen.lang} local=${chosen.localService}` : 'none'}`,
      `WakeLock: ${wakeLockSupported()} · AudioContext: ${audioSupported()}`,
      `Settings: continuous=${s.sttContinuous} restartDelay=${s.restartDelayMs}ms silenceDrive=${s.silenceDriveMs}ms think=${s.thinkMs}ms rate=${s.rateDrive}`,
      `Voice loop: ${loopResult || 'not run'}`,
      `Long answer: ${longStats ? JSON.stringify(longStats) : 'not run'}`,
      `AI call: ${ai || 'not run'} · key saved: ${hasKey}`,
      `Voice: ${s.voiceEngine} (${s.neuralVoice}), on-phone model ${s.neuralModel}: ${neuralStatusText(neural.status)}`,
      `Voice: last utterance used ${voice.lastEngine ?? 'nothing yet'}; last voice error: ${voice.lastError ?? 'none'}`,
      `Pacing: code speed ${s.codeSpeed}, line pause ${s.linePauseMs} ms, phrase pause ${s.phrasePauseMs} ms, code twice in Drive ${s.codeTwiceDrive}`,
      `Buttons setting: ${s.mediaButtons}`,
      ...buttonReportLines(),
      '--- event log (ms since screen opened) ---',
      ...logRef.current.map((l) => `+${l.t} ${l.ev}${l.detail ? ` ${l.detail}` : ''}`),
    ].join('\n')
  }

  async function copyReport() {
    const text = buildReport()
    setReportText(text)
    try {
      await navigator.clipboard.writeText(text)
      setStep('Report copied to the clipboard')
    } catch {
      setStep('Copy failed; select the text below and copy it')
    }
  }

  const gapsSummary = (g: number[]) =>
    g.length ? `${g.length} gaps · min ${Math.min(...g)} ms · avg ${Math.round(g.reduce((a, b) => a + b, 0) / g.length)} ms · max ${Math.max(...g)} ms` : 'no restarts'

  return (
    <div class="page">
      <div class="topbar">
        <button class="back" onClick={goBack}>
          ← Back
        </button>
        <h1>Voice spike</h1>
      </div>

      <div class="card">
        <dl class="status-list">
          <dt>Speech in</dt>
          <dd>{speechRecognitionSupported() ? <span class="pill ok">supported</span> : <span class="pill bad">missing</span>}</dd>
          <dt>Speech out</dt>
          <dd>
            {ttsSupported() ? <span class="pill ok">{voices.length} voices</span> : <span class="pill bad">missing</span>}{' '}
            <span class="faint">{chosen ? `${chosen.name} (${chosen.lang})` : ''}</span>
          </dd>
          <dt>Wake Lock</dt>
          <dd>
            <span class={`pill ${wake === 'held' ? 'ok' : wake === 'unsupported' ? 'bad' : ''}`}>{wake}</span>
          </dd>
          <dt>Network</dt>
          <dd>
            <span class={`pill ${navigator.onLine ? 'ok' : 'bad'}`}>{navigator.onLine ? 'online' : 'offline'}</span>
          </dd>
        </dl>
      </div>

      {(busy || step) && (
        <div class="card">
          <div class="step">{busy ? `Running: ${busy}` : 'Status'}</div>
          <p>{step}</p>
          {busy && (
            <div class="transcript" aria-live="polite">
              {live || <span class="interim">…</span>}
            </div>
          )}
          {busy && (
            <div class="row" style={{ marginTop: '10px' }}>
              <button class="btn" onClick={() => handleRef.current?.stop()}>
                Done talking
              </button>
              <button class="btn danger" onClick={stopAll}>
                Stop test
              </button>
            </div>
          )}
        </div>
      )}

      <div class="card">
        <h2>1. Voice loop</h2>
        <p class="muted small">
          Speaks a drill, beeps, listens, then reads back what it heard and plays a result tone. Answer out loud after the
          beep. Try it at home first, then in the car over Bluetooth.
        </p>
        <div class="code">{SAMPLE.code}</div>
        <button class="btn primary block big" style={{ marginTop: '12px' }} disabled={!!busy} onClick={() => void runLoop()}>
          Run voice loop
        </button>
        {loopResult && <p class="small">{loopResult}</p>}
      </div>

      <div class="card">
        <h2>2. Long answer across pauses</h2>
        <p class="muted small">
          Talk for about 20 seconds with a few pauses, then say "done". Chrome restarts the recognizer after each pause;
          this shows whether the pieces join up and how long each restart gap is.
        </p>
        <button class="btn teal block" disabled={!!busy} onClick={() => void runLong()}>
          Start long answer test
        </button>
        {longStats && (
          <div class="small" style={{ marginTop: '10px' }}>
            <p>
              <strong>Heard:</strong> {longStats.text || '(nothing)'}
            </p>
            <p class="muted">
              {longStats.pieces.length} pieces · {longStats.restarts} restarts · {(longStats.durationMs / 1000).toFixed(1)} s · ended by{' '}
              {longStats.reason}
            </p>
            <p class="muted">Restart gaps: {gapsSummary(longStats.gaps)}</p>
          </div>
        )}
      </div>

      <div class="card">
        <h2>3. Tones</h2>
        <div class="row">
          {(Object.keys(CUE_LABELS) as CueName[]).map((c) => (
            <button class="btn" onClick={() => void playCue(c, s.cueVolume)}>
              {CUE_LABELS[c]}
            </button>
          ))}
        </div>
        <button class="btn block" style={{ marginTop: '10px' }} onClick={() => void playAllTones()}>
          Play all in order
        </button>
      </div>

      <div class="card">
        <h2>4. Speech and screen</h2>
        <div class="row">
          <button class="btn" onClick={() => void say(`${SAMPLE.code_spoken} ${SAMPLE.prompt_spoken}`)}>
            Speak sample drill
          </button>
          <button
            class="btn"
            onClick={() => (wake === 'held' ? void releaseWakeLock() : void holdWakeLock())}
            disabled={wake === 'unsupported'}
          >
            {wake === 'held' ? 'Release Wake Lock' : 'Hold Wake Lock'}
          </button>
        </div>
        <p class="faint">Voice and speed are in Settings. With the Wake Lock held, the screen should stay on.</p>
      </div>

      <div class="card">
        <h2>5. One AI call</h2>
        <p class="muted small">Sends a tiny request to {s.model} with the key saved in Settings.</p>
        <button class="btn block" disabled={!hasKey} onClick={() => void testAi()}>
          {hasKey ? 'Make test AI call' : 'Add an API key in Settings first'}
        </button>
        {ai && <p class="small">{ai}</p>}
      </div>

      <ButtonTest />

      <div class="card">
        <h2>Diagnostics</h2>
        <p class="muted small">Copy this report and paste it into the build chat so the next fix is based on what your phone did.</p>
        <div class="row">
          <button class="btn" onClick={() => void copyReport()}>
            Copy report
          </button>
          <button
            class="btn"
            onClick={() => {
              logRef.current = []
              setLog([])
            }}
          >
            Clear log
          </button>
        </div>
        {reportText && <textarea readOnly value={reportText} style={{ marginTop: '10px' }} />}
        <div class="log" style={{ marginTop: '10px' }}>
          {log.length === 0 ? 'No events yet.' : log.map((l) => `+${l.t} ${l.ev}${l.detail ? ` ${l.detail}` : ''}`).join('\n')}
        </div>
      </div>
    </div>
  )
}
