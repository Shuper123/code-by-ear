// Voice check card for the Media Session spike: shows which headset and steering-wheel buttons reach the app.
import { useEffect, useState } from 'preact/hooks'
import { mediaButtons, mediaSessionSupported, type ButtonEvent } from '../platform/mediaButtons'
import { getSettings } from '../settings'
import { speak } from '../speech/tts'

export function buttonReportLines(): string[] {
  return [
    `Media Session API: ${mediaSessionSupported()} · button test running: ${mediaButtons.active}`,
    ...mediaButtons.events
      .slice()
      .reverse()
      .map((e) => `  ${new Date(e.at).toISOString().slice(11, 19)} ${e.what}`),
  ]
}

export function ButtonTest() {
  const [events, setEvents] = useState<ButtonEvent[]>([])
  const [running, setRunning] = useState(mediaButtons.active)
  useEffect(() => mediaButtons.subscribe((log) => setEvents([...log])), [])
  const say = (text: string) => void speak(text, { rate: 1, voiceURI: getSettings().voiceURI }).catch(() => {})

  const start = async () => {
    await mediaButtons.start(
      { togglePause: () => say('Play or pause'), skip: () => say('Next'), repeat: () => say('Previous') },
      'Code by Ear',
      'Button test',
    )
    setRunning(mediaButtons.active)
  }
  const stop = () => {
    mediaButtons.stop()
    setRunning(false)
  }

  return (
    <div class="card">
      <h2>6. Headset and car buttons</h2>
      <p class="muted small">
        Media Session API: {mediaSessionSupported() ? 'available' : 'not available in this browser'}. Start the test, then
        press play/pause, next and previous on your headset or steering wheel. The app says which one arrived, and the
        log below shows it. Leave it running and try the voice loop above to see if buttons still arrive while the app is
        listening.
      </p>
      <div class="row">
        <button class="btn" disabled={running} onClick={() => void start()}>
          Start button test
        </button>
        <button class="btn" disabled={!running} onClick={stop}>
          Stop
        </button>
      </div>
      <div class="log" style={{ marginTop: '10px' }}>
        {events.length === 0
          ? 'No button events yet.'
          : events.map((e) => `${new Date(e.at).toLocaleTimeString()} ${e.what}`).join('\n')}
      </div>
    </div>
  )
}
