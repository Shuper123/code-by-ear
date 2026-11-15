// What the build loop knows about a practice database: its tables and columns (from schema.json) and
// the text values stored in them (read once from the database itself), so spoken values can be written
// the way the data has them.
import schemaJson from '../data/datasets/schema.json'
import type { DatasetName } from '../data/types'
import type { SqlRunResult } from '../runtimes/sql'
import type { BuildSchema } from './parse'

interface SchemaEntry {
  table: string
  columns: string[]
  spoken: string
}

export function tablesOf(dataset: DatasetName | undefined): SchemaEntry[] {
  return (schemaJson as Record<string, SchemaEntry[]>)[dataset ?? ''] ?? []
}

type RunSql = (dataset: DatasetName | undefined, sql: string) => Promise<SqlRunResult>

const cache = new Map<string, Promise<BuildSchema>>()
const MAX_VALUES = 60
const DATE = /^\d{4}-\d{2}-\d{2}$/

async function load(dataset: DatasetName | undefined, runSql: RunSql): Promise<BuildSchema> {
  const tables = tablesOf(dataset).map((t) => ({ name: t.table, columns: t.columns }))
  const schema: BuildSchema = { tables, values: {}, year: new Date().getFullYear() }
  if (!tables.length) return schema
  const types = await runSql(dataset, tables.map((t) => `SELECT '${t.name}', name, type FROM pragma_table_info('${t.name}')`).join(' UNION ALL '))
  if (!types.ok) return schema
  const textCols = types.rows.filter((r) => /TEXT|CHAR/i.test(String(r[2]))).map((r) => ({ table: String(r[0]), column: String(r[1]) }))
  if (!textCols.length) return schema
  const values = await runSql(
    dataset,
    textCols.map((c) => `SELECT '${c.column}', ${c.column} FROM ${c.table} WHERE ${c.column} IS NOT NULL GROUP BY ${c.column}`).join(' UNION ALL '),
  )
  if (!values.ok) return schema
  const byCol = new Map<string, Set<string>>()
  for (const [c, v] of values.rows) {
    const set = byCol.get(String(c)) ?? new Set<string>()
    set.add(String(v))
    byCol.set(String(c), set)
  }
  let year: number | null = null
  for (const [c, set] of byCol) {
    const list = [...set]
    if (list.every((v) => DATE.test(v))) {
      // a date column: keep its year for dates said without one
      const y = Number(list.sort()[list.length - 1].slice(0, 4))
      year = year === null ? y : Math.max(year, y)
      continue
    }
    if (list.length <= MAX_VALUES) schema.values[c] = list.sort()
  }
  if (year !== null) schema.year = year
  return schema
}

/** Tables, columns and stored text values of a dataset; read once per dataset. */
export function loadBuildSchema(dataset: DatasetName | undefined, runSql: RunSql): Promise<BuildSchema> {
  const key = dataset ?? ''
  let p = cache.get(key)
  if (!p) {
    p = load(dataset, runSql).catch(() => ({ tables: tablesOf(dataset).map((t) => ({ name: t.table, columns: t.columns })), values: {}, year: new Date().getFullYear() }))
    cache.set(key, p)
  }
  return p
}

function list(words: string[]): string {
  if (words.length <= 1) return words.join('')
  if (words.length === 2) return `${words[0]} and ${words[1]}`
  return `${words.slice(0, -1).join(', ')}, and ${words[words.length - 1]}`
}

/** "The tables are parts, machines, lots, defects, and defect codes." */
export function sayTables(dataset: DatasetName | undefined): string {
  const names = tablesOf(dataset).map((t) => t.table.replace(/_/g, ' '))
  return names.length ? `The tables are ${list(names)}.` : 'There are no tables.'
}

/** "The lots table has lot id, part id, machine id, produced on, quantity, and shift." */
export function sayColumns(dataset: DatasetName | undefined, table: string): string {
  return tablesOf(dataset).find((t) => t.table === table)?.spoken ?? `There's no table called ${table.replace(/_/g, ' ')}.`
}
