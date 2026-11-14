// SQLite in a worker (sql.js), so a runaway query can be stopped by terminating the worker.
import initSqlJs from 'sql.js'
import type { SqlJsStatic } from 'sql.js'

interface RunMsg {
  id: number
  wasmUrl: string
  datasetSql: string
  sql: string
}

const ctx = self as unknown as { postMessage(m: unknown): void; onmessage: ((e: MessageEvent<RunMsg>) => void) | null }
let SQL: Promise<SqlJsStatic> | null = null

ctx.onmessage = async (e) => {
  const { id, wasmUrl, datasetSql, sql } = e.data
  try {
    if (!SQL) SQL = initSqlJs({ locateFile: () => wasmUrl })
    const lib = await SQL
    const db = new lib.Database()
    try {
      if (datasetSql) db.exec(datasetSql)
      const res = db.exec(sql)
      const last = res[res.length - 1] ?? { columns: [], values: [] }
      ctx.postMessage({ id, ok: true, columns: last.columns, rows: last.values })
    } finally {
      db.close()
    }
  } catch (err) {
    ctx.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}
