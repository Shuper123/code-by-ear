// Main-thread side of the on-phone Kokoro voice: loads the model in a worker, generates audio for new
// sentences, and reports progress and status for Settings and Voice check.
import type { KokoroIn, KokoroOut } from './kokoro.worker'

export type NeuralDtype = 'fp32' | 'q8'
export interface NeuralStatus {
  state: 'off' | 'loading' | 'ready' | 'error'
  dtype?: NeuralDtype
  device?: 'webgpu' | 'wasm'
  loaded?: number
  total?: number
  loadMs?: number
  lastGenMs?: number
  lastGenSeconds?: number
  error?: string
}

export interface GeneratedAudio {
  samples: Float32Array
  sampleRate: number
}

class NeuralEngine {
  status: NeuralStatus = { state: 'off' }
  private worker: Worker | null = null
  private loading: Promise<void> | null = null
  private pending = new Map<number, { resolve: (a: GeneratedAudio) => void; reject: (e: Error) => void }>()
  private nextId = 1
  private files = new Map<string, { loaded: number; total: number }>()
  private listeners = new Set<(s: NeuralStatus) => void>()

  subscribe(fn: (s: NeuralStatus) => void): () => void {
    this.listeners.add(fn)
    fn(this.status)
    return () => this.listeners.delete(fn)
  }

  private set(patch: Partial<NeuralStatus>) {
    this.status = { ...this.status, ...patch }
    for (const l of this.listeners) l(this.status)
  }

  get ready(): boolean {
    return this.status.state === 'ready'
  }

  /** Load (downloading the first time) the model. Safe to call again; a different size reloads. */
  load(dtype: NeuralDtype): Promise<void> {
    if (this.loading && this.status.dtype === dtype && this.status.state !== 'error') return this.loading
    this.unload()
    this.files.clear()
    this.set({ state: 'loading', dtype, device: undefined, loaded: 0, total: 0, error: undefined })
    const worker = new Worker(new URL('./kokoro.worker.ts', import.meta.url), { type: 'module' })
    this.worker = worker
    this.loading = new Promise<void>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<KokoroOut>) => {
        const m = e.data
        if (m.type === 'progress') {
          this.files.set(m.file, { loaded: m.loaded, total: m.total })
          let loaded = 0
          let total = 0
          for (const f of this.files.values()) {
            loaded += f.loaded
            total += f.total
          }
          this.set({ loaded, total })
        } else if (m.type === 'ready') {
          this.set({ state: 'ready', device: m.device, loadMs: m.ms })
          resolve()
        } else if (m.type === 'audio') {
          this.set({ lastGenMs: m.ms, lastGenSeconds: m.samples.length / m.sampleRate })
          this.pending.get(m.id)?.resolve({ samples: m.samples, sampleRate: m.sampleRate })
          this.pending.delete(m.id)
        } else if (m.type === 'error') {
          if (m.id !== undefined) {
            this.pending.get(m.id)?.reject(new Error(m.message))
            this.pending.delete(m.id)
          } else {
            this.set({ state: 'error', error: m.message })
            reject(new Error(m.message))
          }
        }
      }
      worker.onerror = (e) => {
        const message = `The voice worker failed: ${e.message || 'unknown error'}`
        this.set({ state: 'error', error: message })
        reject(new Error(message))
      }
    })
    this.loading.catch(() => {})
    const wasmPaths = new URL(`${import.meta.env.BASE_URL}runtimes/ort/`, location.href).href
    worker.postMessage({ type: 'load', dtype, wasmPaths } satisfies KokoroIn)
    return this.loading
  }

  generate(text: string, voice: string, speed: number): Promise<GeneratedAudio> {
    if (!this.worker || !this.ready) return Promise.reject(new Error('The voice model is not loaded.'))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.worker!.postMessage({ type: 'generate', id, text, voice, speed } satisfies KokoroIn)
    })
  }

  unload() {
    this.worker?.terminate()
    this.worker = null
    this.loading = null
    for (const p of this.pending.values()) p.reject(new Error('The voice model was unloaded.'))
    this.pending.clear()
    this.set({ state: 'off', device: undefined })
  }
}

export const neural = new NeuralEngine()
;(globalThis as unknown as { __cbeNeural?: NeuralEngine }).__cbeNeural = neural

/** Float samples to a 16-bit mono WAV file, with a little silence before and after. */
export function encodeWav(samples: Float32Array, sampleRate: number, leadS = 0.15, tailS = 0.1): Blob {
  const lead = Math.round(leadS * sampleRate)
  const tail = Math.round(tailS * sampleRate)
  const n = lead + samples.length + tail
  const buf = new ArrayBuffer(44 + n * 2)
  const dv = new DataView(buf)
  const ascii = (o: number, s: string) => [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)))
  ascii(0, 'RIFF')
  dv.setUint32(4, 36 + n * 2, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  dv.setUint32(16, 16, true)
  dv.setUint16(20, 1, true)
  dv.setUint16(22, 1, true)
  dv.setUint32(24, sampleRate, true)
  dv.setUint32(28, sampleRate * 2, true)
  dv.setUint16(32, 2, true)
  dv.setUint16(34, 16, true)
  ascii(36, 'data')
  dv.setUint32(40, n * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]))
    dv.setInt16(44 + (lead + i) * 2, Math.round(v < 0 ? v * 0x8000 : v * 0x7fff), true)
  }
  return new Blob([buf], { type: 'audio/wav' })
}

/** Start loading the on-phone voice if the settings ask for it and it isn't loaded or loading yet. */
export function ensureNeural(s: { voiceEngine: string; neuralModel: 'off' | 'best' | 'small' }): void {
  if (s.voiceEngine !== 'neural' || s.neuralModel === 'off' || neural.status.state !== 'off') return
  void neural.load(s.neuralModel === 'best' ? 'fp32' : 'q8').catch(() => {})
}

