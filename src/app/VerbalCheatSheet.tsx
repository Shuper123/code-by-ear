// Verbal Syntax quick reference (spec section 9), folded under the code while dictating in Parked.
import type { VLang } from '../verbal/syntax'

type Row = [say: string, writes: string, plain?: boolean]

const STRUCTURE: Row[] = [
  ['next (or new line)', 'new line, indented after a colon', true],
  ['back / back back', 'remove 1 or 2 indent levels', true],
  ['colon / comma / dot', ': , .'],
  ['open paren / close paren / empty parens', '( ) ()'],
  ['open bracket / close bracket / empty list', '[ ] []'],
  ['open brace / close brace / empty dict', '{ } {}'],
  ['quote ... end quote', '"..."  (SQL: \'...\')'],
  ['f quote ... end quote, value of x', 'f"...{x}..."'],
  ['comment ... end comment', '# ...'],
]
const OPERATORS: Row[] = [
  ['equals', '='],
  ['is equal to / double equals', '=='],
  ['not equal to', '!='],
  ['greater than / less than', '> <'],
  ['at least / at most', '>= <='],
  ['plus / minus / times / divided by', '+ - * /'],
  ['floor divide / mod / to the power', '// % **'],
  ['plus equals / minus equals', '+= -='],
]
const NAMES: Row[] = [
  ['snake total cost', 'total_cost'],
  ['camel total cost', 'totalCost'],
  ['cap name', 'Name'],
  ['spell d f done (letters or NATO words)', 'df'],
  ['twenty five / three point five / negative two', '25 3.5 -2'],
  ['true / false / none', 'True False None'],
  ['else if', 'elif'],
]
const SQL: Row[] = [
  ['group by, order by, descending', 'GROUP BY, ORDER BY, DESC'],
  ['star / count star', '* / COUNT(*)'],
  ['lots dot part id', 'lots.part_id'],
  ['sum of qty (also count, avg, min, max)', 'SUM(qty)'],
]
const PY_SHORT: Row[] = [['len of nums (also sum, sorted, max, min, int, str)', 'len(nums)']]
const EDITS: Row[] = [
  ['scratch that', 'undo your last utterance', true],
  ['delete line', 'remove the current line', true],
  ['go to line 3', 'move the cursor', true],
  ['read it back / read line', 'hear the code', true],
  ['run it (or done)', 'check it and run the tests', true],
  ['start over', 'clear everything', true],
]

function Table({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <>
      <div class="step" style={{ marginTop: '12px' }}>
        {title}
      </div>
      <table class="unit-table">
        <tbody>
          {rows.map(([say, writes, plain]) => (
            <tr key={say}>
              <td>{say}</td>
              <td>{plain ? <span class="small">{writes}</span> : <code>{writes}</code>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

export function VerbalCheatSheet({ lang }: { lang: VLang }) {
  return (
    <details class="card cheat-sheet">
      <summary>Verbal Syntax cheat sheet</summary>
      <p class="small">
        Say symbols by name. Names from the task join by themselves, so "part id" writes part_id. New multi-word names
        need "snake".
      </p>
      <Table title="Edit commands" rows={EDITS} />
      <Table title="Structure" rows={lang === 'sql' ? STRUCTURE.filter(([s]) => !/brace|f quote|comment|back/.test(s)) : STRUCTURE} />
      <Table title="Operators" rows={lang === 'sql' ? OPERATORS.filter(([s]) => !/floor|plus equals/.test(s)) : OPERATORS} />
      {lang === 'sql' ? <Table title="SQL" rows={SQL} /> : <Table title="Names and values" rows={[...NAMES, ...PY_SHORT]} />}
      {lang === 'sql' && <Table title="Names and values" rows={NAMES.filter(([s]) => !/true|else if/.test(s))} />}
    </details>
  )
}
