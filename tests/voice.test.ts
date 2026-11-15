// The voice layer: pre-rendered audio, generated and cached audio, and the phone voice as a whole-utterance
// fallback, with fakes for the audio element, caches and the on-phone model.
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type Settings } from '../src/settings'
import { speechKey } from '../src/speech/chunks'
import { encodeWav, trimSilence } from '../src/speech/neural'
import { drillSpeech } from '../src/speech/phrasing'
import { PACK, packUrl, VoicePlayer, type AudioLike, type VoiceDeps, type VoiceManifest } from '../src/speech/voice'
import { loadDrills } from './helpers'

function setup(opts: { settings?: Partial<Settings>; packed?: [string, 'prose' | 'code' | 'phrase'][]; neural?: boolean; playFails?: boolean } = {}) {
  const pack: VoiceManifest = { voice: 'af_heart', model: 'test', codeSpeed: 0.85, clips: {} }
  for (const [t, style] of opts.packed ?? []) pack.clips[speechKey(style, t)] = 1000
  const played: { src: string; rate: number }[] = []
  const phone: { text: string; rate: number }[] = []
  const cache = new Map<string, Blob>()
  const generated: string[] = []
  const gaps: number[] = []
  const order: string[] = [] // plays and gaps in the order they happened
  let t = 1_000_000
  let blobs = 0
  const audio: AudioLike = {
    src: '', playbackRate: 1, defaultPlaybackRate: 1, duration: 1, onended: null, onerror: null,
    async play() {
      if (opts.playFails) throw new Error('NotAllowedError')
      played.push({ src: this.src, rate: this.playbackRate })
      order.push(`play ${this.src}`)
      t += 1000
      queueMicrotask(() => this.onended?.())
    },
    pause() {},
    removeAttribute() {},
  }
  const deps: VoiceDeps = {
    settings: () => ({ ...DEFAULT_SETTINGS, ...opts.settings }),
    createAudio: () => audio,
    cacheMatch: async (_c, url) => cache.get(url) ?? null,
    cachePut: async (_c, url, blob) => void cache.set(url, blob),
    objectUrl: () => `blob:${++blobs}`,
    generate: async (text, _voice, speed) => {
      generated.push(`${text}@${speed}`)
      return { samples: new Float32Array(2400), sampleRate: 24000 }
    },
    neuralReady: () => !!opts.neural,
    phoneSpeak: async (text, rate) => {
      phone.push({ text, rate })
      order.push(`phone ${text}`)
    },
    phoneStop: () => {},
    now: () => (t += 10),
    sleep: async (ms) => {
      gaps.push(ms)
      order.push(`gap ${ms}`)
      t += ms
    },
    origin: 'https://example.test/code-by-ear/',
    pack,
  }
  return { v: new VoicePlayer(deps), played, phone, cache, generated, gaps, order }
}

describe('voice', () => {
  it('phone engine setting: everything goes to the phone voice', async () => {
    const x = setup({ settings: { voiceEngine: 'phone' }, packed: [['Hello there.', 'prose']] })
    await x.v.speak('Hello there.', 0.9)
    expect(x.phone).toEqual([{ text: 'Hello there.', rate: 0.9 }])
    expect(x.played).toHaveLength(0)
  })

  it('pre-rendered sentences play from files, after a short wake-up silence, at the right rates', async () => {
    const x = setup({ packed: [['Python.', 'prose'], ['Three lines.', 'prose'], ['x equals 7.', 'code']] })
    await x.v.speak('Python. Three lines.', 0.9)
    await x.v.speak('x equals 7.', 0.9 * 0.85, undefined, 'code')
    expect(x.played.map((p) => p.src)).toEqual([
      'blob:1', // the wake-up silence
      packUrl('af_heart', speechKey('prose', 'Python.')),
      packUrl('af_heart', speechKey('prose', 'Three lines.')),
      packUrl('af_heart', speechKey('code', 'x equals 7.')),
    ])
    expect(x.played[1].rate).toBeCloseTo(0.9)
    expect(x.played[3].rate).toBeCloseTo(0.9) // code is recorded at 0.85, so 0.9 x 0.85 plays back at 0.9
    expect(x.phone).toHaveLength(0)
    expect(x.v.lastEngine).toBe('neural')
  })

  it('one sentence without audio and no on-phone model: the whole utterance uses the phone voice', async () => {
    const x = setup({ packed: [['Correct.', 'prose']] })
    await x.v.speak('Correct. You found the bug on line 2.', 1)
    expect(x.phone).toEqual([{ text: 'Correct. You found the bug on line 2.', rate: 1 }])
    expect(x.played).toHaveLength(0)
  })

  it('with the on-phone model: new sentences are generated, cached, and reused next time', async () => {
    const x = setup({ packed: [['Correct.', 'prose']], neural: true })
    await x.v.speak('Correct. You found the bug on line 2.', 1)
    expect(x.generated).toEqual(['You found the bug on line 2.@1'])
    expect(x.cache.size).toBe(1)
    expect(x.played).toHaveLength(3) // silence, pre-rendered, generated
    await x.v.speak('You found the bug on line 2.', 1)
    expect(x.generated).toHaveLength(1) // the second time comes from the cache
    expect(x.phone).toHaveLength(0)
  })

  it('code is generated at the recorded code speed', async () => {
    const x = setup({ neural: true })
    await x.v.speak('Then print n.', 0.85, undefined, 'code')
    expect(x.generated).toEqual(['Then print n.@0.85'])
  })

  it('a voice other than the recorded one ignores the drill audio', async () => {
    const x = setup({ settings: { neuralVoice: 'am_michael' }, packed: [['Correct.', 'prose']] })
    await x.v.speak('Correct.', 1)
    expect(x.phone).toHaveLength(1)
  })

  it('if playback is blocked, the rest of the utterance falls back to the phone voice', async () => {
    const x = setup({ packed: [['Correct.', 'prose'], ['Well done.', 'prose']], playFails: true })
    await x.v.speak('Correct. Well done.', 1)
    expect(x.phone.map((p) => p.text)).toEqual(['Correct. Well done.'])
    expect(x.v.lastError).toMatch(/blocked/)
  })

  it('an aborted utterance stops without the phone voice', async () => {
    const x = setup({ packed: [['Correct.', 'prose']] })
    const ctrl = new AbortController()
    ctrl.abort()
    await x.v.speak('Correct.', 1, ctrl.signal)
    expect(x.played).toHaveLength(0)
    expect(x.phone).toHaveLength(0)
  })

  it('encodeWav writes a valid 16-bit mono WAV with padding', async () => {
    const b = encodeWav(new Float32Array([0, 0.5, -0.5, 1]), 24000, 0.001, 0.001)
    const dv = new DataView(await b.arrayBuffer())
    expect(dv.getUint32(24, true)).toBe(24000)
    expect(dv.getUint16(34, true)).toBe(16)
    const n = dv.getUint32(40, true) / 2
    expect(n).toBe(24 + 4 + 24)
    expect(dv.getInt16(44 + 25 * 2, true)).toBe(Math.round(0.5 * 0x7fff))
  })

  it('a line in phrases plays each phrase with the pause between them, at the code rate', async () => {
    const x = setup({ packed: [['Then,', 'phrase'], ['x equals,', 'phrase'], ['x,', 'phrase'], ['plus 3.', 'phrase']] })
    await x.v.speak(['Then,', 'x equals,', 'x,', 'plus 3.'], 0.9 * 0.85, undefined, 'phrase', 400)
    const key = (t: string) => `play ${packUrl('af_heart', speechKey('phrase', t))}`
    expect(x.order).toEqual(['play blob:1', key('Then,'), 'gap 400', key('x equals,'), 'gap 400', key('x,'), 'gap 400', key('plus 3.')])
    expect(x.played[1].rate).toBeCloseTo(0.9) // phrases are recorded at the code speed too
    expect(x.phone).toHaveLength(0)
  })

  it('one phrase without audio: the whole line uses the phone voice, still with the pauses', async () => {
    const x = setup({ packed: [['x equals,', 'phrase']] })
    await x.v.speak(['x equals,', '7.'], 1, undefined, 'phrase', 300)
    expect(x.order).toEqual(['phone x equals,', 'gap 300', 'phone 7.'])
    expect(x.played).toHaveLength(0)
  })

  it('phrases the phone generates are made at the code speed', async () => {
    const x = setup({ neural: true })
    await x.v.speak(['n equals,', '0.'], 0.85, undefined, 'phrase', 300)
    expect(x.generated).toEqual(['n equals,@0.85', '0.@0.85'])
    expect(x.gaps).toEqual([300])
  })

  it('stopping during a pause ends the line', async () => {
    const x = setup({ packed: [['x equals,', 'phrase'], ['7.', 'phrase']] })
    const ctrl = new AbortController()
    const v = x.v as unknown as { deps: { sleep: (ms: number) => Promise<void> } }
    v.deps.sleep = async () => ctrl.abort()
    await x.v.speak(['x equals,', '7.'], 1, ctrl.signal, 'phrase', 300)
    expect(x.played.map((p) => p.src)).toEqual(['blob:1', packUrl('af_heart', speechKey('phrase', 'x equals,'))])
  })

  it('trimSilence keeps the sound and a little margin, and fades the cut edges', () => {
    const sr = 24000
    const s = new Float32Array(sr) // 1 s: silence, 0.2 s of tone, silence
    for (let i = 0.4 * sr; i < 0.6 * sr; i++) s[i] = 0.5 * Math.sin(i / 3)
    const t = trimSilence(s, sr, 0.025)
    expect(t.length / sr).toBeGreaterThan(0.2)
    expect(t.length / sr).toBeLessThan(0.28)
    expect(Math.abs(t[0])).toBe(0)
    expect(trimSilence(new Float32Array(100), sr)).toHaveLength(100) // all silence: left alone
  })
})

describe('the recorded drill audio', () => {
  it('covers every sentence, line and phrase the drills speak (run npm run voice after editing drills)', () => {
    const missing = loadDrills()
      .flatMap((d) => drillSpeech(d))
      .filter((x) => PACK.clips[speechKey(x.style, x.text)] === undefined)
      .map((x) => `${x.style}: ${x.text}`)
    expect(missing).toEqual([])
  })
})

