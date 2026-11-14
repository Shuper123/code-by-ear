import { describe, expect, it } from 'vitest'
import { answersMatch, answerTokens, mentionedLines } from '../src/grading/normalize'

const yes: [string, string, string[]?][] = [
  ['one', '1'],
  ['it prints one', '1'],
  ['twenty five', '25'],
  ['three point five', '3.5'],
  ['negative two', '-2'],
  ['minus 250', '-250'],
  ['true', 'True'],
  ['none', 'None'],
  ['one, two, three', '[1, 2, 3]'],
  ['the list one two three', '[1, 2, 3]'],
  ['index error', 'IndexError'],
  ['an index error', 'IndexError'],
  ['it raises a zero division error', 'ZeroDivisionError'],
  ['key error', 'KeyError'],
  ['clip clip', 'clipclip'],
  ['123', '[1, 2, 3]'],
  ['a hundred and five', '105'],
  ['one hundred twenty', '120'],
  ['two thousand twenty six', '2026'],
  ['1,000', '1000'],
  ['it prints 1 because sorting puts the smallest first', '1'],
  ['hi ana then none', 'Hi Ana\nNone'],
  ['lot has forty parts', 'Lot has 40 parts'],
  ['b maps to two', "{'b': 2}"],
  ['1 a 2 b', "[(1, 'a'), (2, 'b')]"],
  ['one with a and two with b', "[(1, 'a'), (2, 'b')]"],
  ['zero two four', '0\n2\n4'],
  ['null', 'NULL'],
  ['an empty list', '[]'],
  ['lot 2', '2'],
  ['lot four', '4'],
  ['the letter a', 'a'],
  ['it prints a', 'a'],
  ['bracket', 'BRACKET'],
  ['end', 'end'],
  ['ninety and one twenty', '90\n120'],
  ['120 460 550', '120\n460\n550'],
  ['null 220 negative 250', 'NULL\n220\n-250'],
  ['three one', '3 1'],
  ['31', '3 1'],
  ['bracket in capitals', 'BRACKET', ['bracket in capitals']],
  ["I think it's 14", '14'],
  ['fourteen', '14'],
  ['105', '105.0'],
  ['It returns 5.', '5'],
  ['twelve', '12'],
  ['four point oh', '4.0'],
  ['the string hello world', 'hello world'],
  ['high', 'high'],
  ['un known', 'unknown'],
]
const no: [string, string][] = [
  ['two', '3'],
  ['one two', '[1, 2, 3]'],
  ['even', 'end'],
  ['', '1'],
  ['forty', '14'],
  ['low', 'high'],
  ['key error', 'IndexError'],
  ['three hundred', '3'],
  ['true', 'False'],
]

describe('answersMatch: accepted answers', () => {
  for (const [spoken, expected, accept] of yes) {
    it(`"${spoken}" matches ${JSON.stringify(expected)}`, () => {
      expect(answersMatch(spoken, expected, accept ?? [])).toBe(true)
    })
  }
})

describe('answersMatch: rejected answers', () => {
  for (const [spoken, expected] of no) {
    it(`"${spoken}" does not match ${JSON.stringify(expected)}`, () => {
      expect(answersMatch(spoken, expected)).toBe(false)
    })
  }
})

describe('strict numbers', () => {
  it('keeps 4 and 4.0 apart when the drill needs it', () => {
    expect(answersMatch('four', '4.0', [], { strictNumbers: true })).toBe(false)
    expect(answersMatch('four point oh', '4.0', [], { strictNumbers: true })).toBe(true)
    expect(answersMatch('4.0', '4.0', [], { strictNumbers: true })).toBe(true)
    expect(answersMatch('four', '4.0')).toBe(true)
  })
})

describe('answerTokens', () => {
  it('turns number words into digits without merging a list', () => {
    expect(answerTokens('one two three')).toEqual(['1', '2', '3'])
    expect(answerTokens('twenty five and six')).toEqual(['25', '6'])
    expect(answerTokens('point five')).toEqual(['0.5'])
  })
})

describe('mentionedLines', () => {
  it('finds line numbers in spot-the-bug answers', () => {
    expect(mentionedLines('line 2, count is a string')).toEqual([2])
    expect(mentionedLines('the bug is on line three')).toEqual([3])
    expect(mentionedLines('the third line is wrong')).toEqual([3])
    expect(mentionedLines('no idea')).toEqual([])
  })
})
