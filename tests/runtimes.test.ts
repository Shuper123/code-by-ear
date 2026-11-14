// The in-app engines (sql.js, Pyodide) must agree with the validator's engines (SQLite, CPython).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadDrills } from './helpers'
import { nodeRunPyTests, nodeRunSql, rowsHash } from './nodeRunners'

const drills = loadDrills()
const hashes = JSON.parse(readFileSync(join(__dirname, '..', 'src', 'data', 'reference_hashes.json'), 'utf8')) as Record<
  string,
  { hash: string; rows: number }
>

describe('sql.js agrees with the validator', () => {
  const sqlRefs = drills.filter((d) => d.lang === 'sql' && (d.type === 'sketch' || d.type === 'dictate'))
  it('has SQL references to check', () => expect(sqlRefs.length).toBeGreaterThanOrEqual(24))
  for (const d of sqlRefs) {
    it(`${d.id}: same rows hash as Python's sqlite3`, async () => {
      const r = await nodeRunSql(d.dataset, d.reference!)
      expect(r.ok).toBe(true)
      if (!r.ok) return
      expect(rowsHash(r.rows, !!d.order_matters)).toBe(hashes[d.id].hash)
      expect(r.rows.length).toBe(hashes[d.id].rows)
    })
  }
  it('every SQL Predict drill gives the same answer in sql.js', async () => {
    for (const d of drills.filter((x) => x.lang === 'sql' && x.type === 'predict')) {
      const r = await nodeRunSql(d.dataset, d.code!)
      expect(r.ok, d.id).toBe(true)
    }
  })
})

describe('Pyodide runs the test harness', () => {
  const pyRefs = drills.filter((d) => d.lang === 'python' && d.type === 'sketch')
  it('has Python references to check', () => expect(pyRefs.length).toBeGreaterThanOrEqual(12))
  it('every Python reference passes its tests in Pyodide', async () => {
    for (const d of pyRefs) {
      const r = await nodeRunPyTests(d.reference!, d.function_name!, d.tests!)
      expect(r.error, d.id).toBeNull()
      expect(r.ok, d.id).toBe(true)
    }
  }, 60000)
  it('reports a failing test with the input, expected and actual values', async () => {
    const r = await nodeRunPyTests('def double(x):\n    return x + 2\n', 'double', [
      { args: [2], expected: 4 },
      { args: [3], expected: 6 },
    ])
    expect(r.ok).toBe(false)
    expect(r.results[0].ok).toBe(true)
    expect(r.results[1]).toMatchObject({ ok: false, expected: 6, got: 5 })
  }, 60000)
  it('reports syntax errors and missing functions', async () => {
    expect((await nodeRunPyTests('def f(:\n  pass', 'f', [])).error).toMatch(/SyntaxError/)
    expect((await nodeRunPyTests('def g():\n  return 1', 'f', [])).error).toMatch(/not defined/)
  }, 60000)
})
