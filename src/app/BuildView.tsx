// The query being built by voice, on the Parked screen: the SQL with the clause that just changed marked,
// SQLite's error or the first rows of the result, and how it compares with the answer. Also the result
// table and the schema reference that typed mode shares.
import { tablesOf } from '../build/schema'
import { SHOWN_ROWS, type BuildSnapshot } from '../build/view'
import type { DatasetName } from '../data/types'

function cell(v: unknown): string {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number' && !Number.isInteger(v)) return String(Math.round(v * 10000) / 10000)
  return String(v)
}

export function ResultTable({ columns, rows, total }: { columns: string[]; rows: unknown[][]; total: number }) {
  if (!total) return <p class="muted small">No rows.</p>
  return (
    <div class="rows-wrap">
      <table class="rows">
        <thead>
          <tr>
            {columns.map((c) => (
              <th>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr>
              {r.map((v) => (
                <td class={v === null || v === undefined ? 'muted' : ''}>{cell(v)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {total > rows.length && <p class="faint">…and {total - rows.length} more</p>}
    </div>
  )
}

/** The tables and their columns, folded away until asked for. */
export function SchemaCard({ dataset, open }: { dataset: DatasetName | undefined; open?: boolean }) {
  const tables = tablesOf(dataset)
  if (!tables.length) return null
  return (
    <details class="card cheat-sheet" open={open}>
      <summary>Tables and columns</summary>
      {tables.map((t) => (
        <p class="schema-line">
          <strong>{t.table}</strong> <span class="muted">{t.columns.join(', ')}</span>
        </p>
      ))}
    </details>
  )
}

export function BuildView({ snap }: { snap: BuildSnapshot }) {
  return (
    <div class="card">
      <div class="step">
        Your query{snap.steps ? ` · ${snap.steps} step${snap.steps === 1 ? '' : 's'}` : ''}
        {snap.status && <span class={`pill ${snap.matched ? 'ok' : ''}`} style={{ marginLeft: '8px' }}>{snap.status}</span>}
      </div>
      <div class="code build-sql" style={{ marginTop: '8px' }}>
        {snap.lines.length ? (
          snap.lines.map((l) => <div class={`build-line${l.changed ? ' changed' : ''}`}>{l.text}</div>)
        ) : (
          <span class="muted">Say a clause to start, like: from lots</span>
        )}
      </div>
      {snap.error && <p class="ed-error">{snap.error}</p>}
      {snap.result && <ResultTable columns={snap.result.columns} rows={snap.result.rows} total={snap.result.total} />}
      {snap.result && snap.result.total > SHOWN_ROWS && <p class="faint">Say results to hear the first rows.</p>}
    </div>
  )
}

const HOW: [string, string][] = [
  ['from lots', 'FROM lots'],
  ['join defects using lot id', 'JOIN defects USING (lot_id)'],
  ['left join parts on parts dot part id equals lots dot part id', 'LEFT JOIN parts ON parts.part_id = lots.part_id'],
  ['where shift equals night and quantity greater than 400', "WHERE shift = 'night' AND qty > 400"],
  ['where shift is null', 'WHERE shift IS NULL'],
  ['at least / at most / not equal to / over 400 / under 150', '>= / <= / != / > 400 / < 150'],
  ['where produced on between February 1st 2026 and February 28th 2026', "BETWEEN '2026-02-01' AND '2026-02-28'"],
  ['where category in cosmetic comma structural', "IN ('cosmetic', 'structural')"],
  ['select machine id, sum of quantity as total', 'SELECT machine_id, SUM(qty) AS total'],
  ['count star / count distinct part id', 'COUNT(*) / COUNT(DISTINCT part_id)'],
  ['group by machine id', 'GROUP BY machine_id'],
  ['having count star greater than 10', 'HAVING COUNT(*) > 10'],
  ['order by total descending', 'ORDER BY total DESC'],
  ['limit 3', 'LIMIT 3'],
  ['rank over partition by machine id order by quantity descending as r', 'RANK() OVER (PARTITION BY machine_id ORDER BY qty DESC) AS r'],
  ['case when quantity less than 150 then small else large end as size', "CASE WHEN qty < 150 THEN 'small' ELSE 'large' END AS size"],
  ['sum of open paren quantity times unit cost close paren', 'SUM(qty * unit_cost): say the parentheses when a function takes more than one name'],
  ['open paren select ... close paren', 'a subquery'],
]
const FIX: [string, string][] = [
  ['say a clause again', 'replaces it'],
  ['and ... / comma ...', 'adds to the clause you said last'],
  ['a pause in the middle of a clause', 'the app says "Go on" and waits for the rest'],
  ['undo / redo', 'one step back or forward'],
  ['remove where (or order by, limit, join ...)', 'drops that clause'],
  ['name it ranked', 'saves the query so far as a step; the next query reads from it'],
  ['start over', 'clears everything'],
]
const ASK: [string, string][] = [
  ['tables / columns of lots', 'what is in the database'],
  ['results', 'the first rows, read out'],
  ['compare', 'how your rows differ from the answer'],
  ['read it back', 'the whole query, in order'],
  ['hint / show me', 'a nudge, or one way to do it'],
]

function Rows({ rows }: { rows: [string, string][] }) {
  return (
    <table class="cheat">
      <tbody>
        {rows.map(([say, means]) => (
          <tr>
            <td>{say}</td>
            <td>
              <code>{means}</code>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** How to say clauses and commands in the build loop, folded under the query. */
export function BuildCheatSheet() {
  return (
    <details class="card cheat-sheet">
      <summary>How to say it</summary>
      <p class="faint">One clause at a time, in any order. The app types the punctuation and runs the query after each step.</p>
      <h3>Clauses</h3>
      <Rows rows={HOW} />
      <h3>Fixing</h3>
      <Rows rows={FIX} />
      <h3>Asking</h3>
      <Rows rows={ASK} />
    </details>
  )
}
