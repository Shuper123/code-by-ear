// Real sql.js and real Pyodide, run in Node, for integration tests.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import type { DatasetName, PyTest } from '../src/data/types'
import type { Runners } from '../src/engine/sketch'
import { canonRows, pyJson } from '../src/grading/sqlCompare'
import type { PyTestsResult } from '../src/runtimes/py'
import type { SqlRunResult } from '../src/runtimes/sql'

const ROOT = join(__dirname, '..')
let SQL: Promise<SqlJsStatic> | null = null
const datasets: Record<string, string> = {}

export function datasetSql(name: DatasetName): string {
  if (!datasets[name]) datasets[name] = readFileSync(join(ROOT, 'src', 'data', 'datasets', `${name}.sql`), 'utf8')
  return datasets[name]
}

export async function nodeRunSql(dataset: DatasetName | undefined, sql: string): Promise<SqlRunResult> {
  if (!SQL) SQL = initSqlJs({ locateFile: (f: string) => join(ROOT, 'node_modules', 'sql.js', 'dist', f) })
  const lib = await SQL
  const db = new lib.Database()
  try {
    if (dataset) db.exec(datasetSql(dataset))
    const res = db.exec(sql)
    const last = res[res.length - 1] ?? { columns: [], values: [] }
    return { ok: true, columns: last.columns, rows: last.values }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  } finally {
    db.close()
  }
}

export function rowsHash(rows: unknown[][], orderMatters: boolean): string {
  return createHash('sha256').update(pyJson(canonRows(rows, orderMatters))).digest('hex').slice(0, 16)
}

interface PyodideLike {
  runPython(code: string): unknown
  globals: { get(name: string): (...args: unknown[]) => string }
}
let py: Promise<PyodideLike> | null = null

export async function pyodide(): Promise<PyodideLike> {
  if (!py) {
    py = (async () => {
      const { loadPyodide } = await import('pyodide')
      const indexURL = `${join(ROOT, 'node_modules', 'pyodide')}/`
      const p = (await loadPyodide({ indexURL, stdout: () => {}, stderr: () => {} })) as unknown as PyodideLike
      p.runPython(readFileSync(join(ROOT, 'src', 'runtimes', 'py_harness.py'), 'utf8'))
      return p
    })()
  }
  return py
}

export async function nodeRunPyTests(code: string, fn: string, tests: PyTest[]): Promise<PyTestsResult> {
  const p = await pyodide()
  const out = JSON.parse(p.globals.get('run_tests_json')(code, fn, JSON.stringify(tests))) as {
    ok: boolean
    error: string | null
    stdout: string
    results: PyTestsResult['results']
  }
  return { ok: out.ok, error: out.error, stdout: out.stdout, results: out.results }
}

export const nodeRunners: Runners = {
  runSql: nodeRunSql,
  runPyTests: nodeRunPyTests,
  pythonReady: () => true,
  preloadPython: () => {},
}
