// Row comparison for SQL Sketch and Dictate (spec section 6): ignores row order unless the drill
// requires ORDER BY, and ignores column names. Floats are compared to 6 decimal places. If the
// columns are the same but in a different order, that still counts as a match.

export type Cell = string | number | null

export interface ResultSet {
  columns: string[]
  rows: unknown[][]
}

export interface CompareResult {
  equal: boolean
  learnerRows: number
  referenceRows: number
  learnerCols: number
  referenceCols: number
  /** A row the reference has but the learner doesn't (first one found). */
  missing?: Cell[]
  /** A row the learner has but the reference doesn't (first one found). */
  extra?: Cell[]
  /** Plain-words summary of the first difference, for the error explainer. */
  note: string
}

export function canonCell(v: unknown): Cell {
  if (v === null || v === undefined) return null
  if (typeof v === 'bigint') v = Number(v)
  if (typeof v === 'number') {
    const r = Math.round(v * 1e6) / 1e6
    return Object.is(r, -0) ? 0 : r
  }
  if (typeof v === 'boolean') return v ? 1 : 0
  if (v instanceof Uint8Array) return `blob:${Array.from(v).join(',')}`
  return String(v)
}

/** JSON in the same format Python's json.dumps uses, so hashes agree with the validator. */
export function pyJson(v: unknown): string {
  if (v === null) return 'null'
  if (Array.isArray(v)) return `[${v.map(pyJson).join(', ')}]`
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v)
  return JSON.stringify(v)
}

export function canonRows(rows: unknown[][], orderMatters: boolean): Cell[][] {
  const out = rows.map((r) => r.map(canonCell))
  if (!orderMatters) out.sort((a, b) => (pyJson(a) < pyJson(b) ? -1 : pyJson(a) > pyJson(b) ? 1 : 0))
  return out
}

function sameRows(a: Cell[][], b: Cell[][]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (pyJson(a[i]) !== pyJson(b[i])) return false
  return true
}

function permutations(n: number): number[][] {
  if (n <= 1) return [[0]]
  const out: number[][] = []
  const rec = (prefix: number[], rest: number[]) => {
    if (!rest.length) out.push(prefix)
    rest.forEach((x, i) => rec([...prefix, x], [...rest.slice(0, i), ...rest.slice(i + 1)]))
  }
  rec([], Array.from({ length: n }, (_, i) => i))
  return out
}

function fmtRow(r: Cell[]): string {
  return r.map((c) => (c === null ? 'null' : String(c))).join(', ')
}

export function compareRows(learner: ResultSet, reference: ResultSet, orderMatters: boolean): CompareResult {
  const lc = learner.rows[0]?.length ?? learner.columns.length
  const rc = reference.rows[0]?.length ?? reference.columns.length
  const base = { learnerRows: learner.rows.length, referenceRows: reference.rows.length, learnerCols: lc, referenceCols: rc }
  if (lc !== rc && learner.rows.length && reference.rows.length) {
    return { ...base, equal: false, note: `Your query returns ${lc} column${lc === 1 ? '' : 's'}; the answer has ${rc}.` }
  }
  const ref = canonRows(reference.rows, orderMatters)
  const perms = lc <= 5 ? permutations(lc) : [Array.from({ length: lc }, (_, i) => i)]
  for (const p of perms) {
    const mine = canonRows(
      learner.rows.map((r) => p.map((i) => r[i])),
      orderMatters,
    )
    if (sameRows(mine, ref)) return { ...base, equal: true, note: 'The rows match.' }
  }
  // describe the first difference (as multisets of rows)
  const mine = canonRows(learner.rows, orderMatters)
  const count = new Map<string, number>()
  for (const r of ref) count.set(pyJson(r), (count.get(pyJson(r)) ?? 0) + 1)
  let extra: Cell[] | undefined
  for (const r of mine) {
    const k = pyJson(r)
    const n = count.get(k) ?? 0
    if (n > 0) count.set(k, n - 1)
    else if (!extra) extra = r
  }
  let missing: Cell[] | undefined
  for (const r of ref) {
    if ((count.get(pyJson(r)) ?? 0) > 0) {
      missing = r
      break
    }
  }
  let note: string
  if (learner.rows.length !== reference.rows.length) {
    note = `Your query returns ${learner.rows.length} rows; the answer has ${reference.rows.length}.`
  } else if (!extra && !missing && orderMatters) {
    note = 'The rows are right but in the wrong order.'
  } else {
    note = 'Some rows differ from the answer.'
  }
  if (missing) note += ` Missing a row like: ${fmtRow(missing)}.`
  if (extra) note += ` Has an extra row like: ${fmtRow(extra)}.`
  return { ...base, equal: false, missing, extra, note }
}
