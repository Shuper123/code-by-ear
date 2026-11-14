// Python (Pyodide) in a worker. The app terminates the worker if a run passes its time limit.
import HARNESS from './py_harness.py?raw'

interface PyodideLike {
  runPython(code: string): unknown
  globals: { get(name: string): (...args: unknown[]) => string }
}
interface Msg {
  id: number
  kind: 'load' | 'tests' | 'run'
  indexURL: string
  code?: string
  fn?: string
  tests?: unknown[]
}

const ctx = self as unknown as { postMessage(m: unknown): void; onmessage: ((e: MessageEvent<Msg>) => void) | null }
let loading: Promise<PyodideLike> | null = null

function ensure(indexURL: string): Promise<PyodideLike> {
  if (!loading) {
    loading = (async () => {
      const mod = (await import(/* @vite-ignore */ `${indexURL}pyodide.mjs`)) as {
        loadPyodide(o: { indexURL: string; stdout?: (s: string) => void; stderr?: (s: string) => void }): Promise<PyodideLike>
      }
      const py = await mod.loadPyodide({ indexURL, stdout: () => {}, stderr: () => {} })
      py.runPython(HARNESS)
      return py
    })()
    loading.catch(() => {
      loading = null
    })
  }
  return loading
}

ctx.onmessage = async (e) => {
  const { id, kind, indexURL } = e.data
  try {
    const py = await ensure(indexURL)
    if (kind === 'load') {
      ctx.postMessage({ id, ok: true })
    } else if (kind === 'tests') {
      const out = py.globals.get('run_tests_json')(e.data.code ?? '', e.data.fn ?? '', JSON.stringify(e.data.tests ?? []))
      ctx.postMessage({ id, ok: true, result: JSON.parse(out) })
    } else {
      const out = py.globals.get('run_code_json')(e.data.code ?? '')
      ctx.postMessage({ id, ok: true, result: JSON.parse(out) })
    }
  } catch (err) {
    ctx.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}
