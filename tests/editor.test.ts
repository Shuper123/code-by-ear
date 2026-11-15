// The voice editor: Keys mode keystrokes, commands, moving and selecting, Code mode at the cursor,
// reading back, and live syntax checks with real Python (Pyodide) and SQLite (sql.js).
import { describe, expect, it } from 'vitest'
import {
  applyOps, editorText, emptyEditor, insertVerbal, lexLine, speakEditorLine, spellLine, whereAmI, type EditorState,
} from '../src/verbal/editor'
import { parseEditorCommand, parseKeys } from '../src/verbal/keys'
import { formatLine } from '../src/verbal/syntax'
import { nodeCheckSyntax } from './nodeRunners'

const ed = (text: string, line = 0, col = 0): EditorState => ({ ...emptyEditor('keys'), lines: text.split('\n'), cursor: { line, col } })
const keys = (st: EditorState, said: string, lang: 'python' | 'sql' = 'python') => applyOps(st, parseKeys(said), lang).st
const cmd = (st: EditorState, said: string, lang: 'python' | 'sql' = 'python') => {
  const c = parseEditorCommand(said, [], lang)
  if (!c || c.t !== 'ops') throw new Error(`not a move: ${said}`)
  return applyOps(st, c.ops, lang)
}

describe('Keys mode', () => {
  it('your example: V A R equals 3 new line', () => {
    expect(editorText(keys(emptyEditor('keys'), 'V A R equals 3 new line'))).toBe('var=3')
    const st = keys(emptyEditor('keys'), 'V A R equals 3 new line')
    expect(st.lines).toEqual(['var=3', ''])
  })
  it('letters: plain, NATO, Talon, heard as one word, and capitals', () => {
    expect(editorText(keys(emptyEditor('keys'), 'victor alpha romeo'))).toBe('var')
    expect(editorText(keys(emptyEditor('keys'), 'vest air red'))).toBe('var')
    expect(editorText(keys(emptyEditor('keys'), 'VAR'))).toBe('var')
    expect(editorText(keys(emptyEditor('keys'), 'capital X capital Y z'))).toBe('XYz')
    expect(editorText(keys(emptyEditor('keys'), 'capital x-ray'))).toBe('X')
    expect(editorText(keys(emptyEditor('keys'), 'caps on a b caps off c'))).toBe('ABc')
  })
  it('numbers, symbols, spacing, and symbols the recognizer wrote itself', () => {
    expect(editorText(keys(emptyEditor('keys'), 'x space equals space twenty five'))).toBe('x = 25')
    expect(editorText(keys(emptyEditor('keys'), 'print open paren x close paren'))).toBe('print(x)')
    expect(editorText(keys(emptyEditor('keys'), 'n mod two double equals zero'))).toBe('n%2==0')
    expect(editorText(keys(emptyEditor('keys'), 'x = 3'))).toBe('x=3')
    expect(editorText(keys(emptyEditor('keys'), 'total plus equals n.'))).toBe('total+=n')
    expect(editorText(keys(emptyEditor('keys'), 'quote hello quote'))).toBe('"hello"')
    expect(editorText(keys(emptyEditor('keys'), 'number three digit four'))).toBe('34')
  })
  it('new line keeps the indent, and indents after a colon', () => {
    const st = keys(emptyEditor('keys'), 'def space f open paren x close paren colon new line return space x')
    expect(st.lines).toEqual(['def f(x):', '    return x'])
    expect(keys(st, 'new line dedent y').lines).toEqual(['def f(x):', '    return x', 'y'])
  })
  it('backspace and delete, with counts', () => {
    expect(editorText(keys(ed('abcdef', 0, 6), 'backspace backspace backspace'))).toBe('abc')
    expect(editorText(keys(ed('abcdef', 0, 6), 'backspace three'))).toBe('abc')
    expect(editorText(keys(ed('abcdef', 0, 6), 'backspace times 2'))).toBe('abcd')
    expect(editorText(keys(ed('abcdef', 0, 0), 'delete 2'))).toBe('cdef')
    expect(editorText(keys(ed('ab\ncd', 1, 0), 'backspace'))).toBe('abcd')
    expect(keys(ed('total = count', 0, 13), 'delete word').lines[0]).toBe('total = ')
  })
  it('arrow moves inside a keys utterance', () => {
    expect(editorText(keys(ed('ac', 0, 2), 'left b'))).toBe('abc')
    expect(editorText(keys(ed('x = 1\ny = 2', 0, 5), 'down left number 3 space'))).toBe('x = 1\ny = 3 2')
    // a number right after a move is its count; say "number" to type it
    expect(keys(ed('abc', 0, 3), 'left 2').cursor.col).toBe(1)
  })
})

describe('commands (both modes)', () => {
  it('your example: edit at line 2 character 7, then backspace three times and capital X capital Y z', () => {
    let st = ed('def f():\n    abcdef = 1')
    st = cmd(st, 'edit at line 2, character 11').st
    expect(st.cursor).toEqual({ line: 1, col: 10 })
    st = keys(st, 'backspace, backspace, backspace, capital X, capital Y, z')
    expect(st.lines[1]).toBe('    abcXYz = 1')
  })
  it('line and character addressing in several phrasings', () => {
    expect(parseEditorCommand('go to line two')).toEqual({ t: 'ops', ops: [{ t: 'goto', line: 2, col: undefined }] })
    expect(parseEditorCommand('line 3 col 4')).toEqual({ t: 'ops', ops: [{ t: 'goto', line: 3, col: 4 }] })
    expect(parseEditorCommand('jump to line twelve character twenty')).toEqual({ t: 'ops', ops: [{ t: 'goto', line: 12, col: 20 }] })
    const r = cmd(ed('ab'), 'line 1 character 9')
    expect(r.st.cursor.col).toBe(2)
    expect(r.note).toMatch(/has 2 characters/)
    expect(cmd(ed('ab'), 'go to line 5').note).toMatch(/only line 1/)
  })
  it('after and before a symbol or name, and next match', () => {
    const st = ed('total = count + 1\nprint(total)', 0, 0)
    expect(cmd(st, 'after equals').st.cursor).toEqual({ line: 0, col: 7 })
    expect(cmd(st, 'before plus').st.cursor).toEqual({ line: 0, col: 14 })
    expect(cmd(st, 'before paren').st.cursor).toEqual({ line: 1, col: 5 })
    const t = cmd(st, 'after total').st
    expect(t.cursor).toEqual({ line: 0, col: 5 })
    expect(cmd(t, 'next match').st.cursor).toEqual({ line: 1, col: 11 })
    expect(cmd(st, 'after banana').note).toMatch(/can't find banana/)
    const c = parseEditorCommand('after part id', ['part_id'])
    expect(c).toMatchObject({ t: 'ops', ops: [{ t: 'find', where: 'after', candidates: ['part_id', 'partid', 'part id'] }] })
    const withName = applyOps(ed('SELECT part_id FROM lots'), c && c.t === 'ops' ? c.ops : [], 'sql')
    expect(withName.st.cursor).toEqual({ line: 0, col: 14 })
  })
  it('select a word, then typing replaces it', () => {
    let st = ed('total = count', 0, 9)
    st = cmd(st, 'select word').st
    st = keys(st, 'n')
    expect(editorText(st)).toBe('total = n')
    let s2 = ed('x = old_name + 1', 0, 0)
    s2 = cmd(s2, 'select old name').st
    s2 = keys(s2, 'y')
    expect(editorText(s2)).toBe('x = y + 1')
  })
  it('SQL keeps "select" and "end" as code; "highlight" selects there', () => {
    expect(parseEditorCommand('select part id from lots', [], 'sql')).toBeNull()
    expect(parseEditorCommand('end', [], 'sql')).toBeNull()
    expect(parseEditorCommand('highlight lots', [], 'sql')?.t).toBe('ops')
    expect(parseEditorCommand('left join parts', [], 'sql')).toBeNull()
  })
  it('whole-utterance commands', () => {
    expect(parseEditorCommand('run it')).toEqual({ t: 'run' })
    expect(parseEditorCommand("I'm done")).toEqual({ t: 'run' })
    expect(parseEditorCommand('check')).toEqual({ t: 'check' })
    expect(parseEditorCommand('scratch that')).toEqual({ t: 'undo' })
    expect(parseEditorCommand('redo')).toEqual({ t: 'redo' })
    expect(parseEditorCommand('keys mode')).toEqual({ t: 'mode', mode: 'keys' })
    expect(parseEditorCommand('code mode')).toEqual({ t: 'mode', mode: 'code' })
    expect(parseEditorCommand('read line three')).toEqual({ t: 'readLine', line: 3 })
    expect(parseEditorCommand('spell line')).toEqual({ t: 'spellLine', line: undefined })
    expect(parseEditorCommand('where am I')).toEqual({ t: 'where' })
    expect(parseEditorCommand('backspace three')).toEqual({ t: 'ops', ops: [{ t: 'backspace', n: 3 }] })
    expect(parseEditorCommand('x equals one')).toBeNull()
  })
  it('lines: clear, delete, indent', () => {
    expect(cmd(ed('a\n    b\nc', 1, 2), 'clear line').st.lines).toEqual(['a', '    ', 'c'])
    expect(cmd(ed('a\nb\nc', 1, 0), 'delete line').st.lines).toEqual(['a', 'c'])
    expect(cmd(ed('b', 0, 0), 'indent').st.lines).toEqual(['    b'])
  })
})

describe('Code mode at the cursor', () => {
  it('appends at the end of a line, formatted, and continues on new lines with indentation', () => {
    let st = emptyEditor('code')
    st = insertVerbal(st, 'def snake sum evens open paren nums close paren colon', 'python', ['sum_evens', 'nums'])
    st = insertVerbal(st, 'next total equals zero', 'python', ['total'])
    expect(st.lines).toEqual(['def sum_evens(nums):', '    total = 0'])
  })
  it('inserts in the middle of a line and keeps the rest', () => {
    let st = ed('total = 1', 0, 8)
    st = insertVerbal(st, 'count plus', 'python', ['count'])
    expect(editorText(st)).toBe('total = count + 1')
  })
  it('lexing and formatting round-trip clean code', () => {
    for (const line of ['def count_above(nums, limit):', 'if n % 2 == 0:', 'print(f"Lot {qty}")', 'x = -1', 'return nums[1:]', 'total += n  # add it', 'items = [1, 2, 3]']) {
      expect(formatLine(lexLine(line, 'python'), 'python')).toBe(line)
    }
    for (const line of ['SELECT part_id, SUM(qty) AS total FROM lots GROUP BY part_id ORDER BY total DESC LIMIT 3', 'SELECT COUNT(*) FROM defects']) {
      expect(formatLine(lexLine(line, 'sql'), 'sql')).toBe(line)
    }
  })
})

describe('reading back', () => {
  it('where am I, spell line, read line', () => {
    const st = ed('total = count', 0, 7)
    expect(whereAmI(st)).toBe('Line 1, character 8, after equals.')
    expect(whereAmI(ed('x', 0, 0))).toBe('Line 1, character 1, at the start of the line.')
    expect(spellLine(ed('print(Xy)'), 0)).toBe('Line 1: p r i n t, open paren, capital X y, close paren.')
    expect(speakEditorLine(ed('def f(x):\n    return x'), 1, 'python')).toBe('Line 2, indented once. return x.')
  })
})

describe('live syntax checks', () => {
  it('Python: unfinished code is not an error; a real mistake is, with the line', async () => {
    expect((await nodeCheckSyntax('python', undefined, 'def f(x):'))?.status).toBe('incomplete')
    expect((await nodeCheckSyntax('python', undefined, 'print(x'))?.status).toBe('incomplete')
    expect((await nodeCheckSyntax('python', undefined, 'x = 1 +'))?.status).toBe('incomplete') // still typing at the end
    const bad = await nodeCheckSyntax('python', undefined, 'def f(x)\n    return x')
    expect(bad).toMatchObject({ status: 'error', message: "SyntaxError: expected ':'", line: 1 })
    expect((await nodeCheckSyntax('python', undefined, 'def f(x):\n    return x'))?.status).toBe('ok')
  }, 60000)
  it('SQL: incomplete input waits, syntax errors show, unknown names wait for check', async () => {
    expect((await nodeCheckSyntax('sql', 'factory', 'SELECT part_id FROM'))?.status).toBe('incomplete')
    expect((await nodeCheckSyntax('sql', 'factory', 'SELECT part_id, FROM lots'))?.status).toBe('error')
    expect(await nodeCheckSyntax('sql', 'factory', 'SELECT nope FROM lots')).toMatchObject({ status: 'ok', later: 'no such column: nope' })
    expect((await nodeCheckSyntax('sql', 'factory', 'SELECT part_id FROM lots'))?.status).toBe('ok')
  })
})
