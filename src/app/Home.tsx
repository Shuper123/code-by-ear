import { useEffect, useState } from 'preact/hooks'
import { isStandalone, pwa } from '../pwa'
import { useSettings } from '../settings'
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

export function Home() {
  const { hasKey } = useSettings()
  const standalone = isStandalone()
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
        <h2>Milestone 0: voice spike</h2>
        <p class="muted small">
          Tests the risky parts on your phone before the real sessions are built: speech out, speech in across
          pauses, tones, keeping the screen on, and one AI call.
        </p>
        <button class="btn primary block big" onClick={() => navigate('spike')}>
          Open voice spike
        </button>
      </div>

      <div class="grid2">
        <button class="btn block big" disabled>
          Start Drive
        </button>
        <button class="btn block big" disabled>
          Start Parked
        </button>
      </div>
      <p class="faint">Drive and Parked sessions arrive in milestone 1.</p>

      <div class="card">
        <div class="row">
          <span class={`pill ${hasKey ? 'ok' : 'warn'}`}>{hasKey ? 'API key saved' : 'No API key'}</span>
          <span class={`pill ${standalone ? 'ok' : 'warn'}`}>{standalone ? 'Installed app' : 'Running in browser'}</span>
        </div>
        {!standalone && (
          <p class="faint">To install: Chrome menu, then Add to Home screen or Install app.</p>
        )}
        <div class="row" style={{ marginTop: '10px' }}>
          <button class="btn" onClick={() => navigate('settings')}>
            Settings
          </button>
        </div>
      </div>
      <p class="faint">{buildLabel()}</p>
    </div>
  )
}
