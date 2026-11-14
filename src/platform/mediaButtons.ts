// Spike (spec M4 and section 16): headset and steering-wheel buttons through the Media Session API.
//
// Android only sends media buttons (Bluetooth AVRCP play/pause/next/previous) to an app that is playing
// media, so while this is on, a silent audio loop plays and the page registers Media Session handlers.
// Play and pause both toggle the session's pause (whatever the audio element thinks, since speech
// recognition and text-to-speech can pause it), next track skips, previous track repeats.
// Every event is logged so the Voice check screen can show what actually arrives from the car.

export type ButtonAction = 'play' | 'pause' | 'nexttrack' | 'previoustrack' | 'stop' | 'seekforward' | 'seekbackward'
export const BUTTON_ACTIONS: ButtonAction[] = ['play', 'pause', 'nexttrack', 'previoustrack', 'stop', 'seekforward', 'seekbackward']

export interface ButtonHandlers {
  togglePause(): void
  skip(): void
  repeat(): void
}

export interface ButtonEvent {
  at: number
  what: string
}

/** The parts of HTMLAudioElement and MediaSession this module uses, so tests can pass fakes. */
export interface AudioLike {
  src: string
  loop: boolean
  volume: number
  paused: boolean
  play(): Promise<void>
  pause(): void
  addEventListener(type: string, fn: () => void): void
  removeEventListener(type: string, fn: () => void): void
  removeAttribute(name: string): void
  load(): void
}
export interface MediaSessionLike {
  metadata: unknown
  playbackState: 'none' | 'paused' | 'playing'
  setActionHandler(action: string, handler: ((details?: unknown) => void) | null): void
}
export interface MediaDeps {
  session: MediaSessionLike | null
  createAudio(): AudioLike
  makeMetadata(init: { title: string; artist: string; album: string; artwork: { src: string; sizes: string; type: string }[] }): unknown
  createObjectURL(b: Blob): string
  revokeObjectURL(url: string): void
  now(): number
}

/** A WAV file of silence: 8 kHz, 8-bit mono (silence is 128 in unsigned 8-bit PCM). */
export function silentWav(seconds = 10, rate = 8000): Uint8Array {
  const n = Math.round(seconds * rate)
  const buf = new Uint8Array(44 + n)
  const dv = new DataView(buf.buffer)
  const ascii = (off: number, s: string) => [...s].forEach((c, i) => dv.setUint8(off + i, c.charCodeAt(0)))
  ascii(0, 'RIFF')
  dv.setUint32(4, 36 + n, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  dv.setUint32(16, 16, true) // fmt chunk size
  dv.setUint16(20, 1, true) // PCM
  dv.setUint16(22, 1, true) // mono
  dv.setUint32(24, rate, true)
  dv.setUint32(28, rate, true) // byte rate
  dv.setUint16(32, 1, true) // block align
  dv.setUint16(34, 8, true) // bits per sample
  ascii(36, 'data')
  dv.setUint32(40, n, true)
  buf.fill(128, 44)
  return buf
}

export function mediaSessionSupported(): boolean {
  return typeof navigator !== 'undefined' && 'mediaSession' in navigator
}

function browserDeps(): MediaDeps {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined
  return {
    session: nav && 'mediaSession' in nav ? (nav.mediaSession as unknown as MediaSessionLike) : null,
    createAudio: () => new Audio() as unknown as AudioLike,
    makeMetadata: (init) => (typeof MediaMetadata !== 'undefined' ? new MediaMetadata(init) : null),
    createObjectURL: (b) => URL.createObjectURL(b),
    revokeObjectURL: (u) => URL.revokeObjectURL(u),
    now: () => Date.now(),
  }
}

export class MediaButtons {
  private audio: AudioLike | null = null
  private url = ''
  private handlers: ButtonHandlers | null = null
  private listeners = new Set<(log: ButtonEvent[]) => void>()
  private onPlay = () => this.log('audio playing')
  private onPause = () => this.log('audio paused')
  readonly events: ButtonEvent[] = []

  constructor(private deps: MediaDeps = browserDeps()) {}

  get supported(): boolean {
    return !!this.deps.session
  }
  get active(): boolean {
    return !!this.audio
  }

  subscribe(fn: (log: ButtonEvent[]) => void): () => void {
    this.listeners.add(fn)
    fn(this.events)
    return () => this.listeners.delete(fn)
  }

  private log(what: string) {
    this.events.unshift({ at: this.deps.now(), what })
    if (this.events.length > 40) this.events.length = 40
    for (const l of this.listeners) l(this.events)
  }

  /** Call from a tap (or soon after one), so the browser lets the silent loop play. */
  async start(handlers: ButtonHandlers, title = 'Code by Ear', artist = 'Practice session'): Promise<boolean> {
    this.stop()
    this.handlers = handlers
    const s = this.deps.session
    if (!s) {
      this.log('Media Session API not available')
      return false
    }
    const wav = silentWav()
    this.url = this.deps.createObjectURL(new Blob([wav.buffer as ArrayBuffer], { type: 'audio/wav' }))
    const a = this.deps.createAudio()
    a.loop = true
    a.volume = 1 // the samples are silent; a muted element may not count as playing media
    a.src = this.url
    a.addEventListener('playing', this.onPlay)
    a.addEventListener('pause', this.onPause)
    this.audio = a
    s.metadata = this.deps.makeMetadata({
      title,
      artist,
      album: 'Code by Ear',
      artwork: [{ src: `${import.meta.env.BASE_URL}icons/icon-512.png`, sizes: '512x512', type: 'image/png' }],
    })
    for (const action of BUTTON_ACTIONS) {
      try {
        s.setActionHandler(action, () => this.handle(action))
      } catch {
        this.log(`${action}: not supported here`)
      }
    }
    try {
      await a.play()
      s.playbackState = 'playing'
      this.log('started; silent loop playing')
      return true
    } catch (e) {
      this.log(`could not start the silent loop: ${(e as Error).message}`)
      return false
    }
  }

  private handle(action: ButtonAction) {
    this.log(`button: ${action}`)
    const h = this.handlers
    if (!h) return
    if (action === 'play' || action === 'pause' || action === 'stop') h.togglePause()
    else if (action === 'nexttrack' || action === 'seekforward') h.skip()
    else h.repeat()
  }

  /** Mirror the session's pause state so the next press sends the right action. */
  setPaused(paused: boolean) {
    const s = this.deps.session
    if (!s || !this.audio) return
    s.playbackState = paused ? 'paused' : 'playing'
    if (paused) this.audio.pause()
    else if (this.audio.paused) void this.audio.play().catch(() => this.log('could not resume the silent loop'))
  }

  stop() {
    const s = this.deps.session
    if (s) {
      for (const action of BUTTON_ACTIONS) {
        try {
          s.setActionHandler(action, null)
        } catch {
          // not supported; nothing to clear
        }
      }
      s.playbackState = 'none'
      s.metadata = null
    }
    if (this.audio) {
      this.audio.removeEventListener('playing', this.onPlay)
      this.audio.removeEventListener('pause', this.onPause)
      this.audio.pause()
      this.audio.removeAttribute('src')
      this.audio.load()
      this.audio = null
      this.log('stopped')
    }
    if (this.url) this.deps.revokeObjectURL(this.url)
    this.url = ''
    this.handlers = null
  }
}

/** One shared instance, so the Voice check log and sessions see the same events. */
export const mediaButtons = new MediaButtons()
