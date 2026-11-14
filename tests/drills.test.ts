// Content checks that need the app's own normalizer (the Python validator checks that every
// drill runs and that its expected output is right).
import { describe, expect, it } from 'vitest'
import { answersMatch } from '../src/grading/normalize'
import { loadDrills, sayNumbers } from './helpers'

const drills = loadDrills()
const predicts = drills.filter((d) => d.type === 'predict')

describe('drill answer keys', () => {
  it('has drills to check', () => {
    expect(drills.length).toBeGreaterThanOrEqual(80)
    expect(predicts.length).toBeGreaterThan(40)
  })
  for (const d of predicts) {
    it(`${d.id}: the expected answer, said aloud, is accepted`, () => {
      const expected = d.expected ?? ''
      expect(answersMatch(expected, expected, [], { strictNumbers: d.strict_numbers })).toBe(true)
      if (!d.strict_numbers) {
        expect(answersMatch(sayNumbers(expected), expected, d.accept ?? [])).toBe(true)
        expect(answersMatch(`it returns ${expected}`, expected, d.accept ?? [])).toBe(true)
      }
      for (const a of d.accept ?? []) expect(answersMatch(a, expected, d.accept ?? [], { strictNumbers: d.strict_numbers })).toBe(true)
    })
  }
  it('every drill id is unique', () => {
    expect(new Set(drills.map((d) => d.id)).size).toBe(drills.length)
  })
})
