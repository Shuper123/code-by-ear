import { describe, expect, it } from 'vitest'
import { canonCell, compareRows } from '../src/grading/sqlCompare'

const rs = (columns: string[], rows: unknown[][]) => ({ columns, rows })

describe('row comparison', () => {
  it('ignores row order unless order matters', () => {
    const a = rs(['x'], [[1], [2], [3]])
    const b = rs(['x'], [[3], [1], [2]])
    expect(compareRows(a, b, false).equal).toBe(true)
    const r = compareRows(a, b, true)
    expect(r.equal).toBe(false)
    expect(r.note).toMatch(/wrong order/)
  })
  it('ignores column names', () => {
    expect(compareRows(rs(['total'], [[5]]), rs(['SUM(qty)'], [[5]]), false).equal).toBe(true)
  })
  it('accepts the same columns in a different order', () => {
    const mine = rs(['total', 'part_id'], [[10, 1], [20, 2]])
    const ref = rs(['part_id', 'total'], [[1, 10], [2, 20]])
    expect(compareRows(mine, ref, false).equal).toBe(true)
  })
  it('handles NULLs', () => {
    expect(compareRows(rs(['a'], [[null], [1]]), rs(['a'], [[1], [null]]), false).equal).toBe(true)
    expect(compareRows(rs(['a'], [[null]]), rs(['a'], [[0]]), false).equal).toBe(false)
  })
  it('compares floats to 6 decimal places and treats 3.0 as 3', () => {
    expect(compareRows(rs(['a'], [[273.6666666666667]]), rs(['a'], [[273.666667]]), false).equal).toBe(true)
    expect(compareRows(rs(['a'], [[3.0]]), rs(['a'], [[3]]), false).equal).toBe(true)
    expect(canonCell(-0)).toBe(0)
  })
  it('counts duplicate rows', () => {
    const r = compareRows(rs(['a'], [[1], [1], [2]]), rs(['a'], [[1], [2], [2]]), false)
    expect(r.equal).toBe(false)
    expect(r.missing).toEqual([2])
    expect(r.extra).toEqual([1])
  })
  it('explains the difference in plain words', () => {
    const r = compareRows(rs(['a', 'b'], [[1, 2]]), rs(['a'], [[1]]), false)
    expect(r.note).toBe('Your query returns 2 columns; the answer has 1.')
    const r2 = compareRows(rs(['a'], [[1]]), rs(['a'], [[1], [2]]), false)
    expect(r2.note).toMatch(/^Your query returns 1 rows; the answer has 2\. Missing a row like: 2\./)
  })
  it('treats two empty results as equal', () => {
    expect(compareRows(rs(['a'], []), rs(['a'], []), false).equal).toBe(true)
  })
})
