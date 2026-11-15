// The dictation editor on screen: numbered lines, the cursor, the selection, the line with a syntax
// error, and a character ruler under the cursor's line, so "edit at line 2, character 7" is easy to aim.
import type { EditorSnapshot } from '../verbal/editor'

function Ruler({ length, col }: { length: number; col: number }) {
  // "····5····10···15": numbers end on the character they count; the cursor's character is highlighted
  const n = Math.max(length + 1, col + 1, 10)
  const marks = Array<string>(n).fill('·')
  for (let k = 5; k <= n; k += 5) {
    const s = String(k)
    for (let j = 0; j < s.length; j++) if (k - s.length + j >= 0) marks[k - s.length + j] = s[j]
  }
  return (
    <div class="ruler" aria-hidden="true">
      {marks.map((m, i) => (
        <span key={i} class={i === col ? 'ruler-cur' : ''}>
          {m}
        </span>
      ))}
    </div>
  )
}

export function EditorView({ ed, lang }: { ed: EditorSnapshot; lang: 'sql' | 'python' }) {
  const sel = ed.anchor && (ed.anchor.line !== ed.cursor.line || ed.anchor.col !== ed.cursor.col)
    ? ed.anchor.line < ed.cursor.line || (ed.anchor.line === ed.cursor.line && ed.anchor.col < ed.cursor.col)
      ? { start: ed.anchor, end: ed.cursor }
      : { start: ed.cursor, end: ed.anchor }
    : null
  const inSel = (li: number, ci: number) =>
    !!sel &&
    (li > sel.start.line || (li === sel.start.line && ci >= sel.start.col)) &&
    (li < sel.end.line || (li === sel.end.line && ci < sel.end.col))
  return (
    <div class="card">
      <div class="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <div class="step">Your code</div>
        <div class="row" style={{ gap: '6px' }}>
          <span class={`pill ${ed.mode === 'keys' ? 'warn' : 'ok'}`}>{ed.mode === 'keys' ? 'Keys mode' : 'Code mode'}</span>
          {ed.caps && <span class="pill warn">Caps</span>}
        </div>
      </div>
      <div class="editor" role="textbox" aria-label={`${lang === 'sql' ? 'SQL' : 'Python'} code`}>
        {ed.lines.map((line, li) => {
          const chars = [...line]
          const isCur = li === ed.cursor.line
          const isErr = ed.error?.line === li + 1
          return (
            <div key={li} class={`ed-line${isCur ? ' ed-cur' : ''}${isErr ? ' ed-err' : ''}`}>
              <span class="ed-num">{li + 1}</span>
              <span class="ed-text">
                {chars.map((ch, ci) => (
                  <>
                    {isCur && ci === ed.cursor.col && <span class="caret" />}
                    <span class={inSel(li, ci) ? 'ed-sel' : ''}>{ch === ' ' ? ' ' : ch}</span>
                  </>
                ))}
                {isCur && ed.cursor.col >= chars.length && <span class="caret" />}
              </span>
              {isCur && (
                <div class="ed-ruler-row">
                  <span class="ed-num" />
                  <Ruler length={chars.length} col={ed.cursor.col} />
                </div>
              )}
            </div>
          )
        })}
      </div>
      <p class="small" style={{ marginTop: '6px' }}>
        Line {ed.cursor.line + 1}, character {ed.cursor.col + 1}
      </p>
      {ed.error && (
        <p class="small ed-error">
          {ed.error.line ? `Line ${ed.error.line}: ` : ''}
          {ed.error.message}
        </p>
      )}
      {ed.status && !ed.error && <p class="small">{ed.status}</p>}
    </div>
  )
}
