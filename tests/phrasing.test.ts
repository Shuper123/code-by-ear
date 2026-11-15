// Pauses inside a spoken line of code: after Then, commas, equals, a variable used again, and before SQL clauses.
import { describe, expect, it } from 'vitest'
import { codeLines, codePhrases, drillSpeech, pythonVariables, spokenIdentifiers } from '../src/speech/phrasing'
import { loadDrills } from './helpers'

const drills = loadDrills()
const phrased = (id: string) => {
  const d = drills.find((x) => x.id === id)!
  return codePhrases(d.code, d.code_spoken, d.lang)
}

describe('phrases inside a line of code', () => {
  it("your example: x equals (pause) 7, then (pause) x equals (pause) x (pause) plus 3", () => {
    expect(phrased('py-p1-predict-001')).toEqual([['x equals', '7.'], ['Then', 'x equals', 'x', 'plus 3.'], ['Then', 'print x.']])
  })
  it('a variable gets a pause when it comes back, not on its own definition line', () => {
    expect(phrased('py-p1-bug-001')).toEqual([
      ['Line 1,', 'count equals', 'the string 5.'],
      ['Line 2,', 'total equals', 'count', 'plus 3.'],
      ['Line 3,', 'print total.'],
    ])
    expect(phrased('py-p3-predict-002')[2]).toEqual(['After the loop,', 'print total.'])
    expect(phrased('py-p4-bug-002')[1]).toEqual(['Line 2,', 'inside,', 'return sum of nums', 'divided by len of nums.'])
  })
  it('no pause inside one expression: "stock at key pin", "name dot upper", "nums from index 1"', () => {
    expect(phrased('py-p5-predict-001')[1]).toEqual(['Then', 'add 5 to stock at key pin.'])
    expect(phrased('py-p1-predict-006')[1]).toEqual(['Then', 'print name dot upper.'])
    expect(phrased('py-p2-predict-002')[1]).toEqual(['Then', 'print nums from index 1 up to 3.'])
    expect(phrased('py-p5-bug-001')[1]).toEqual(['Line 2,', 'stock dot append of a dictionary where pin maps to 15.'])
  })
  it('the items of a list stay together; the clause after the list gets its pause', () => {
    expect(phrased('py-p2-predict-002')[0]).toEqual(['nums equals', 'the list 10, 20, 30, 40.'])
    expect(phrased('py-p3-predict-002')[1]).toEqual(['For each n in the list 1, 2, 3, 4,', 'inside the loop,', 'add n to total.'])
    expect(phrased('py-p6-predict-003')).toEqual([['Print list of zip of the list 1, 2 and the list of strings a, b.']])
  })
  it('a date keeps its year', () => {
    expect(phrased('sql-s2-explain-001')[0].at(-1)).toBe('where produced on is between February 1st and February 28th, 2026.')
  })
  it('keeps "value of qty" and function calls together, and pauses at commas', () => {
    expect(phrased('py-p1-predict-005')).toEqual([['qty equals', '40.'], ['Then', 'print the f string,', 'Lot has,', 'value of qty,', 'parts.']])
    expect(phrased('py-p4-predict-004')[1]).toEqual(['Then', 'print check of 3.'])
  })
  it('SQL: a pause before each clause, and multi-word names stay whole', () => {
    expect(phrased('sql-s1-predict-004')).toEqual([['Select part name', 'from parts,', 'limit 20.']])
    expect(phrased('sql-s4-explain-002')[0]).toEqual([
      'Select o dot order id and c dot name', 'from orders o,', 'joined to customers c', 'on c dot customer id equals',
      'o dot customer id,', 'where o dot status is cancelled.',
    ])
    expect(phrased('sql-s6-bug-002')[1]).toEqual(['Line 2,', 'row number over', 'order by produced on,', 'as nth.'])
    expect(phrased('sql-s4-predict-005')[0]).toEqual([
      'Select the count of rows', 'from lots l,', 'left joined to defects d', 'on d dot lot id equals', 'l dot lot id,', 'where l dot lot id is 3.',
    ])
  })
  it('finds variables and names in the code', () => {
    expect([...pythonVariables('def count_above(nums, limit):\n    count = 0\n    for n in nums:\n        count += 1\n    return count')].sort())
      .toEqual(['count', 'limit', 'n', 'nums'])
    expect(pythonVariables('stock["pin"] += 5\nx, y = 1, 2\nwith open(p) as f:\n    pass')).toEqual(new Set(['stock', 'x', 'y', 'f']))
    expect(spokenIdentifiers('SELECT lot_id, produced_on FROM lots')).toEqual(['lot id', 'produced on'])
  })
  it('every drill splits into phrases that read back as the same words', () => {
    for (const d of drills.filter((x) => x.code_spoken)) {
      const pieces = codePhrases(d.code, d.code_spoken, d.lang)
      for (const phrases of pieces) {
        expect(phrases.every((p) => p.trim().length > 0)).toBe(true)
      }
      expect(pieces.map((p) => p.join(' ')).join(' ')).toBe(d.code_spoken!.replace(/\s+/g, ' ').trim())
    }
  })
})

describe('what the voice says', () => {
  it('every phrase but the last ends in a comma, so it sounds unfinished; the screen keeps the line', () => {
    const d = drills.find((x) => x.id === 'py-p1-predict-001')!
    expect(codeLines(d)).toEqual([
      { text: 'x equals 7.', phrases: ['x equals,', '7.'] },
      { text: 'Then x equals x plus 3.', phrases: ['Then,', 'x equals,', 'x,', 'plus 3.'] },
      { text: 'Then print x.', phrases: ['Then,', 'print x.'] },
    ])
  })
  it("a drill's speech lists each line whole and, for lines with pauses, each phrase", () => {
    const d = drills.find((x) => x.id === 'py-p1-predict-001')!
    const speech = drillSpeech(d)
    expect(speech.filter((x) => x.style === 'code').map((x) => x.text)).toEqual(['x equals 7.', 'Then x equals x plus 3.', 'Then print x.'])
    expect(speech.filter((x) => x.style === 'phrase').map((x) => x.text)).toEqual(['x equals,', '7.', 'Then,', 'x equals,', 'x,', 'plus 3.', 'Then,', 'print x.'])
    expect(speech.some((x) => x.style === 'prose' && x.text === d.prompt_spoken)).toBe(true)
  })
})

