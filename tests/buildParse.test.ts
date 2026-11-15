// The spoken-clause parser for the build loop: clauses land in their slots in any order, and the
// punctuation (parentheses, quotes, commas, underscores) is typed for you.
import { beforeAll, describe, expect, it } from 'vitest'
import { missingPiece, rowsPhrase, sayError, sqlShape } from '../src/build/feedback'
import { emptyFrame, renderFrame, sayClause, sayDate, sayFrame, type Frame } from '../src/build/frame'
import { applyUtterance, canonValue, nameStep, parseBuildCommand, removeClause, replaceDates, unfinishedClause, type BuildSchema } from '../src/build/parse'
import { loadBuildSchema } from '../src/build/schema'
import { nodeRunSql } from './nodeRunners'

let schema: BuildSchema
beforeAll(async () => {
  schema = await loadBuildSchema('factory', nodeRunSql)
})

/** Say each step in turn; returns the SQL and what the app would echo for the last step. */
function build(steps: string[], start: Frame = emptyFrame()) {
  let f = start
  let echo = ''
  let note: string | undefined
  for (const u of steps) {
    const cmd = parseBuildCommand(u, schema)
    const r = cmd?.t === 'name' ? nameStep(f, cmd.name) : cmd?.t === 'remove' ? removeClause(f, cmd.what) : applyUtterance(f, u, schema)
    f = r.frame
    note = r.note
    echo = r.changed.map((c) => sayClause(f.main, c.key, c.index)).filter(Boolean).join(' ')
  }
  return { sql: renderFrame(f), echo, note, frame: f }
}
const sql = (...steps: string[]) => build(steps).sql

describe('the database schema, read from the data', () => {
  it('knows the tables, the stored text values and the year', () => {
    expect(schema.tables.map((t) => t.name)).toEqual(['parts', 'machines', 'lots', 'defects', 'defect_codes'])
    expect(schema.values.shift).toEqual(['day', 'night'])
    expect(schema.values.line).toEqual(['A', 'B', 'C'])
    expect(schema.values.category).toEqual(['cosmetic', 'dimensional', 'structural'])
    expect(schema.values.produced_on).toBeUndefined() // dates are not values to match
    expect(schema.year).toBe(2026)
  })
})

describe('clauses land in their slots', () => {
  it('in any order, one at a time', () => {
    expect(sql('from lots', 'group by machine id', 'select machine id, sum of quantity as total', 'order by total descending', 'limit 3')).toBe(
      'SELECT machine_id, SUM(qty) AS total\nFROM lots\nGROUP BY machine_id\nORDER BY total DESC\nLIMIT 3',
    )
  })
  it('or all in one breath', () => {
    expect(sql('select machine id and shift from lots where shift equals night and quantity greater than 200')).toBe(
      "SELECT machine_id, shift\nFROM lots\nWHERE shift = 'night' AND qty > 200",
    )
  })
  it('a table alone shows everything, so you can look first', () => {
    expect(sql('from the lots table')).toBe('SELECT *\nFROM lots')
  })
  it('saying a clause again replaces it; "also" and "and" add to it', () => {
    expect(sql('from lots', 'where shift equals night', 'where shift equals day')).toContain("WHERE shift = 'day'")
    expect(sql('from lots', 'where shift equals night', 'and quantity at least 300')).toContain("WHERE shift = 'night' AND qty >= 300")
    expect(sql('from lots', 'where shift equals night', 'also where quantity at least 300')).toContain("WHERE shift = 'night' AND qty >= 300")
    expect(sql('from lots', 'select lot id', 'also select quantity')).toContain('SELECT lot_id, qty')
    expect(sql('from parts', 'where line equals a', 'or line is b')).toContain("WHERE line = 'A' OR line = 'B'")
  })
  it('an expression with no keyword is a new column', () => {
    expect(sql('from lots', 'sum of quantity as total')).toBe('SELECT SUM(qty) AS total\nFROM lots')
    expect(sql('from lots', 'select machine id', 'count star')).toContain('SELECT machine_id, COUNT(*)')
  })
  it('"descending" and "comma ..." carry on with the list said last', () => {
    expect(sql('from lots', 'order by quantity', 'descending', 'comma lot id')).toContain('ORDER BY qty DESC, lot_id')
    expect(sql('from lots', 'group by machine id', 'comma shift')).toContain('GROUP BY machine_id, shift')
  })
  it('noise is not a clause', () => {
    const r = build(['from lots', 'hello there'])
    expect(r.sql).toBe('SELECT *\nFROM lots')
    expect(r.note).toMatch(/didn't catch a clause/)
    expect(build(['descending']).note).toBe("There's no order by yet.")
    expect(build(['on lot id']).note).toMatch(/no join/)
  })
  it('a stray phrase adds nothing: every word has to be accounted for, and a near miss is not enough', () => {
    for (const stray of ['top three', '400', 'hint', 'quality', 'lot id please', 'what was that']) {
      const r = build(['from lots', 'select lot id', stray])
      expect(r.sql, stray).toBe('SELECT lot_id\nFROM lots')
      expect(r.note, stray).toMatch(/didn't catch a clause/)
    }
    // but real columns, values inside an expression and a new name after "as" are all fine
    expect(sql('from lots', 'select lot id', 'quantity as amount')).toContain('SELECT lot_id, qty AS amount')
    expect(sql('from lots', 'select lot id', 'case when shift equals night then 1 else 0 end as late')).toContain("CASE WHEN shift = 'night' THEN 1 ELSE 0 END AS late")
  })
})

describe('the punctuation is typed for you', () => {
  it('commas: "and" in a list, and two columns in a row', () => {
    expect(sql('select lot id quantity from lots')).toContain('SELECT lot_id, qty')
    expect(sql('select lot id and quantity and shift from lots')).toContain('SELECT lot_id, qty, shift')
    expect(sql('from lots l', 'select l dot lot id l dot quantity')).toContain('SELECT l.lot_id, l.qty')
  })
  it('quotes: a word that is not a name is a value, in the case the data uses', () => {
    expect(sql('from lots', 'where shift equals night')).toContain("WHERE shift = 'night'")
    expect(sql('from parts', 'where line equals a')).toContain("WHERE line = 'A'")
    expect(sql('from defect codes', 'where description equals short shot')).toContain("WHERE description = 'short shot'")
    expect(sql('from lots', 'where shift is knight')).toContain("WHERE shift = 'night'") // misheard, one letter off
    expect(sql('from lots', 'where shift is not night')).toContain("WHERE shift != 'night'")
    expect(canonValue('Structural', 'category', schema)).toBe('structural')
    expect(canonValue('purple', 'category', schema)).toBe('purple')
  })
  it('dates the way you say them', () => {
    expect(sql('from lots', 'where produced on between February 1st 2026 and February 28th, 2026')).toContain(
      "WHERE produced_on BETWEEN '2026-02-01' AND '2026-02-28'",
    )
    expect(sql('from lots', 'where produced on at least March 15')).toContain("WHERE produced_on >= '2026-03-15'")
    expect(replaceDates('before the 3rd of March', 2026)).toContain('quote 2026-03-03 unquote')
    expect(replaceDates('on 2/14/2026', 2026)).toContain('quote 2026-02-14 unquote')
    expect(replaceDates('february first', 2026)).toContain('quote 2026-02-01 unquote')
    expect(replaceDates('limit 5', 2026)).toBe('limit 5')
    expect(sayDate('2026-02-01')).toBe('February 1st, 2026')
  })
  it('parentheses for calls', () => {
    expect(sql('from lots', 'select count star')).toContain('SELECT COUNT(*)')
    expect(sql('from lots', 'select count of rows')).toContain('SELECT COUNT(*)')
    expect(sql('from lots', 'select count distinct part id')).toContain('SELECT COUNT(DISTINCT part_id)')
    expect(sql('from lots', 'select average quantity')).toContain('SELECT AVG(qty)')
    expect(sql('from defects', 'select sum of defects dot quantity')).toContain('SELECT SUM(defects.qty)')
    expect(sql('from lots', 'select round of average of quantity comma 1 as avg size')).toContain('SELECT ROUND(AVG(qty), 1) AS avg_size')
    expect(sql('from lots', 'select coalesce of shift comma unknown as shift name')).toContain("SELECT COALESCE(shift, 'unknown') AS shift_name")
    expect(sql('from lots join parts using part id', 'select sum of open paren quantity times unit cost close paren')).toContain('SELECT SUM(qty * unit_cost)')
    expect(sql('from lots', 'select 100.0 times sum of open paren case when shift equals night then 1 else 0 end close paren divided by count star')).toContain(
      "SELECT 100.0 * SUM(CASE WHEN shift = 'night' THEN 1 ELSE 0 END) / COUNT(*)",
    )
    expect(sql('from lots', 'select machine id, sum of quantity times 1.0 divided by count star as avg size')).toContain('SUM(qty) * 1.0 / COUNT(*) AS avg_size')
  })
  it('parentheses for IN lists and subqueries', () => {
    expect(sql('from defect codes', 'where category in cosmetic comma structural and description not equal to dent')).toContain(
      "WHERE category IN ('cosmetic', 'structural') AND description != 'dent'",
    )
    expect(sql('from lots', 'where quantity greater than open paren select average of quantity from lots close paren')).toContain(
      'WHERE qty > (SELECT AVG(qty) FROM lots)',
    )
  })
  it('window functions', () => {
    expect(sql('from lots', 'select lot id, rank over partition by machine id order by quantity descending as r')).toContain(
      'SELECT lot_id, RANK() OVER (PARTITION BY machine_id ORDER BY qty DESC) AS r',
    )
    expect(sql('select lot id, quantity, sum of quantity over order by lot id as running total from lots order by lot id')).toBe(
      'SELECT lot_id, qty, SUM(qty) OVER (ORDER BY lot_id) AS running_total\nFROM lots\nORDER BY lot_id',
    )
    expect(sql('from lots', 'select lag of quantity over partition by machine id order by produced on as previous')).toContain(
      'LAG(qty) OVER (PARTITION BY machine_id ORDER BY produced_on) AS previous',
    )
    expect(sql('from lots', 'select row number over order by quantity desc as n')).toContain('ROW_NUMBER() OVER (ORDER BY qty DESC) AS n')
  })
  it('case expressions, with their values quoted', () => {
    expect(sql('from lots', 'select case when quantity less than 150 then small when quantity at most 300 then medium else large end as size, count star', 'group by size')).toBe(
      "SELECT CASE WHEN qty < 150 THEN 'small' WHEN qty <= 300 THEN 'medium' ELSE 'large' END AS size, COUNT(*)\nFROM lots\nGROUP BY size",
    )
  })
  it('names: several words become one, and a name can be a function word', () => {
    expect(sql('from lots', 'select machine id, sum of quantity as total quantity', 'group by machine id', 'order by total quantity descending')).toBe(
      'SELECT machine_id, SUM(qty) AS total_quantity\nFROM lots\nGROUP BY machine_id\nORDER BY total_quantity DESC',
    )
    expect(sql('from lots', 'select part id, count star as count', 'group by part id', 'order by count descending')).toContain('ORDER BY count DESC')
  })
})

describe('everyday ways to say it', () => {
  const where = (said: string) => sql('from lots', `where ${said}`).split('\n')[2]
  it('comparisons: over, above, under, below, bigger than, no more than, or more', () => {
    expect(where('quantity over 400')).toBe('WHERE qty > 400')
    expect(where('the quantity is over four hundred')).toBe('WHERE qty > 400')
    expect(where('quantity is above 400')).toBe('WHERE qty > 400')
    expect(where('quantity is bigger than 400')).toBe('WHERE qty > 400')
    expect(where('quantity under 150')).toBe('WHERE qty < 150')
    expect(where('quantity is below 150')).toBe('WHERE qty < 150')
    expect(where('quantity is fewer than 150')).toBe('WHERE qty < 150')
    expect(where('quantity is no more than 150')).toBe('WHERE qty <= 150')
    expect(where('quantity is not less than 150')).toBe('WHERE qty >= 150')
    expect(where('quantity is 150 or more')).toBe('WHERE qty >= 150')
    expect(where('quantity is 150 or less')).toBe('WHERE qty <= 150')
    expect(where('quantity is exactly 400')).toBe('WHERE qty = 400')
    expect(where("quantity isn't 400")).toBe('WHERE qty != 400')
    expect(where("shift isn't null")).toBe('WHERE shift IS NOT NULL')
    expect(where('quantity greater than or equal 400')).toBe('WHERE qty >= 400')
    expect(where('quantity is above open paren select average of quantity from lots close paren')).toBe('WHERE qty > (SELECT AVG(qty) FROM lots)')
  })
  it('"or more" is left alone when it starts a second comparison', () => {
    // SQL needs the column again here; SQLite says so
    expect(where('quantity less than 100 or more than 400')).toBe('WHERE qty < 100 OR > 400')
    expect(where('quantity less than 100 or quantity more than 400')).toBe('WHERE qty < 100 OR qty > 400')
  })
  it('dates: before, after, on or after, on or before, since', () => {
    expect(where('produced on is before March 1st 2026')).toBe("WHERE produced_on < '2026-03-01'")
    expect(where('produced on after January 31st')).toBe("WHERE produced_on > '2026-01-31'")
    expect(where('produced on is on or after February 1st and produced on is on or before February 28th')).toBe(
      "WHERE produced_on >= '2026-02-01' AND produced_on <= '2026-02-28'",
    )
    expect(where('produced on since March 1st')).toBe("WHERE produced_on >= '2026-03-01'")
  })
  it('"over" is still the window keyword, and a name can still be called under', () => {
    expect(sql('from lots', 'select sum of quantity over order by lot id as running total')).toContain('SUM(qty) OVER (ORDER BY lot_id) AS running_total')
    expect(sql('from lots', 'select lot id, quantity as under')).toContain('SELECT lot_id, qty AS under')
    // in a condition there are no windows, even when the pause falls right after it
    expect(sql('from lots', 'where quantity over', '400')).toContain('WHERE qty > 400')
    expect(sql('from lots', 'group by part id', 'having count over 10')).toContain('HAVING COUNT(*) > 10')
  })
  it('count on its own counts rows', () => {
    expect(sql('from lots', 'select the count')).toBe('SELECT COUNT(*)\nFROM lots')
    expect(sql('from lots', 'group by shift', 'select shift and the count')).toContain('SELECT shift, COUNT(*)')
    expect(sql('from lots', 'select count as n')).toContain('SELECT COUNT(*) AS n')
    expect(sql('from lots', 'group by part id', 'having the count is greater than ten', 'order by count descending')).toContain('HAVING COUNT(*) > 10\nORDER BY COUNT(*) DESC')
    // unless the query has a column of that name
    expect(sql('from lots', 'group by machine id', 'select machine id, count star as count', 'order by count descending')).toContain('ORDER BY count DESC')
  })
  it('a list without commas: a call or a case after a column starts the next one', () => {
    expect(sql('from lots', 'select shift count star')).toContain('SELECT shift, COUNT(*)')
    expect(sql('from lots', 'select machine id sum of quantity as total average of quantity')).toContain('SELECT machine_id, SUM(qty) AS total, AVG(qty)')
    expect(sql('from lots', 'select machine id sum of quantity as total count star as lots made')).toContain('SELECT machine_id, SUM(qty) AS total, COUNT(*) AS lots_made')
    expect(sql('from lots', 'select lot id case when quantity over 300 then big else small end as size')).toContain(
      "SELECT lot_id, CASE WHEN qty > 300 THEN 'big' ELSE 'small' END AS size",
    )
    // names of several words still hold together
    expect(sql('from lots', 'select machine id, count star as lot count, sum of quantity as total quantity')).toContain('COUNT(*) AS lot_count, SUM(qty) AS total_quantity')
  })
  it('a table said right before its own column is that table\'s column', () => {
    expect(sql('from defects', 'join lots using lot id', 'select sum of defects quantity')).toContain('SELECT SUM(defects.qty)')
    expect(sql('from defects', 'join lots using lot id', 'where lots quantity over 400')).toContain('WHERE lots.qty > 400')
    expect(sql('from defects join lots using lot id')).toBe('SELECT *\nFROM defects\nJOIN lots USING (lot_id)')
  })
  it('a case is a whole argument, lag works without "of", "x" is times, "sort by" is order by', () => {
    expect(sql('from lots', 'select 100.0 x sum of case when shift is night then one else zero end divided by count star')).toContain(
      "SELECT 100.0 * SUM(CASE WHEN shift = 'night' THEN 1 ELSE 0 END) / COUNT(*)",
    )
    expect(sql('from lots', 'select 100 times average of case when shift is night then 1.0 else 0 end as pct')).toContain(
      "SELECT 100 * AVG(CASE WHEN shift = 'night' THEN 1.0 ELSE 0 END) AS pct",
    )
    expect(sql('from lots', 'select lot id, lag quantity over order by lot id as previous')).toContain('LAG(qty) OVER (ORDER BY lot_id) AS previous')
    expect(sql('from lots join parts using part id', 'select sum of open paren quantity x unit cost close paren')).toContain('SELECT SUM(qty * unit_cost)')
    expect(sql('from lots', 'select quantity as x', 'order by x descending')).toContain('ORDER BY x DESC')
    expect(sql('from lots', 'sort by quantity descending')).toContain('ORDER BY qty DESC')
  })
  it('a word that only sounds like a table is a value, so the answer is no rows, not a wrong name', () => {
    expect(where('shift is missing')).toBe("WHERE shift = 'missing'")
  })
})

describe('clause words as speech recognition tends to write them', () => {
  it('are read as what was meant', () => {
    expect(sql('from lots', 'select machine id, some of quantity', 'grouped by machine id', 'order buy machine id')).toBe(
      'SELECT machine_id, SUM(qty)\nFROM lots\nGROUP BY machine_id\nORDER BY machine_id',
    )
    expect(sql('from lots', 'wear shift is no')).toContain('WHERE shift IS NULL')
    expect(sql('from lots', 'where shift is not no', 'select count start')).toBe('SELECT COUNT(*)\nFROM lots\nWHERE shift IS NOT NULL')
    expect(sql('from defects', 'left joined lots using lot id')).toContain('LEFT JOIN lots USING (lot_id)')
    expect(sql('from lot', 'select lot ID, Quantity')).toBe('SELECT lot_id, qty\nFROM lots')
    expect(sql('from defects', 'select sum of defects.quantity', 'where quantity > 5')).toBe('SELECT SUM(defects.qty)\nFROM defects\nWHERE qty > 5')
    expect(sql('from lots', 'select count *')).toContain('SELECT COUNT(*)')
    expect(sql('from lots', 'where quantity greater than open parentheses select average of quantity from lots close parenthesis')).toContain(
      'WHERE qty > (SELECT AVG(qty) FROM lots)',
    )
    expect(sql('from lots', 'select case when quantity less than 150 then small else large and as size')).toContain(
      "CASE WHEN qty < 150 THEN 'small' ELSE 'large' END AS size",
    )
  })
})

describe('joins', () => {
  it('using a shared column, three ways to say it', () => {
    expect(sql('from defects', 'join lots using lot id')).toContain('JOIN lots USING (lot_id)')
    expect(sql('from defects', 'join lots on lot id')).toContain('JOIN lots USING (lot_id)')
    expect(sql('from defects join lots', 'on lot id')).toContain('JOIN lots USING (lot_id)')
  })
  it('on a full condition, with table names or short aliases', () => {
    expect(sql('from lots l join parts p on p dot part id equals l dot part id')).toBe('SELECT *\nFROM lots l\nJOIN parts p ON p.part_id = l.part_id')
    expect(sql('from machines', 'left join lots on lots dot machine id equals machines dot machine id', 'and lots dot shift equals night')).toContain(
      "LEFT JOIN lots ON lots.machine_id = machines.machine_id AND lots.shift = 'night'",
    )
  })
  it('several joins, and removing the last one', () => {
    const three = ['from defects', 'join lots using lot id', 'join parts using part id']
    expect(build(three).sql).toBe('SELECT *\nFROM defects\nJOIN lots USING (lot_id)\nJOIN parts USING (part_id)')
    expect(build([...three, 'remove join']).sql).toBe('SELECT *\nFROM defects\nJOIN lots USING (lot_id)')
  })
})

describe('steps: "name it" turns the query so far into a WITH step', () => {
  it('builds the next query on the named step', () => {
    const r = build([
      'from lots', 'select machine id, lot id, quantity, rank over partition by machine id order by quantity descending as r', 'name it ranked',
      'where r equals 1', 'select machine id, lot id, quantity',
    ])
    expect(r.sql).toBe(
      'WITH ranked AS (\n  SELECT machine_id, lot_id, qty, RANK() OVER (PARTITION BY machine_id ORDER BY qty DESC) AS r\n  FROM lots\n)\n' +
        'SELECT machine_id, lot_id, qty\nFROM ranked\nWHERE r = 1',
    )
    expect(sayFrame(r.frame)).toContain('Step ranked: Select machine id')
  })
  it('a named step can be joined later', () => {
    expect(sql('from defects', 'group by lot id', 'select lot id, sum of quantity as bad', 'name it per lot', 'from lots', 'left join per lot using lot id')).toContain(
      'FROM lots\nLEFT JOIN per_lot USING (lot_id)',
    )
  })
  it('needs something to name', () => {
    expect(nameStep(emptyFrame(), 'x').note).toMatch(/nothing to name/)
  })
})

describe('a clause cut in two by a pause is put back together', () => {
  it('conditions', () => {
    expect(sql('from lots', 'where quantity greater than', '400')).toContain('WHERE qty > 400')
    expect(sql('from lots', 'where quantity', 'greater than 400')).toContain('WHERE qty > 400')
    expect(sql('from lots', 'where shift equals', 'night')).toContain("WHERE shift = 'night'")
    expect(sql('from lots', 'where shift equals night and', 'quantity at least 300')).toContain("WHERE shift = 'night' AND qty >= 300")
    expect(sql('from lots', 'where produced on between February 1st 2026 and', 'February 28th 2026')).toContain("BETWEEN '2026-02-01' AND '2026-02-28'")
  })
  it('a column: its alias, the rest of its case, the rest of its window', () => {
    expect(sql('from lots', 'select sum of quantity', 'as total')).toContain('SELECT SUM(qty) AS total')
    expect(sql('from lots', 'select case when quantity less than 150 then small', 'when quantity at most 300 then medium', 'else large end as size')).toContain(
      "SELECT CASE WHEN qty < 150 THEN 'small' WHEN qty <= 300 THEN 'medium' ELSE 'large' END AS size",
    )
    expect(sql('from lots', 'select lot id, rank over partition by machine id', 'order by quantity descending as r')).toContain(
      'SELECT lot_id, RANK() OVER (PARTITION BY machine_id ORDER BY qty DESC) AS r',
    )
    expect(sql('from lots', 'select lot id, rank over', 'partition by machine id order by quantity descending', 'as r')).toContain(
      'SELECT lot_id, RANK() OVER (PARTITION BY machine_id ORDER BY qty DESC) AS r',
    )
    expect(sql('from lots', 'select sum of quantity times', '2')).toContain('SELECT SUM(qty) * 2')
    expect(sql('from lots', 'select lot id, rank over partition by', 'machine id order by quantity descending as r')).toContain(
      'SELECT lot_id, RANK() OVER (PARTITION BY machine_id ORDER BY qty DESC) AS r',
    )
    expect(sql('from lots', 'select lot id, sum of quantity over order by', 'lot id as running total')).toContain(
      'SELECT lot_id, SUM(qty) OVER (ORDER BY lot_id) AS running_total',
    )
  })
  it('a call: its argument, or the rest of the case inside it', () => {
    expect(sql('from lots', 'select sum of', 'quantity')).toBe('SELECT SUM(qty)\nFROM lots')
    expect(sql('from lots', 'select count of', 'distinct part id')).toBe('SELECT COUNT(DISTINCT part_id)\nFROM lots')
    expect(sql('from lots', 'select machine id, 100.0 times sum of case when shift equals night then 1', 'else 0 end divided by count star')).toContain(
      "SELECT machine_id, 100.0 * SUM(CASE WHEN shift = 'night' THEN 1 ELSE 0 END) / COUNT(*)",
    )
    expect(sql('from lots', 'select machine id, 100.0 times sum of', 'open paren case when shift equals night then 1 else 0 end close paren', 'divided by count star')).toContain(
      "SELECT machine_id, 100.0 * SUM(CASE WHEN shift = 'night' THEN 1 ELSE 0 END) / COUNT(*)",
    )
    expect(sql('from lots', 'where produced on between February 1st 2026', 'and February 28th 2026')).toContain("BETWEEN '2026-02-01' AND '2026-02-28'")
    expect(sql('from lots', 'where quantity greater than open paren select average of quantity from lots', 'close paren')).toContain(
      'WHERE qty > (SELECT AVG(qty) FROM lots)',
    )
    // a condition left unfinished takes the rest even when another clause was said in between
    expect(sql('from lots', 'where shift equals night and', 'select lot id', 'quantity greater than 400')).toBe(
      "SELECT lot_id\nFROM lots\nWHERE shift = 'night' AND qty > 400",
    )
  })
  it('knows which clause is still unfinished, so it is not run as if it were a mistake', () => {
    const open = (...steps: string[]) => unfinishedClause(build(steps).frame)
    expect(open('from lots', 'where quantity greater than')).toBe('where')
    expect(open('from lots', 'where shift equals night and')).toBe('where')
    expect(open('from lots', 'where produced on between February 1st 2026')).toBe('where')
    expect(open('from lots', 'where quantity greater than open paren select average of quantity from lots')).toBe('where')
    expect(open('from lots', 'select case when quantity less than 150 then small')).toBe('select')
    expect(open('from lots', 'select case when quantity less than 150 then small', 'else large')).toBe('select')
    expect(open('from lots', 'select sum of')).toBe('select')
    expect(open('from lots', 'select lot id, rank over partition by')).toBe('select')
    expect(open('from lots', 'select sum of quantity as')).toBe('select')
    expect(open('from defects', 'join lots on defects dot lot id equals')).toBe('join')
    expect(open('from lots', 'group by part id', 'having count star greater than')).toBe('having')
    // finished ones
    expect(open('from lots')).toBeNull()
    expect(open('from lots', 'select star')).toBeNull()
    expect(open('from lots', 'select count star, lots dot star')).toBeNull()
    expect(open('from lots', 'where quantity greater than', '400')).toBeNull()
    expect(open('from lots', 'select case when quantity less than 150 then small', 'else large', 'end as size')).toBeNull()
    expect(open('from lots', 'where produced on between February 1st 2026 and February 28th 2026', 'order by quantity descending')).toBeNull()
    expect(open('from lots', 'select lot id, rank over partition by machine id order by quantity descending as r')).toBeNull()
  })
  it('but a finished window with a name is left alone', () => {
    expect(sql('from lots', 'select lot id, rank over partition by machine id as r', 'order by lot id')).toBe(
      'SELECT lot_id, RANK() OVER (PARTITION BY machine_id) AS r\nFROM lots\nORDER BY lot_id',
    )
  })
})

describe('what the app says back', () => {
  it('echoes each clause in plain words, without the punctuation', () => {
    expect(build(['from defects', 'join lots using lot id']).echo).toBe('Join lots using lot id.')
    expect(build(['from lots', 'select machine id, sum of quantity as total']).echo).toBe('Select machine id, sum of quantity as total.')
    expect(build(['from lots', 'where produced on between February 1st 2026 and February 28th 2026']).echo).toBe(
      'Where produced on between February 1st, 2026 and February 28th, 2026.',
    )
    expect(build(['from lots', 'select lot id, rank over partition by machine id order by quantity descending as r']).echo).toBe(
      'Select lot id, rank over partition by machine id order by quantity descending as r.',
    )
    expect(build(['from defect codes', 'where category in cosmetic comma structural']).echo).toBe('Where category in cosmetic, structural.')
    expect(build(['from lots', 'select count star, count distinct part id']).echo).toBe('Select count star, count of distinct part id.')
  })
  it('reads the whole query back in SQL order', () => {
    expect(sayFrame(build(['group by shift', 'from lots', 'select shift, count star']).frame)).toBe('Select shift, count star. From lots. Group by shift.')
    expect(sayFrame(emptyFrame())).toBe("There's no query yet.")
  })
  it('row counts and SQLite errors in plain words', () => {
    expect([rowsPhrase(0), rowsPhrase(1), rowsPhrase(12)]).toEqual(['No rows.', '1 row.', '12 rows.'])
    expect(sayError('no such column: machine')).toBe('No such column: machine.')
    expect(sayError('ambiguous column name: qty')).toBe('Ambiguous column name: quantity.')
    expect(sayError('no such column: lots.part_name')).toBe('No such column: lots dot part name.')
    expect(sayError('near "FROM": syntax error')).toBe('Syntax error near from.')
    expect(sayError('misuse of aggregate: SUM()')).toBe('Misuse of aggregate: sum.')
  })
  it('hints name the first piece that is still missing', () => {
    const ref = 'SELECT l.machine_id, SUM(d.qty) FROM defects d JOIN lots l ON l.lot_id = d.lot_id GROUP BY l.machine_id;'
    expect(missingPiece(sql('from defects'), ref)).toBe('You need the lots table.')
    expect(missingPiece(sql('from defects', 'join lots using lot id'), ref)).toBe('You need a group by.')
    expect(missingPiece(sql('from defects', 'join lots using lot id', 'group by machine id'), ref)).toBeNull()
    expect(missingPiece('SELECT * FROM lots', 'SELECT * FROM lots l LEFT JOIN defects d ON d.lot_id = l.lot_id WHERE d.defect_id IS NULL')).toBe('You need the defects table.')
    expect(missingPiece('SELECT * FROM lots JOIN defects USING (lot_id)', 'SELECT * FROM lots l LEFT JOIN defects d ON d.lot_id = l.lot_id')).toMatch(/left join/)
    const shape = sqlShape('WITH r AS (SELECT a, RANK() OVER (ORDER BY b DESC) AS n FROM lots) SELECT a FROM r WHERE n = 1')
    expect([...shape.tables]).toEqual(['lots'])
    expect(shape.features.has('order by')).toBe(false) // the window's ORDER BY is not the query's
    expect([...shape.features].sort()).toEqual(['step', 'where', 'window'])
  })
})

describe('commands are whole utterances', () => {
  it('recognizes them', () => {
    expect(parseBuildCommand('tables', schema)).toEqual({ t: 'tables' })
    expect(parseBuildCommand('What tables are there?', schema)).toEqual({ t: 'tables' })
    expect(parseBuildCommand('columns of lots', schema)).toEqual({ t: 'columns', table: 'lots' })
    expect(parseBuildCommand('describe the defect codes table', schema)).toEqual({ t: 'columns', table: 'defect_codes' })
    expect(parseBuildCommand("what's in machines", schema)).toEqual({ t: 'columns', table: 'machines' })
    expect(parseBuildCommand('read it back', schema)).toEqual({ t: 'readBack' })
    expect(parseBuildCommand('results', schema)).toEqual({ t: 'results' })
    expect(parseBuildCommand("what's wrong", schema)).toEqual({ t: 'compare' })
    expect(parseBuildCommand('scratch that', schema)).toEqual({ t: 'undo' })
    expect(parseBuildCommand('start over', schema)).toEqual({ t: 'startOver' })
    expect(parseBuildCommand('remove the where', schema)).toEqual({ t: 'remove', what: 'where' })
    expect(parseBuildCommand('drop order by', schema)).toEqual({ t: 'remove', what: 'orderBy' })
    expect(parseBuildCommand('name it per machine', schema)).toEqual({ t: 'name', name: 'per_machine' })
    expect(parseBuildCommand('save this as ranked', schema)).toEqual({ t: 'name', name: 'ranked' })
    expect(parseBuildCommand('run it', schema)).toEqual({ t: 'done' })
    expect(parseBuildCommand('show me', schema)).toEqual({ t: 'showMe' })
  })
  it('but a clause that mentions the same words is still a clause', () => {
    expect(parseBuildCommand('select lot id from lots', schema)).toBeNull()
    expect(parseBuildCommand('where quantity greater than 400', schema)).toBeNull()
    expect(parseBuildCommand('order by total descending', schema)).toBeNull()
  })
  it('removing a clause that is not there says so', () => {
    expect(removeClause(emptyFrame(), 'where').note).toMatch(/nothing like that/)
    expect(build(['from lots', 'where shift equals night', 'remove where']).sql).toBe('SELECT *\nFROM lots')
  })
})
