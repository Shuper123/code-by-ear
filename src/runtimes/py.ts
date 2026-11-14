// Python runner: Pyodide in a worker, loaded on first use (several megabytes, cached by the service
// worker after the first download). Each test run has a 3-second limit; a run that passes it is
// killed by terminating the worker, and the next run loads a fresh one.
import type { PyTest } from '../data/types'

export interface PyTestCase {
  args: unknown[]
  expected: unknown
  got?: unknown
  error?: string
  ok: boolean
}
export interface PyTestsResult {
  ok: boolean // every test passed
  error: string | null // code failed to run at all (syntax error, missing function, timeout)
  timeout?: boolean
  stdout?: string
  results: PyTestCase[]
}

let worker: Worker | null = null
let ready = false
let loadPromise: Promise<void> | null = null
let nextId = 1
const pending = new Map<number, (r: { ok: boolean; error?: string; result?: unknown }) => void>()
const listeners = new Set<() => void>()

export function pythonState(): 'idle' | 'loading' | 'ready' {
  return ready ? 'ready' : loadPromise ? 'loading' : 'idle'
}
export function onPythonState(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
const notify = () => listeners.forEach((f) => f())

function indexURL(): string {
  return new URL(`${import.meta.env.BASE_URL}runtimes/pyodide/`, location.href).href
}

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./py.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; error?: string; result?: unknown }>) => {
      const cb = pending.get(e.data.id)
      if (!cb) return
      pending.delete(e.data.id)
      cb(e.data)
    }
    worker.onerror = (e) => {
      for (const cb of pending.values()) cb({ ok: false, error: `Python worker failed: ${e.message}` })
      pending.clear()
      kill()
    }
  }
  return worker
}

function kill() {
  worker?.terminate()
  worker = null
  ready = false
  loadPromise = null
  notify()
}

function send(msg: Record<string, unknown>): Promise<{ ok: boolean; error?: string; result?: unknown }> {
  const w = getWorker()
  const id = nextId++
  return new Promise((resolve) => {
    pending.set(id, resolve)
    w.postMessage({ id, indexURL: indexURL(), ...msg })
  })
}

/** Load Pyodide (no time limit beyond 120 s; the first download can be slow on mobile data). */
export function loadPython(): Promise<void> {
  if (ready) return Promise.resolve()
  if (!loadPromise) {
    loadPromise = (async () => {
      const r = await Promise.race([
        send({ kind: 'load' }),
        new Promise<{ ok: false; error: string }>((res) => setTimeout(() => res({ ok: false, error: 'Python took too long to load.' }), 120000)),
      ])
      if (!r.ok) {
        kill()
        throw new Error(r.error ?? 'Python failed to load')
      }
      ready = true
      notify()
    })()
    notify()
  }
  return loadPromise
}

async function timed(msg: Record<string, unknown>, timeoutMs: number) {
  await loadPython()
  return Promise.race([
    send(msg),
    new Promise<{ ok: false; error: string; timeout: true }>((res) =>
      setTimeout(() => {
        kill() // stop the runaway code; the next run reloads Python
        res({ ok: false, error: `The code ran longer than ${timeoutMs / 1000} seconds and was stopped.`, timeout: true })
      }, timeoutMs),
    ),
  ])
}

export async function runPythonTests(code: string, fn: string, tests: PyTest[], timeoutMs = 3000): Promise<PyTestsResult> {
  try {
    const r = (await timed({ kind: 'tests', code, fn, tests }, timeoutMs)) as {
      ok: boolean
      error?: string
      timeout?: boolean
      result?: { ok: boolean; error: string | null; stdout: string; results: PyTestCase[] }
    }
    if (!r.ok || !r.result) return { ok: false, error: r.error ?? 'Python run failed', timeout: r.timeout, results: [] }
    return { ok: r.result.ok, error: r.result.error, stdout: r.result.stdout, results: r.result.results }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), results: [] }
  }
}

/** Download Pyodide in the background so the first Python Sketch doesn't wait (spec section 16). */
export async function warmPythonCache(): Promise<boolean> {
  try {
    if (!('caches' in self)) return false
    const base = indexURL()
    const files = ['pyodide.mjs', 'pyodide.asm.js', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json']
    for (const f of files) {
      if (await caches.match(base + f)) continue
      await fetch(base + f) // the service worker caches /runtimes/pyodide/ on the way through
    }
    return true
  } catch {
    return false
  }
}
