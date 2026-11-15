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
  ['edit at line 2 character 7', 'put the cursor there (the ruler under the line counts characters)', true],
  ['go to line 3', 'end of line 3, and hear it', true],
  ['after equals / before paren / after total', 'jump to the next one; "next match" for the one after', true],
  ['start of line / end of line / top / bottom', 'move there', true],
  ['left 3 / right 2 / up / down / word left', 'move by characters, lines or words', true],
  ['select word / select line / highlight total', 'what you say next replaces it', true],
  ['delete line / clear line / delete word', 'remove it', true],
  ['backspace three / delete two', 'remove characters before or after the cursor', true],
  ['indent / dedent', 'shift the line 4 spaces', true],
  ['undo (or scratch that) / redo', 'step back or forward one change', true],
  ['where am I / read line / spell line', 'hear the cursor, a line, or a line letter by letter', true],
  ['read it back', 'hear all the code', true],
  ['check', 'hear Python or SQLite say whether it parses', true],
  ['run it (or done)', 'run the tests or compare rows', true],
  ['keys mode / code mode', 'switch how words are typed', true],
  ['start over', 'clear everything', true],
]

const KEYS: Row[] = [
  ['v a r, or victor alpha romeo, or vest air red', 'var'],
  ['capital x / caps on ... caps off', 'X'],
  ['three / twenty five / number three (after a move)', '3 25 3'],
  ['equals / plus / colon / open paren ... (names below)', '= + : ('],
  ['space / tab / new line', 'nothing is added you didn’t say', true],
  ['backspace backspace / backspace three', 'remove characters', true],
  ['any other word', 'is typed as said: print', true],
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
        Say symbols by name. In Code mode, names from the task join by themselves, so "part id" writes part_id; new
        multi-word names need "snake". Python and SQLite errors show under the code as you go; say "hint" when you
        want one.
      </p>
      <Table title="Moving and editing (both modes)" rows={EDITS} />
      <Table title="Keys mode: every word is a keystroke" rows={KEYS} />
      <p class="small" style={{ marginTop: '12px' }}>Code mode: you say code in words and it's formatted for you.</p>
      <Table title="Structure" rows={lang === 'sql' ? STRUCTURE.filter(([s]) => !/brace|f quote|comment|back/.test(s)) : STRUCTURE} />
      <Table title="Operators" rows={lang === 'sql' ? OPERATORS.filter(([s]) => !/floor|plus equals/.test(s)) : OPERATORS} />
      {lang === 'sql' ? <Table title="SQL" rows={SQL} /> : <Table title="Names and values" rows={[...NAMES, ...PY_SHORT]} />}
      {lang === 'sql' && <Table title="Names and values" rows={NAMES.filter(([s]) => !/true|else if/.test(s))} />}
    </details>
  )
}
