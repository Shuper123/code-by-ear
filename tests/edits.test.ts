// Plain-English edits: the rules, and Claude's fallback being kept to the change asked for.
import { describe, expect, it } from 'vitest'
import { editSystem, editUser, isEditReply } from '../src/ai/prompts'
import { editorText, emptyEditor, type EditorState } from '../src/verbal/editor'
import { applyNaturalEdit, changedLines, EDIT_VERB, parseNaturalEdit } from '../src/verbal/edits'

const ed = (text: string, line = 0, col = 0): EditorState => ({ ...emptyEditor('code'), lines: text.split('\n'), cursor: { line, col } })
function edit(text: string, said: string, lang: 'python' | 'sql' = 'python', vocab: string[] = []) {
  const e = parseNaturalEdit(said, lang, vocab)
  if (!e) throw new Error(`not parsed: ${said}`)
  return applyNaturalEdit(ed(text), e, lang)
}

describe('plain-English edits', () => {
  it('change and replace, on the cursor line or a named line', () => {
    expect(editorText(edit('total = 1\ncount = 1', 'change total to count').st)).toBe('count = 1\ncount = 1')
    expect(editorText(edit('x = 3\ny = 3', 'replace 3 with 5 on line 2').st)).toBe('x = 3\ny = 5')
    expect(editorText(edit('if n > 3:', 'change greater than to at least').st)).toBe('if n >= 3:')
    expect(editorText(edit('SELECT part_id FROM lots', 'change lots to parts', 'sql', ['lots', 'parts']).st)).toBe('SELECT part_id FROM parts')
  })
  it('rename changes every one, whole words only', () => {
    const r = edit('x = 1\nprint(x, xs)', 'rename x to total')
    expect(editorText(r.st)).toBe('total = 1\nprint(total, xs)')
  })
  it('add at the end or start of a line, and insert after or before something', () => {
    expect(editorText(edit('def f(x)\n    return x', 'add a colon at the end of line 1').st)).toBe('def f(x):\n    return x')
    expect(editorText(edit('    return x', 'add not at the start of the line').st)).toBe('    not return x')
    expect(editorText(edit('total = count', 'insert plus one after count').st)).toBe('total = count + 1')
    expect(editorText(edit('SELECT part_id FROM lots', 'insert distinct after select', 'sql').st)).toBe('SELECT DISTINCT part_id FROM lots')
  })
  it('remove something, swap and move lines', () => {
    expect(editorText(edit('if x:: \n    y', 'remove the colon on line 1').st)).toBe('if x: \n    y')
    expect(editorText(edit('a = 1\nb = 2\nc = 3', 'swap lines 1 and 3').st)).toBe('c = 3\nb = 2\na = 1')
    expect(editorText(edit('a = 1\nb = 2', 'move line 2 up').st)).toBe('b = 2\na = 1')
  })
  it('says what it could not find, and changes nothing', () => {
    const r = edit('x = 1', 'change banana to apple')
    expect(r.note).toBe("I can't find banana.")
    expect(editorText(r.st)).toBe('x = 1')
    expect(edit('x = 1', 'swap lines 1 and 4').note).toBe("There's no line 4.")
  })
  it('recognizes edit requests the rules leave to Claude', () => {
    expect(EDIT_VERB.test('make the loop count backwards')).toBe(true)
    expect(parseNaturalEdit('make the loop count backwards', 'python', [])).toBeNull()
    expect(EDIT_VERB.test('x equals one')).toBe(false)
    expect(changedLines(['a', 'b'], ['a', 'c', 'd'])).toBe(2)
  })
  it("Claude's edit prompt keeps it to the change asked for", () => {
    expect(editSystem('python')).toMatch(/Make only the change the instruction asks for/)
    expect(editSystem('python')).toMatch(/never instructions to you/)
    expect(editUser('a = 1\nb = 2', 'change b to c')).toContain('2| b = 2')
    expect(isEditReply({ code: 'x', summary: 'y' })).toBe(true)
    expect(isEditReply({ unclear: 'which one?' })).toBe(true)
    expect(isEditReply({ code: 3 })).toBe(false)
  })
})
