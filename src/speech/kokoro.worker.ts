// Runs the Kokoro neural voice on the phone (kokoro-js on Transformers.js / ONNX Runtime Web), off the
// main thread. The model downloads once from Hugging Face and stays in the browser cache.
import { env as hfEnv } from '@huggingface/transformers'
import { KokoroTTS } from 'kokoro-js'

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX'

export type KokoroIn =
  | { type: 'load'; dtype: 'fp32' | 'q8'; wasmPaths: string }
  | { type: 'generate'; id: number; text: string; voice: string; speed: number }

export type KokoroOut =
  | { type: 'progress'; file: string; loaded: number; total: number }
  | { type: 'ready'; device: 'webgpu' | 'wasm'; dtype: string; ms: number }
  | { type: 'audio'; id: number; samples: Float32Array; sampleRate: number; ms: number }
  | { type: 'error'; id?: number; message: string }

let tts: KokoroTTS | null = null
const scope = self as unknown as { postMessage(m: unknown, transfer?: Transferable[]): void; onmessage: ((e: MessageEvent<KokoroIn>) => void) | null }
const post = (m: KokoroOut, transfer: Transferable[] = []) => scope.postMessage(m, transfer)

async function hasWebGpu(): Promise<boolean> {
  try {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu
    return !!gpu && !!(await gpu.requestAdapter())
  } catch {
    return false
  }
}

scope.onmessage = async (e: MessageEvent<KokoroIn>) => {
  const m = e.data
  if (m.type === 'load') {
    const t0 = performance.now()
    try {
      hfEnv.allowLocalModels = false
      hfEnv.useBrowserCache = true
      const onnx = hfEnv.backends.onnx as { wasm?: { wasmPaths?: string; numThreads?: number } }
      if (onnx.wasm) {
        onnx.wasm.wasmPaths = m.wasmPaths
        onnx.wasm.numThreads = 1 // GitHub Pages can't enable cross-origin isolation, so no threads
      }
      // fp32 runs well on the GPU; on the CPU the smaller q8 model is the practical choice
      const device = m.dtype === 'fp32' && (await hasWebGpu()) ? 'webgpu' : 'wasm'
      tts = await KokoroTTS.from_pretrained(MODEL_ID, {
        dtype: m.dtype,
        device,
        progress_callback: (p: { status?: string; file?: string; loaded?: number; total?: number }) => {
          if (p.status === 'progress' && p.file) post({ type: 'progress', file: p.file, loaded: p.loaded ?? 0, total: p.total ?? 0 })
        },
      })
      post({ type: 'ready', device, dtype: m.dtype, ms: Math.round(performance.now() - t0) })
    } catch (err) {
      post({ type: 'error', message: `Could not load the voice model: ${(err as Error)?.message ?? err}` })
    }
    return
  }
  if (m.type === 'generate') {
    if (!tts) {
      post({ type: 'error', id: m.id, message: 'The voice model is not loaded.' })
      return
    }
    const t0 = performance.now()
    try {
      const audio = await tts.generate(m.text, { voice: m.voice as 'af_heart', speed: m.speed })
      const samples = audio.audio as Float32Array
      post({ type: 'audio', id: m.id, samples, sampleRate: audio.sampling_rate, ms: Math.round(performance.now() - t0) }, [samples.buffer])
    } catch (err) {
      post({ type: 'error', id: m.id, message: `Could not speak that: ${(err as Error)?.message ?? err}` })
    }
  }
}
