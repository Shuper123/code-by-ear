// Verbal Syntax: utterance-to-code tests (spec section 9 asks for at least 60, including both worked examples).
import { describe, expect, it } from 'vitest'
import { compareRows } from '../src/grading/sqlCompare'
import {
  applyEdit,
  dictate,
  editDistance,
  emptyDoc,
  parseEdit,
  render,
  soundex,
  speakDoc,
  speakLine,
  verbalToCode,
  type Doc,
} from '../src/verbal/syntax'
import { loadDrills } from './helpers'
import { nodeRunPyTests, nodeRunSql } from './nodeRunners'

const py = (u: string, vocab: string[] = []) => verbalToCode(u, 'python', vocab)
const FACTORY = ['lots', 'parts', 'machines', 'defects', 'part_id', 'part_name', 'unit_cost', 'line', 'lot_id', 'qty', 'machine_id', 'shift', 'defect_code']
const sql = (u: string, vocab: string[] = FACTORY) => verbalToCode(u, 'sql', vocab)

const EXAMPLE_1 =
  'def snake sum evens open paren nums close paren colon next total equals zero next for n in nums colon next if n mod two is equal to zero colon next total plus equals n next back back return total'
const EXAMPLE_1_CODE = `def sum_evens(nums):
    total = 0
    for n in nums:
        if n % 2 == 0:
            total += n
    return total`
const EXAMPLE_2 =
  'select part id comma sum open paren qty close paren as total from lots group by part id order by total descending limit three'
const EXAMPLE_2_CODE = 'SELECT part_id, SUM(qty) AS total FROM lots GROUP BY part_id ORDER BY total DESC LIMIT 3'

describe('worked examples (spec section 9)', () => {
  it('Python: sum evens', () => expect(py(EXAMPLE_1)).toBe(EXAMPLE_1_CODE))
  it('SQL: totals per part', () => expect(sql(EXAMPLE_2, ['lots', 'part_id', 'qty'])).toBe(EXAMPLE_2_CODE))
})

const PY_CASES: [string, string, string[]?][] = [
  ['x equals five', 'x = 5'],
  ['x equals x plus one', 'x = x + 1'],
  ['total plus equals n', 'total += n'],
  ['count minus equals one', 'count -= 1'],
  ['if x is equal to five colon', 'if x == 5:'],
  ['if x double equals five colon', 'if x == 5:'],
  ['if x not equal to y colon', 'if x != y:'],
  ['if x at least ten colon', 'if x >= 10:'],
  ['if x at most ten colon', 'if x <= 10:'],
  ['while n less than ten colon', 'while n < 10:'],
  ['if n greater than limit colon', 'if n > limit:'],
  ['y equals a times b', 'y = a * b'],
  ['y equals a divided by b', 'y = a / b'],
  ['y equals a floor divide b', 'y = a // b'],
  ['y equals a mod two', 'y = a % 2'],
  ['y equals two to the power three', 'y = 2 ** 3'],
  ['x equals twenty five', 'x = 25'],
  ['x equals three point five', 'x = 3.5'],
  ['x equals negative two', 'x = -2'],
  ['x equals minus y', 'x = -y'],
  ['x equals true', 'x = True'],
  ['x equals false', 'x = False'],
  ['x equals none', 'x = None'],
  ['snake total cost equals zero', 'total_cost = 0'],
  ['camel total cost equals zero', 'totalCost = 0'],
  ['cap name equals one', 'Name = 1'],
  ['spell d f done equals zero', 'df = 0'],
  ['spell delta foxtrot done', 'df'],
  ['print open paren quote hello world end quote close paren', 'print("hello world")'],
  ['print open paren f quote lot has value of qty parts end quote close paren', 'print(f"lot has {qty} parts")', ['qty']],
  ['nums equals open bracket three comma one comma two close bracket', 'nums = [3, 1, 2]'],
  ['nums equals empty list', 'nums = []'],
  ['counts equals empty dict', 'counts = {}'],
  ['d equals open brace quote a end quote colon one close brace', 'd = {"a": 1}'],
  ['print open paren nums open bracket one colon three close bracket close paren', 'print(nums[1:3])'],
  ['return items open bracket one colon minus one close bracket', 'return items[1:-1]'],
  ['nums dot sort empty parens', 'nums.sort()'],
  ['nums dot append open paren four close paren', 'nums.append(4)'],
  ['return sorted open paren nums comma reverse equals true close paren', 'return sorted(nums, reverse=True)'],
  ['else if x colon', 'elif x:'],
  ['for each n in nums colon', 'for n in nums:'],
  ['for i in range of len of nums colon', 'for i in range(len(nums)):'],
  ['total equals sum of nums divided by len of nums', 'total = sum(nums) / len(nums)'],
  ['x equals y comment the count end comment', 'x = y  # the count'],
  ['comment check the total end comment', '# check the total'],
  ['return x is none', 'return x is None'],
  ['if not nums colon', 'if not nums:'],
  ['print open paren quote dash end quote close paren', 'print("-")'],
  ['x equals quote hi symbol comma there end quote', 'x = "hi, there"'],
  ['key equals lambda x colon x times two', 'key = lambda x: x * 2'],
  ['return name dot upper empty parens plus quote dash end quote plus line', 'return name.upper() + "-" + line', ['name', 'line']],
  ['x equals empty string', 'x = ""'],
]

describe('Python utterances', () => {
  for (const [said, code, vocab] of PY_CASES) it(`"${said}"`, () => expect(py(said, vocab)).toBe(code))
  it('indents after a colon and dedents with back', () => {
    expect(py('if x colon next y equals one next back else colon next y equals two')).toBe('if x:\n    y = 1\nelse:\n    y = 2')
    expect(py('def f empty parens colon next return one')).toBe('def f():\n    return 1')
    expect(py('if x colon next pass')).toBe('if x:\n    pass')
  })
  it('handles try and except with a vocabulary exception name', () => {
    expect(py('try colon next x equals int of s next back except value error colon next pass', ['ValueError'])).toBe(
      'try:\n    x = int(s)\nexcept ValueError:\n    pass',
    )
  })
})

describe('vocabulary matching', () => {
  it('joins known multi-word names', () => {
    expect(py('def count above open paren nums comma limit close paren colon', ['count_above', 'nums', 'limit'])).toBe(
      'def count_above(nums, limit):',
    )
    expect(py('x equals part id', ['part_id'])).toBe('x = part_id')
    expect(py('x equals partid', ['part_id'])).toBe('x = part_id')
  })
  it('fuzzy-matches recognition errors (edit distance)', () => expect(py('for n in numbs colon', ['nums'])).toBe('for n in nums:'))
  it('matches spelled letters and aliases', () => {
    expect(py('total equals q t y', ['qty'])).toBe('total = qty')
    expect(py('total equals quantity', ['qty'])).toBe('total = qty')
  })
  it('never lets a fuzzy name override a keyword', () => expect(py('for n in nums colon', ['id', 'nums'])).toBe('for n in nums:'))
  it('edit distance and sounds-alike helpers', () => {
    expect(editDistance('numbs', 'nums')).toBe(1)
    expect(editDistance('kitten', 'sitting')).toBe(3)
    expect(soundex('Robert')).toBe(soundex('Rupert'))
  })
})

const SQL_CASES: [string, string][] = [
  ['select star from lots', 'SELECT * FROM lots'],
  ['select count star from lots', 'SELECT COUNT(*) FROM lots'],
  ['select part name comma unit cost from parts where line equals quote A end quote order by unit cost descending',
    "SELECT part_name, unit_cost FROM parts WHERE line = 'A' ORDER BY unit_cost DESC"],
  ['select lot id from lots where shift is null', 'SELECT lot_id FROM lots WHERE shift IS NULL'],
  ['select lot id from lots where shift is not null', 'SELECT lot_id FROM lots WHERE shift IS NOT NULL'],
  ['select part id comma sum of qty from lots group by part id', 'SELECT part_id, SUM(qty) FROM lots GROUP BY part_id'],
  ['select l dot lot id comma p dot part name from lots l join parts p on p dot part id equals l dot part id',
    'SELECT l.lot_id, p.part_name FROM lots l JOIN parts p ON p.part_id = l.part_id'],
  ['select machine id comma count of l dot lot id from machines m left join lots l on l dot machine id equals m dot machine id group by m dot machine id',
    'SELECT machine_id, COUNT(l.lot_id) FROM machines m LEFT JOIN lots l ON l.machine_id = m.machine_id GROUP BY m.machine_id'],
  ['select lot id from lots where qty between ten and twenty', 'SELECT lot_id FROM lots WHERE qty BETWEEN 10 AND 20'],
  ['select part name from parts where line in open paren quote A end quote comma quote C end quote close paren',
    "SELECT part_name FROM parts WHERE line IN ('A', 'C')"],
  ['select row number empty parens over open paren partition by part id order by lot id close paren from lots',
    'SELECT ROW_NUMBER() OVER (PARTITION BY part_id ORDER BY lot_id) FROM lots'],
  ['select case when qty greater than three hundred then quote large end quote else quote small end quote end from lots',
    "SELECT CASE WHEN qty > 300 THEN 'large' ELSE 'small' END FROM lots"],
  ['select defect code from defects group by defect code having count star at least twenty',
    'SELECT defect_code FROM defects GROUP BY defect_code HAVING COUNT(*) >= 20'],
  ['select average of qty from lots', 'SELECT AVG(qty) FROM lots'],
  ['select average open paren qty close paren from lots', 'SELECT AVG(qty) FROM lots'],
  ['select lot id comma qty minus lag open paren qty close paren over open paren order by lot id close paren from lots',
    'SELECT lot_id, qty - LAG(qty) OVER (ORDER BY lot_id) FROM lots'],
  ['select distinct part id from lots', 'SELECT DISTINCT part_id FROM lots'],
  ['select lot id from lots comment big ones end comment', 'SELECT lot_id FROM lots  -- big ones'],
]

describe('SQL utterances', () => {
  for (const [said, code] of SQL_CASES) it(`"${said}"`, () => expect(sql(said)).toBe(code))
})

describe('dictating across several utterances, with edit commands', () => {
  const pieces = [
    'def snake sum evens open paren nums close paren colon',
    'next total equals zero',
    'next for n in nums colon',
    'next if n mod two is equal to zero colon',
    'next total plus equals n',
    'next back back return total',
  ]
  it('builds the worked example one phrase at a time', () => {
    let doc: Doc = emptyDoc()
    for (const p of pieces) doc = dictate(doc, p, 'python', [])
    expect(render(doc, 'python')).toBe(EXAMPLE_1_CODE)
  })
  it('scratch that, delete line, go to line and start over', () => {
    const history: Doc[] = []
    let doc = emptyDoc()
    const say = (u: string) => {
      history.push(doc)
      doc = dictate(doc, u, 'python', [])
    }
    say('x equals one')
    say('next y equals two')
    say('next z equals three')
    expect(render(doc, 'python')).toBe('x = 1\ny = 2\nz = 3')
    doc = history.pop()! // scratch that
    expect(render(doc, 'python')).toBe('x = 1\ny = 2')
    doc = applyEdit(doc, parseEdit('go to line one')!)
    expect(doc.cursor).toBe(0)
    doc = dictate(doc, 'plus one', 'python', [])
    expect(render(doc, 'python')).toBe('x = 1 + 1\ny = 2')
    doc = applyEdit(doc, { t: 'goto', line: 2 })
    doc = applyEdit(doc, parseEdit('delete line')!)
    expect(render(doc, 'python')).toBe('x = 1 + 1')
    doc = applyEdit(doc, parseEdit('start over')!)
    expect(render(doc, 'python')).toBe('')
  })
  it('recognizes edit commands only as whole utterances', () => {
    expect(parseEdit('scratch that')).toEqual({ t: 'scratch' })
    expect(parseEdit('Run it.')).toEqual({ t: 'run' })
    expect(parseEdit('read it back')).toEqual({ t: 'read_all' })
    expect(parseEdit('read line')).toEqual({ t: 'read_line' })
    expect(parseEdit('go to line 3')).toEqual({ t: 'goto', line: 3 })
    expect(parseEdit('go to line three')).toEqual({ t: 'goto', line: 3 })
    expect(parseEdit('x equals run it')).toBeNull()
  })
  it('reads code back in Verbal Syntax words', () => {
    let doc = emptyDoc()
    for (const p of pieces) doc = dictate(doc, p, 'python', [])
    const all = speakDoc(doc, 'python')
    expect(all).toContain('Line 1. def sum evens open paren nums close paren colon.')
    expect(all).toContain('Line 2, indented once. total equals 0.')
    expect(all).toContain('Line 4, indented twice. if n mod 2 is equal to 0 colon.')
    expect(speakLine(doc, 5, 'python')).toBe('Line 6, indented once. return total.')
    expect(speakDoc(emptyDoc(), 'python')).toBe("There's no code yet.")
    const s = dictate(emptyDoc(), EXAMPLE_2, 'sql', ['lots', 'part_id', 'qty'])
    expect(speakDoc(s, 'sql')).toBe('Line 1. select part id comma sum open paren qty close paren as total from lots group by part id order by total desc limit 3.')
  })
})

describe('dictated code runs', () => {
  const drills = loadDrills()
  it('worked example 1 runs in Pyodide', async () => {
    const r = await nodeRunPyTests(EXAMPLE_1_CODE, 'sum_evens', [
      { args: [[1, 2, 3, 4]], expected: 6 },
      { args: [[]], expected: 0 },
    ])
    expect(r.ok).toBe(true)
  }, 60000)
  it('worked example 2 runs in sql.js', async () => {
    const r = await nodeRunSql('factory', sql(EXAMPLE_2, ['lots', 'part_id', 'qty']))
    expect(r.ok && r.rows.length).toBe(3)
  })
  it('a dictated count above passes the ladder tests', async () => {
    const d = drills.find((x) => x.id === 'py-p3-dictate-005')!
    const code = py(
      'def count above open paren nums comma limit close paren colon next count equals zero next for n in nums colon next if n greater than limit colon next count plus equals one next back back return count',
      d.vocab,
    )
    const r = await nodeRunPyTests(code, d.function_name!, d.tests!)
    expect(r.ok).toBe(true)
  }, 60000)
  it('a dictated make label passes the ladder tests', async () => {
    const d = drills.find((x) => x.id === 'py-p1-dictate-001')!
    const code = py(
      'def make label open paren name comma line close paren colon next return name dot upper empty parens plus quote dash end quote plus line',
      d.vocab,
    )
    const r = await nodeRunPyTests(code, d.function_name!, d.tests!)
    expect(r.ok).toBe(true)
  }, 60000)
  it('worked example 1, said exactly as in section 9, passes its drill (py-p3-dictate-013)', async () => {
    const d = drills.find((x) => x.id === 'py-p3-dictate-013')!
    const said =
      'def snake sum evens open paren nums close paren colon next total equals zero next for n in nums colon next if n mod two is equal to zero colon next total plus equals n next back back return total'
    for (const utterance of [said, said.replace('snake ', '')]) {
      const code = py(utterance, d.vocab)
      expect(code.split('\n')[0]).toBe('def sum_evens(nums):')
      const r = await nodeRunPyTests(code, d.function_name!, d.tests!)
      expect(r.ok).toBe(true)
    }
  }, 60000)
  it('worked example 2, said exactly as in section 9, matches its drill (sql-s3-dictate-013) in order', async () => {
    const d = drills.find((x) => x.id === 'sql-s3-dictate-013')!
    const code = sql(
      'select part id comma sum open paren qty close paren as total from lots group by part id order by total descending limit three',
      d.vocab,
    )
    expect(code).toBe('SELECT part_id, SUM(qty) AS total FROM lots GROUP BY part_id ORDER BY total DESC LIMIT 3')
    const mine = await nodeRunSql('factory', code)
    const ref = await nodeRunSql('factory', d.reference!)
    expect(mine.ok && ref.ok).toBe(true)
    if (mine.ok && ref.ok) expect(compareRows(mine, ref, true).equal).toBe(true)
  })
  it('a dictated join matches the ladder reference rows', async () => {
    const d = drills.find((x) => x.id === 'sql-s4-dictate-007')!
    const mine = await nodeRunSql('factory', sql('select l dot lot id comma p dot part name from lots l join parts p on p dot part id equals l dot part id', d.vocab))
    const ref = await nodeRunSql('factory', d.reference!)
    expect(mine.ok && ref.ok).toBe(true)
    if (mine.ok && ref.ok) expect(compareRows(mine, ref, false).equal).toBe(true)
  })
})

// Every claim on the in-app cheat sheet (src/app/VerbalCheatSheet.tsx), checked against the parser.
describe('cheat sheet claims', () => {
  const PY: [string, string][] = [
    ['x equals one new line y equals two', 'x = 1\ny = 2'],
    ['if x colon next y equals one next back z equals two', 'if x:\n    y = 1\nz = 2'],
    ['a dot b open paren close paren comma c empty parens', 'a.b(), c()'],
    ['x equals empty list', 'x = []'],
    ['x equals open bracket one comma two close bracket', 'x = [1, 2]'],
    ['x equals empty dict', 'x = {}'],
    ['x equals open brace quote a end quote colon one close brace', 'x = {"a": 1}'],
    ['print open paren f quote total is value of total end quote close paren', 'print(f"total is {total}")'],
    ['x equals one comment the start end comment', 'x = 1  # the start'],
    ['x is equal to y', 'x == y'],
    ['x double equals y', 'x == y'],
    ['x not equal to y', 'x != y'],
    ['x at least y and x at most z', 'x >= y and x <= z'],
    ['a plus b minus c times d divided by e', 'a + b - c * d / e'],
    ['a floor divide b mod c to the power two', 'a // b % c ** 2'],
    ['x plus equals one next y minus equals two', 'x += 1\ny -= 2'],
    ['snake total cost equals camel total cost', 'total_cost = totalCost'],
    ['cap name equals spell d f', 'Name = df'],
    ['x equals spell delta foxtrot', 'x = df'],
    ['x equals twenty five plus three point five plus negative two', 'x = 25 + 3.5 + -2'],
    ['x equals true or false or none', 'x = True or False or None'],
    ['else if x colon', 'elif x:'],
    ['n equals len of nums', 'n = len(nums)'],
  ]
  for (const [said, code] of PY) it(`Python: "${said}"`, () => expect(py(said, ['nums', 'total'])).toBe(code))
  const SQLS: [string, string][] = [
    ['select count star from lots', 'SELECT COUNT(*) FROM lots'],
    ['select star from lots order by qty descending', 'SELECT * FROM lots ORDER BY qty DESC'],
    ['select lots dot part id from lots', 'SELECT lots.part_id FROM lots'],
    ['select sum of qty comma avg of qty comma max of qty from lots', 'SELECT SUM(qty), AVG(qty), MAX(qty) FROM lots'],
    ['select part id from lots group by part id', 'SELECT part_id FROM lots GROUP BY part_id'],
    ["select star from parts where line equals quote a end quote", "SELECT * FROM parts WHERE line = 'a'"],
  ]
  for (const [said, code] of SQLS) it(`SQL: "${said}"`, () => expect(sql(said)).toBe(code))
  it('operators the recognizer wrote as symbols', () => {
    expect(py('x = 2 + 3 * y')).toBe('x = 2 + 3 * y')
    expect(py('if n >= 10 colon')).toBe('if n >= 10:')
    expect(py('Total += N.', ['total'])).toBe('total += n')
  })
  it('edit commands', () => {
    expect(parseEdit('done')).toEqual({ t: 'run' })
    expect(parseEdit('run it')).toEqual({ t: 'run' })
    expect(parseEdit('start over')).toEqual({ t: 'start_over' })
    expect(parseEdit('delete line')).toEqual({ t: 'delete_line' })
  })
})

