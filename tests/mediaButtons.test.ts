// Media Session spike: the silent loop, handler mapping and cleanup, with a fake MediaSession and audio element.
import { describe, expect, it } from 'vitest'
import { MediaButtons, silentWav, type AudioLike, type MediaDeps, type MediaSessionLike } from '../src/platform/mediaButtons'

function fakes(playFails = false) {
  const handlers = new Map<string, ((d?: unknown) => void) | null>()
  const session: MediaSessionLike = {
    metadata: null,
    playbackState: 'none',
    setActionHandler: (a, h) => void handlers.set(a, h),
  }
  const audio: AudioLike & { listeners: Map<string, () => void> } = {
    src: '', loop: false, volume: 0, paused: true, listeners: new Map(),
    async play() {
      if (playFails) throw new Error('NotAllowedError')
      this.paused = false
      this.listeners.get('playing')?.()
    },
    pause() {
      this.paused = true
      this.listeners.get('pause')?.()
    },
    addEventListener(t, fn) { this.listeners.set(t, fn) },
    removeEventListener(t) { this.listeners.delete(t) },
    removeAttribute(n) { if (n === 'src') this.src = '' },
    load() {},
  }
  let t = 0
  const revoked: string[] = []
  const deps: MediaDeps = {
    session,
    createAudio: () => audio,
    makeMetadata: (init) => ({ ...init }),
    createObjectURL: () => 'blob:silent',
    revokeObjectURL: (u) => void revoked.push(u),
    now: () => ++t,
  }
  return { session, audio, handlers, deps, revoked }
}

describe('media buttons spike', () => {
  it('silentWav is a valid 8-bit mono PCM WAV of silence', () => {
    const w = silentWav(2, 8000)
    const dv = new DataView(w.buffer)
    const ascii = (o: number, n: number) => String.fromCharCode(...w.slice(o, o + n))
    expect(ascii(0, 4)).toBe('RIFF')
    expect(ascii(8, 4)).toBe('WAVE')
    expect(dv.getUint16(20, true)).toBe(1)
    expect(dv.getUint32(24, true)).toBe(8000)
    expect(dv.getUint32(40, true)).toBe(16000)
    expect(w.length).toBe(44 + 16000)
    expect(w.slice(44).every((b) => b === 128)).toBe(true)
  })

  it('plays a silent loop, maps the buttons, and mirrors pause', async () => {
    const f = fakes()
    const mb = new MediaButtons(f.deps)
    const calls: string[] = []
    const ok = await mb.start({ togglePause: () => calls.push('toggle'), skip: () => calls.push('skip'), repeat: () => calls.push('repeat') }, 'Code by Ear', 'Drive session')
    expect(ok).toBe(true)
    expect(f.audio).toMatchObject({ loop: true, src: 'blob:silent', paused: false })
    expect(f.session.playbackState).toBe('playing')
    expect(f.session.metadata).toMatchObject({ title: 'Code by Ear', artist: 'Drive session' })
    for (const a of ['pause', 'play', 'nexttrack', 'previoustrack', 'stop', 'seekforward', 'seekbackward']) f.handlers.get(a)!()
    expect(calls).toEqual(['toggle', 'toggle', 'skip', 'repeat', 'toggle', 'skip', 'repeat'])
    mb.setPaused(true)
    expect(f.session.playbackState).toBe('paused')
    expect(f.audio.paused).toBe(true)
    mb.setPaused(false)
    expect(f.audio.paused).toBe(false)
    expect(mb.events.some((e) => e.what === 'button: nexttrack')).toBe(true)
  })

  it('stop clears handlers, metadata and the audio', async () => {
    const f = fakes()
    const mb = new MediaButtons(f.deps)
    await mb.start({ togglePause() {}, skip() {}, repeat() {} })
    mb.stop()
    expect([...f.handlers.values()].every((h) => h === null)).toBe(true)
    expect(f.session.playbackState).toBe('none')
    expect(f.session.metadata).toBeNull()
    expect(f.audio.src).toBe('')
    expect(f.revoked).toEqual(['blob:silent'])
    expect(mb.active).toBe(false)
    mb.stop() // twice is harmless
  })

  it('reports when the browser refuses to play, or has no Media Session', async () => {
    const f = fakes(true)
    const mb = new MediaButtons(f.deps)
    expect(await mb.start({ togglePause() {}, skip() {}, repeat() {} })).toBe(false)
    expect(mb.events[0].what).toMatch(/could not start the silent loop/)
    const none = new MediaButtons({ ...fakes().deps, session: null })
    expect(none.supported).toBe(false)
    expect(await none.start({ togglePause() {}, skip() {}, repeat() {} })).toBe(false)
  })
})
