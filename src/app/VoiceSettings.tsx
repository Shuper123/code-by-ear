// Settings for the neural voice (Kokoro) and pacing: drill audio download, on-phone model, voice, speeds.
import { useEffect, useState } from 'preact/hooks'
import { ALL_DRILLS } from '../data/drills'
import { updateSettings, type Settings } from '../settings'
import { ensureNeural, neural, type NeuralStatus } from '../speech/neural'
import { codeLines } from '../speech/phrasing'
import { PACK, packCachedCount, prefetchPack, voice } from '../speech/voice'

export const NEURAL_VOICES: [string, string][] = [
  ['af_heart', 'Heart, US (drill audio is recorded in this voice)'],
  ['af_bella', 'Bella, US'],
  ['af_nicole', 'Nicole, US, soft'],
  ['am_michael', 'Michael, US'],
  ['am_fenrir', 'Fenrir, US'],
  ['am_puck', 'Puck, US'],
  ['bf_emma', 'Emma, UK'],
  ['bm_george', 'George, UK'],
]

const MB = (n: number) => `${Math.round(n / 1e6)} MB`

export function neuralStatusText(st: NeuralStatus): string {
  if (st.state === 'off') return 'Not loaded.'
  if (st.state === 'loading')
    return st.total ? `Downloading ${MB(st.loaded ?? 0)} of ${MB(st.total)}… (only the first time)` : 'Starting…'
  if (st.state === 'error') return `Problem: ${st.error}`
  const speed =
    st.lastGenMs && st.lastGenSeconds
      ? ` Last sentence: ${(st.lastGenMs / 1000).toFixed(1)} s to make ${st.lastGenSeconds.toFixed(1)} s of speech.`
      : ''
  return `Ready (${st.device === 'webgpu' ? 'on the GPU' : 'on the CPU'}, ${st.dtype === 'fp32' ? 'best quality' : 'smaller model'}), loaded in ${((st.loadMs ?? 0) / 1000).toFixed(1)} s.${speed}`
}

function NumberRow(props: {
  label: string
  value: number
  min: number
  max: number
  step: number
  suffix?: string
  zero?: string // what to show instead of 0, such as "off"
  onChange: (v: number) => void
}) {
  return (
    <label class="field">
      <span>
        {props.label}: <strong>{props.value === 0 && props.zero ? props.zero : props.value}</strong>
        {props.value === 0 && props.zero ? '' : (props.suffix ?? '')}
      </span>
      <input type="range" min={props.min} max={props.max} step={props.step} value={props.value}
        onInput={(e) => props.onChange(Number((e.target as HTMLInputElement).value))} />
    </label>
  )
}

export function VoiceSettings({ s }: { s: Settings }) {
  const [st, setSt] = useState<NeuralStatus>(neural.status)
  const [cached, setCached] = useState<number | null>(null)
  const [dl, setDl] = useState<{ done: number; total: number } | null>(null)
  useEffect(() => neural.subscribe(setSt), [])
  useEffect(() => ensureNeural(s), [s.voiceEngine, s.neuralModel])
  useEffect(() => {
    void packCachedCount().then(setCached)
  }, [dl])
  const total = Object.keys(PACK.clips).length
  const packMB = Math.round(Object.values(PACK.clips).reduce((a, ms) => a + ms, 0) / 1000 * 36000 / 8 / 1e6)

  const chooseModel = (m: Settings['neuralModel']) => {
    void updateSettings({ neuralModel: m })
    if (m === 'off') neural.unload()
    else void neural.load(m === 'best' ? 'fp32' : 'q8').catch(() => {})
  }
  const downloadAll = async () => {
    setDl({ done: 0, total })
    await prefetchPack(Object.keys(PACK.clips), PACK.voice, (done, t) => setDl({ done, total: t }))
    setDl(null)
  }
  const test = async () => {
    const d = ALL_DRILLS.find((x) => x.id === 'py-p1-predict-001')!
    const rate = s.rateParked
    await voice.speak('Python. Three lines.', rate)
    for (const line of codeLines(d)) {
      if (s.phrasePauseMs > 0 && line.phrases.length > 1) await voice.speak(line.phrases, rate * s.codeSpeed, undefined, 'phrase', s.phrasePauseMs)
      else await voice.speak(line.text, rate * s.codeSpeed, undefined, 'code')
      await new Promise((r) => setTimeout(r, s.linePauseMs))
    }
    await voice.speak(d.prompt_spoken, rate)
  }

  return (
    <>
      <div class="card">
        <h2>Voice quality</h2>
        <label class="check">
          <input type="radio" name="engine" checked={s.voiceEngine === 'neural'} onChange={() => void updateSettings({ voiceEngine: 'neural' })} />
          <span>Neural voice (Kokoro), natural sounding</span>
        </label>
        <label class="check">
          <input type="radio" name="engine" checked={s.voiceEngine === 'phone'} onChange={() => void updateSettings({ voiceEngine: 'phone' })} />
          <span>The phone's own voice (set below)</span>
        </label>
        {s.voiceEngine === 'neural' && (
          <>
            <label class="field">
              <span>Neural voice</span>
              <select value={s.neuralVoice} onChange={(e) => void updateSettings({ neuralVoice: (e.target as HTMLSelectElement).value })}>
                {NEURAL_VOICES.map(([id, label]) => (
                  <option value={id}>{label}</option>
                ))}
              </select>
            </label>
            {s.neuralVoice !== PACK.voice && (
              <p class="small" style={{ color: 'var(--amber, #d9a400)' }}>
                Drill audio is recorded in Heart. In this voice everything is generated on the phone, so turn on the
                on-phone voice below.
              </p>
            )}
            <p class="small">
              Drill audio: {total} sentences, about {packMB} MB.{' '}
              {cached !== null && `${Math.min(cached, total)} saved on this phone.`} The rest download as you practice.
            </p>
            <button class="btn" disabled={!!dl} onClick={() => void downloadAll()}>
              {dl ? `Downloading ${dl.done} of ${dl.total}…` : 'Download all drill audio now'}
            </button>
            <label class="field" style={{ marginTop: '12px' }}>
              <span>On-phone voice, for sentences that aren't pre-recorded (AI feedback, your own code read back)</span>
              <select value={s.neuralModel} onChange={(e) => chooseModel((e.target as HTMLSelectElement).value as Settings['neuralModel'])}>
                <option value="off">Off: those sentences use the phone's voice</option>
                <option value="best">Best quality: about 330 MB download, uses the GPU</option>
                <option value="small">Smaller: about 90 MB download, a bit less natural</option>
              </select>
            </label>
            {s.neuralModel !== 'off' && <p class="small">{neuralStatusText(st)}</p>}
            {s.neuralModel !== 'off' && st.state !== 'ready' && st.state !== 'loading' && (
              <button class="btn" onClick={() => chooseModel(s.neuralModel)}>
                Load the on-phone voice
              </button>
            )}
          </>
        )}
        <button class="btn" style={{ marginTop: '10px' }} onClick={() => void test()}>
          Test voice and pacing
        </button>
      </div>

      <div class="card">
        <h2>Pacing</h2>
        <NumberRow label="Code speed" value={s.codeSpeed} min={0.6} max={1} step={0.05} suffix=" of normal"
          onChange={(v) => void updateSettings({ codeSpeed: Math.round(v * 100) / 100 })} />
        <NumberRow label="Pause after each line of code" value={s.linePauseMs / 1000} min={0.3} max={2.5} step={0.1} suffix=" s"
          onChange={(v) => void updateSettings({ linePauseMs: Math.round(v * 1000) })} />
        <NumberRow label="Pause inside a line" value={s.phrasePauseMs / 1000} min={0} max={1.5} step={0.05} suffix=" s" zero="off"
          onChange={(v) => void updateSettings({ phrasePauseMs: Math.round(v * 1000) })} />
        <p class="faint">
          Inside a line, the voice pauses after "equals", after "then", at commas, and after a variable that comes back from an
          earlier line: "x equals, 7. Then, x equals, x, plus 3." Set it to off to hear each line straight through.
        </p>
        <label class="check">
          <input type="checkbox" checked={s.codeTwiceDrive} onChange={(e) => void updateSettings({ codeTwiceDrive: (e.target as HTMLInputElement).checked })} />
          <span>In Drive, read the code twice before the question</span>
        </label>
        <p class="faint">Say "repeat line 2" in a drill to hear one line again, or "repeat" for the whole thing.</p>
      </div>
    </>
  )
}
