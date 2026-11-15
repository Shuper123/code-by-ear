// The app's voice. With the neural voice on, each sentence plays from (1) the pre-rendered drill audio
// shipped with the app, (2) audio this phone generated before, or (3) the on-phone Kokoro model, in the
// same voice. If any sentence of an utterance has none of these, the whole utterance uses the phone's
// own voice, so one utterance never switches voices midway. A line of code can be spoken as phrases with
// short pauses between them; the line still counts as one utterance.
import manifestJson from '../data/voice_manifest.json'
import type { Drill } from '../data/types'
import { getSettings, type Settings } from '../settings'
import { sentences, speechKey, type SpeechStyle } from './chunks'
import { encodeWav, neural, PAD, trimSilence, type GeneratedAudio } from './neural'
import { drillSpeech } from './phrasing'
import { speak as phoneSpeak, stopSpeaking as phoneStop } from './tts'

export interface VoiceManifest {
  voice: string
  model: string
  codeSpeed: number
  clips: Record<string, number>
}
export const PACK = manifestJson as VoiceManifest
export const PACK_CACHE = 'voice-pack' // the service worker's runtime cache for /voice/
const GEN_CACHE = 'cbe-voice-gen-v1'
const BASE = import.meta.env.BASE_URL

export type VoiceSource = { kind: 'pack' | 'cached'; url: string } | { kind: 'gen'; text: string; style: SpeechStyle; key: string }

export interface AudioLike {
  src: string
  playbackRate: number
  defaultPlaybackRate: number
  preservesPitch?: boolean
  duration: number
  onended: (() => void) | null
  onerror: (() => void) | null
  play(): Promise<void>
  pause(): void
  removeAttribute(name: string): void
}

export interface VoiceDeps {
  settings(): Settings
  createAudio(): AudioLike | null
  cacheMatch(cache: string, url: string): Promise<Blob | null>
  cachePut(cache: string, url: string, blob: Blob): Promise<void>
  objectUrl(blob: Blob): string
  generate(text: string, voice: string, speed: number): Promise<GeneratedAudio>
  neuralReady(): boolean
  phoneSpeak(text: string, rate: number, voiceURI: string | undefined, signal?: AbortSignal): Promise<void>
  phoneStop(): void
  now(): number
  /** Wait between the phrases of a line; resolves early if the signal aborts. */
  sleep(ms: number, signal?: AbortSignal): Promise<void>
  origin: string
  /** Which sentences have pre-rendered audio (the build's manifest; tests pass their own). */
  pack: VoiceManifest
}

function browserDeps(): VoiceDeps {
  const hasCaches = typeof caches !== 'undefined'
  return {
    settings: getSettings,
    createAudio: () => (typeof Audio !== 'undefined' ? (new Audio() as unknown as AudioLike) : null),
    cacheMatch: async (name, url) => {
      if (!hasCaches) return null
      const r = await (await caches.open(name)).match(url)
      return r ? await r.blob() : null
    },
    cachePut: async (name, url, blob) => {
      if (hasCaches) await (await caches.open(name)).put(url, new Response(blob, { headers: { 'Content-Type': blob.type } }))
    },
    objectUrl: (b) => URL.createObjectURL(b),
    generate: (t, v, s) => neural.generate(t, v, s),
    neuralReady: () => neural.ready,
    phoneSpeak: (text, rate, voiceURI, signal) => phoneSpeak(text, { rate, voiceURI }, signal),
    phoneStop,
    now: () => Date.now(),
    sleep: (ms, signal) =>
      new Promise<void>((resolve) => {
        if (signal?.aborted) return resolve()
        const done = () => {
          clearTimeout(timer)
          signal?.removeEventListener('abort', done)
          resolve()
        }
        const timer = setTimeout(done, ms)
        signal?.addEventListener('abort', done)
      }),
    origin: typeof location !== 'undefined' ? location.href : 'http://localhost/',
    pack: PACK,
  }
}

export function packUrl(voice: string, key: string): string {
  return `${BASE}voice/${voice}/${key}.ogg`
}

export interface VoiceLogEntry {
  text: string
  engine: 'neural' | 'phone'
  style: SpeechStyle
}

export class VoicePlayer {
  lastEngine: 'neural' | 'phone' | null = null
  lastError: string | null = null
  readonly log: VoiceLogEntry[] = []
  private el: AudioLike | null = null
  private lastEndAt = 0
  private silence: string | null = null

  constructor(private deps: VoiceDeps = browserDeps()) {}

  private record(text: string, engine: 'neural' | 'phone', style: SpeechStyle) {
    this.lastEngine = engine
    const entry = { text, engine, style }
    this.log.push(entry)
    if (this.log.length > 50) this.log.shift()
    const g = globalThis as unknown as { __cbeVoiceLog?: VoiceLogEntry[] }
    g.__cbeVoiceLog?.push(entry)
  }

  /** Where a sentence's audio can come from right now, or null if only the phone voice can say it. */
  async sourceFor(sentence: string, style: SpeechStyle, voice: string): Promise<VoiceSource | null> {
    const key = speechKey(style, sentence)
    const pack = this.deps.pack
    if (voice === pack.voice && pack.clips[key] !== undefined) return { kind: 'pack', url: packUrl(voice, key) }
    try {
      const blob = await this.deps.cacheMatch(GEN_CACHE, this.genUrl(voice, key))
      if (blob) return { kind: 'cached', url: this.deps.objectUrl(blob) }
    } catch {
      // no cache in this context
    }
    if (this.deps.neuralReady()) return { kind: 'gen', text: sentence, style, key }
    return null
  }

  private genUrl(voice: string, key: string) {
    return new URL(`${BASE}__voice/${voice}/${key}.wav`, this.deps.origin).href
  }

  private async urlFor(src: VoiceSource, voice: string): Promise<string | null> {
    if (src.kind !== 'gen') return src.url
    try {
      const a = await this.deps.generate(src.text, voice, src.style === 'prose' ? 1 : this.deps.pack.codeSpeed)
      const blob =
        src.style === 'phrase'
          ? encodeWav(trimSilence(a.samples, a.sampleRate), a.sampleRate, PAD.phrase.lead, PAD.phrase.tail)
          : encodeWav(a.samples, a.sampleRate)
      void this.deps.cachePut(GEN_CACHE, this.genUrl(voice, src.key), blob).catch(() => {})
      return this.deps.objectUrl(blob)
    } catch (e) {
      this.lastError = (e as Error).message
      return null
    }
  }

  private rateFor(rate: number, style: SpeechStyle): number {
    const native = style === 'prose' ? 1 : this.deps.pack.codeSpeed
    return Math.min(2, Math.max(0.5, rate / native))
  }

  private play(url: string, rate: number, signal?: AbortSignal): Promise<boolean> {
    const a = (this.el ??= this.deps.createAudio())
    if (!a) return Promise.resolve(false)
    return new Promise<boolean>((resolve) => {
      let done = false
      const finish = (ok: boolean) => {
        if (done) return
        done = true
        clearTimeout(guard)
        signal?.removeEventListener('abort', onAbort)
        a.onended = null
        a.onerror = null
        this.lastEndAt = this.deps.now()
        resolve(ok)
      }
      const onAbort = () => {
        a.pause()
        finish(true)
      }
      if (signal?.aborted) return finish(true)
      signal?.addEventListener('abort', onAbort)
      a.onended = () => finish(true)
      a.onerror = () => {
        this.lastError = 'The audio could not be played.'
        finish(false)
      }
      // Safety net in case `ended` never fires: generous, since a long sentence at a slow rate takes a while.
      const guard = setTimeout(() => finish(true), 60000)
      a.src = url
      a.defaultPlaybackRate = rate
      a.playbackRate = rate
      a.preservesPitch = true
      a.play().catch((e: Error) => {
        this.lastError = `Playback was blocked: ${e.message}`
        finish(false)
      })
    })
  }

  /** After a quiet spell, a short silence first: Bluetooth audio often clips the start while it wakes up. */
  private async wake(signal?: AbortSignal) {
    if (this.deps.now() - this.lastEndAt < 4000) return
    this.silence ??= this.deps.objectUrl(encodeWav(new Float32Array(0), 24000, 0.35, 0))
    await this.play(this.silence, 1, signal)
  }

  /**
   * Say `text`. An array is one line of code in phrases, with `gapMs` of silence between them: the whole
   * line uses one voice, and the next phrase's audio is prepared during each pause.
   */
  async speak(text: string | string[], rate: number, signal?: AbortSignal, style: SpeechStyle = 'prose', gapMs = 0): Promise<void> {
    const s = this.deps.settings()
    const chunks = (Array.isArray(text) ? text : [text]).map((t) => sentences(t)).filter((c) => c.length)
    if (!chunks.length || signal?.aborted) return
    const items = chunks.flatMap((c, ci) => c.map((t, j) => ({ text: t, gapAfter: j === c.length - 1 && ci < chunks.length - 1 ? gapMs : 0 })))
    const whole = items.map((x) => x.text).join(' ')
    const viaPhone = async (from: number) => {
      const rest = items.slice(from)
      this.record(rest.map((x) => x.text).join(' '), 'phone', style)
      if (from === 0 && typeof text === 'string') return this.deps.phoneSpeak(text, rate, s.voiceURI, signal)
      let run: string[] = []
      for (const [k, it] of rest.entries()) {
        run.push(it.text)
        if (it.gapAfter === 0 && k < rest.length - 1) continue
        if (signal?.aborted) return
        await this.deps.phoneSpeak(run.join(' '), rate, s.voiceURI, signal)
        run = []
        if (it.gapAfter > 0) await this.deps.sleep(it.gapAfter, signal)
      }
    }
    if (s.voiceEngine !== 'neural') return viaPhone(0)
    const sources = await Promise.all(items.map((x) => this.sourceFor(x.text, style, s.neuralVoice)))
    if (sources.some((x) => !x)) return viaPhone(0)
    this.record(whole, 'neural', style)
    await this.wake(signal)
    let next: Promise<string | null> | null = null
    for (let i = 0; i < items.length; i++) {
      if (signal?.aborted) return
      const url = await (next ?? this.urlFor(sources[i]!, s.neuralVoice))
      next = i + 1 < items.length ? this.urlFor(sources[i + 1]!, s.neuralVoice) : null // work ahead while this plays
      if (!url || !(await this.play(url, this.rateFor(rate, style), signal))) {
        if (signal?.aborted) return
        await viaPhone(i)
        return
      }
      if (items[i].gapAfter > 0) await this.deps.sleep(items[i].gapAfter, signal)
    }
  }

  stop() {
    this.el?.pause()
    this.deps.phoneStop()
  }
}

export const voice = new VoicePlayer()
// A handle for Voice check and the browser tests: window.__cbeVoice.speak('Some new sentence.', 1)
;(globalThis as unknown as { __cbeVoice?: VoicePlayer }).__cbeVoice = voice

/** Every pre-rendered sentence a drill can speak, so a session can fetch its audio up front. */
export const drillSentences = drillSpeech

/** Fetch pre-rendered audio into the cache (the service worker keeps it). Returns how many were fetched. */
export async function prefetchPack(keys: string[], voiceId = PACK.voice, onProgress?: (done: number, total: number) => void): Promise<number> {
  const urls = [...new Set(keys.filter((k) => PACK.clips[k] !== undefined))].map((k) => packUrl(voiceId, k))
  let done = 0
  let ok = 0
  const queue = [...urls]
  const worker = async () => {
    for (let u = queue.shift(); u; u = queue.shift()) {
      try {
        if ((await fetch(u)).ok) ok++
      } catch {
        // offline: try again next time
      }
      onProgress?.(++done, urls.length)
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker))
  return ok
}

export function prefetchDrills(drills: Drill[]): Promise<number> {
  if (getSettings().voiceEngine !== 'neural' || getSettings().neuralVoice !== PACK.voice) return Promise.resolve(0)
  return prefetchPack(drills.flatMap((d) => drillSentences(d).map((x) => speechKey(x.style, x.text))))
}

export async function packCachedCount(): Promise<number> {
  if (typeof caches === 'undefined') return 0
  try {
    const keys = await (await caches.open(PACK_CACHE)).keys()
    return keys.filter((r) => r.url.includes(`/voice/${PACK.voice}/`)).length
  } catch {
    return 0
  }
}
