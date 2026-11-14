// Run a query on a fresh copy of a practice dataset, in a worker, with a time limit.
import factorySql from '../data/datasets/factory.sql?raw'
import shopSql from '../data/datasets/shop.sql?raw'
import type { DatasetName } from '../data/types'

export const DATASET_SQL: Record<DatasetName, string> = { factory: factorySql, shop: shopSql }

export type SqlRunResult =
  | { ok: true; columns: string[]; rows: unknown[][] }
  | { ok: false; error: string; timeout?: boolean }

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, (r: SqlRunResult) => void>()

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./sql.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<{ id: number } & SqlRunResult>) => {
      const cb = pending.get(e.data.id)
      if (!cb) return
      pending.delete(e.data.id)
      const { id: _id, ...rest } = e.data
      cb(rest as SqlRunResult)
    }
    worker.onerror = (e) => {
      for (const cb of pending.values()) cb({ ok: false, error: `SQL worker failed: ${e.message}` })
      pending.clear()
      worker?.terminate()
      worker = null
    }
  }
  return worker
}

function wasmUrl(): string {
  return new URL(`${import.meta.env.BASE_URL}runtimes/sql-wasm.wasm`, location.href).href
}

export function runSql(dataset: DatasetName | undefined, sql: string, timeoutMs = 3000): Promise<SqlRunResult> {
  const w = getWorker()
  const id = nextId++
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (!pending.has(id)) return
      pending.delete(id)
      // stop the runaway query; the next call starts a fresh worker
      w.terminate()
      if (worker === w) worker = null
      for (const cb of pending.values()) cb({ ok: false, error: 'stopped', timeout: true })
      pending.clear()
      resolve({ ok: false, error: `The query ran longer than ${timeoutMs / 1000} seconds and was stopped.`, timeout: true })
    }, timeoutMs)
    pending.set(id, (r) => {
      clearTimeout(timer)
      resolve(r)
    })
    w.postMessage({ id, wasmUrl: wasmUrl(), datasetSql: dataset ? DATASET_SQL[dataset] : '', sql })
  })
}
