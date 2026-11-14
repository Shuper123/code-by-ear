import { useEffect, useState } from 'preact/hooks'
import { describeAiError, sendMessage } from '../ai/anthropic'
import { getApiKey, MODELS, resetSettings, setApiKey, updateSettings, useSettings, type Settings } from '../settings'
import { chooseVoice, speak, waitForVoices } from '../speech/tts'
import { buildLabel } from '../version'
import { goBack } from './nav'

function NumberField(props: {
  label: string
  value: number
  min: number
  max: number
  step: number
  suffix?: string
  onChange: (v: number) => void
}) {
  return (
    <label class="field">
      <span>
        {props.label}: <strong>{props.value}</strong>
        {props.suffix ?? ''}
      </span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onInput={(e) => props.onChange(Number((e.target as HTMLInputElement).value))}
      />
    </label>
  )
}

export function SettingsScreen() {
  const { settings: s, hasKey } = useSettings()
  const [keyDraft, setKeyDraft] = useState('')
  const [keyMsg, setKeyMsg] = useState('')
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    void waitForVoices(3000).then(setVoices)
  }, [])

  const set = (patch: Partial<Settings>) => void updateSettings(patch)
  const english = voices.filter((v) => v.lang?.toLowerCase().startsWith('en'))
  const others = voices.filter((v) => !v.lang?.toLowerCase().startsWith('en'))
  const chosen = chooseVoice(voices, s.voiceURI)

  const saveKey = async () => {
    const k = keyDraft.trim()
    if (!k) return
    await setApiKey(k)
    setKeyDraft('')
    setKeyMsg('Saved on this phone.')
  }

  const testKey = async () => {
    setTesting(true)
    setKeyMsg('Testing…')
    try {
      const r = await sendMessage(
        { apiKey: getApiKey(), workspaceId: s.workspaceId },
        { model: s.model, maxTokens: 16, system: 'Reply with the single word: ready', user: 'Are you there?' },
      )
      setKeyMsg(`Works. ${r.model} replied "${r.text.trim()}" in ${(r.latencyMs / 1000).toFixed(1)} s.`)
    } catch (e) {
      setKeyMsg(describeAiError(e))
    } finally {
      setTesting(false)
    }
  }

  return (
    <div class="page">
      <div class="topbar">
        <button class="back" onClick={goBack}>
          ← Back
        </button>
        <h1>Settings</h1>
      </div>

      <div class="card">
        <h2>Anthropic API key</h2>
        <p class="muted small">
          Optional. With a key, spoken answers get AI grading; without one, you rate yourself. The key is stored only
          on this phone and never leaves it except in requests to Anthropic. Use a key made just for this app, scoped to
          one workspace, with a low monthly spend limit.
        </p>
        <div class="row">
          <span class={`pill ${hasKey ? 'ok' : 'warn'}`}>{hasKey ? 'Key saved' : 'No key'}</span>
        </div>
        <label class="field">
          <span>{hasKey ? 'Replace key' : 'Paste key'}</span>
          <input
            type="password"
            autocomplete="off"
            spellcheck={false}
            placeholder="sk-ant-…"
            value={keyDraft}
            onInput={(e) => setKeyDraft((e.target as HTMLInputElement).value)}
          />
        </label>
        <div class="row">
          <button class="btn primary" disabled={!keyDraft.trim()} onClick={saveKey}>
            Save key
          </button>
          <button class="btn" disabled={!hasKey || testing} onClick={testKey}>
            Test key
          </button>
          <button
            class="btn danger"
            disabled={!hasKey}
            onClick={async () => {
              await setApiKey('')
              setKeyMsg('Key removed.')
            }}
          >
            Remove
          </button>
        </div>
        {keyMsg && <p class="small">{keyMsg}</p>}
        <label class="field">
          <span>Workspace ID (only for keys not scoped to a workspace)</span>
          <input
            type="text"
            spellcheck={false}
            placeholder="wrkspc_…"
            value={s.workspaceId}
            onChange={(e) => set({ workspaceId: (e.target as HTMLInputElement).value.trim() })}
          />
        </label>
        <div class="grid2">
          <label class="field">
            <span>Grading model</span>
            <select value={s.model} onChange={(e) => set({ model: (e.target as HTMLSelectElement).value })}>
              {MODELS.map((m) => (
                <option value={m}>{m}</option>
              ))}
            </select>
          </label>
          <label class="field">
            <span>Sketch converter model</span>
            <select value={s.sketchModel} onChange={(e) => set({ sketchModel: (e.target as HTMLSelectElement).value })}>
              {MODELS.map((m) => (
                <option value={m}>{m}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div class="card">
        <h2>Voice</h2>
        <label class="field">
          <span>Voice ({voices.length} available)</span>
          <select value={chosen?.voiceURI ?? ''} onChange={(e) => set({ voiceURI: (e.target as HTMLSelectElement).value })}>
            {english.map((v) => (
              <option value={v.voiceURI}>
                {v.name} ({v.lang}){v.localService ? '' : ' · online'}
              </option>
            ))}
            {others.length > 0 && <option disabled>──────────</option>}
            {others.map((v) => (
              <option value={v.voiceURI}>
                {v.name} ({v.lang})
              </option>
            ))}
          </select>
        </label>
        <div class="grid2">
          <NumberField label="Drive speech rate" value={s.rateDrive} min={0.5} max={1.5} step={0.1} onChange={(v) => set({ rateDrive: Math.round(v * 10) / 10 })} />
          <NumberField label="Parked speech rate" value={s.rateParked} min={0.5} max={1.5} step={0.1} onChange={(v) => set({ rateParked: Math.round(v * 10) / 10 })} />
        </div>
        <button
          class="btn"
          onClick={() =>
            void speak('Nums equals the list 3, 1, 2. Then print nums at index 0. What does this print?', {
              rate: s.rateDrive,
              voiceURI: chosen?.voiceURI,
            })
          }
        >
          Test voice
        </button>
        <NumberField label="Tone volume" value={s.cueVolume} min={0.05} max={1} step={0.05} onChange={(v) => set({ cueVolume: Math.round(v * 100) / 100 })} />
      </div>

      <div class="card">
        <h2>Listening</h2>
        <div class="grid2">
          <NumberField
            label="Silence that ends an answer, Drive"
            value={s.silenceDriveMs / 1000}
            min={1.5}
            max={8}
            step={0.5}
            suffix=" s"
            onChange={(v) => set({ silenceDriveMs: v * 1000 })}
          />
          <NumberField
            label="Silence that ends an answer, Parked"
            value={s.silenceParkedMs / 1000}
            min={1.5}
            max={8}
            step={0.5}
            suffix=" s"
            onChange={(v) => set({ silenceParkedMs: v * 1000 })}
          />
        </div>
        <NumberField
          label="Thinking time before a prompt counts as unanswered"
          value={s.thinkMs / 1000}
          min={6}
          max={40}
          step={1}
          suffix=" s"
          onChange={(v) => set({ thinkMs: v * 1000 })}
        />
        <label class="check">
          <input type="checkbox" checked={s.pauseListening} onChange={(e) => set({ pauseListening: (e.target as HTMLInputElement).checked })} />
          <span>
            While paused, keep listening for "continue"
            <br />
            <span class="faint">Turn off if the phone chimes too often while paused; then tap to resume.</span>
          </span>
        </label>
        <details>
          <summary class="muted small">Recognizer options (for testing)</summary>
          <label class="check">
            <input type="checkbox" checked={s.sttContinuous} onChange={(e) => set({ sttContinuous: (e.target as HTMLInputElement).checked })} />
            <span>
              Continuous mode
              <br />
              <span class="faint">Off: one phrase per recognizer run (default). On: ask Chrome to keep listening.</span>
            </span>
          </label>
          <NumberField label="Restart delay" value={s.restartDelayMs} min={0} max={1000} step={20} suffix=" ms" onChange={(v) => set({ restartDelayMs: v })} />
        </details>
      </div>

      <div class="card">
        <h2>Sessions</h2>
        <NumberField label="Drive session length" value={s.sessionMinutes} min={20} max={35} step={5} suffix=" min" onChange={(v) => set({ sessionMinutes: v })} />
        <NumberField label="New drills per session" value={s.newPerSession} min={0} max={15} step={1} onChange={(v) => set({ newPerSession: v })} />
        <label class="field">
          <span>Languages</span>
          <select value={s.languageMix} onChange={(e) => set({ languageMix: (e.target as HTMLSelectElement).value as Settings['languageMix'] })}>
            <option value="both">SQL and Python, blocks of three</option>
            <option value="sql">SQL only</option>
            <option value="python">Python only</option>
          </select>
        </label>
      </div>

      <div class="card">
        <button
          class="btn danger"
          onClick={() => {
            if (confirm('Reset all settings to defaults? Your API key and progress stay.')) void resetSettings()
          }}
        >
          Reset settings
        </button>
        <p class="faint">{buildLabel()}</p>
      </div>
    </div>
  )
}
