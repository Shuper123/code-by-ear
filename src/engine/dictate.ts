// Dictate (Level 3, Parked only): dictate exact code over as many utterances as you like, in Code mode
// (Verbal Syntax) or Keys mode (one keystroke per word), moving and editing by voice while the code and
// Python's or SQLite's own syntax errors show live; "run it" runs the tests or compares rows.
// Fully works without AI; with a key, failures get a plain-words explanation (spec section 6).
import { speakable, type EditReply } from '../ai/prompts'
import type { Drill } from '../data/types'
import type { Command } from '../speech/commands'
import {
  applyOps,
  editorText,
  emptyEditor,
  insertVerbal,
  snapshot,
  speakEditor,
  speakEditorLine,
  spellLine,
  whereAmI,
  type EditorMode,
  type EditorState,
} from '../verbal/editor'
import { applyNaturalEdit, changedLines, EDIT_VERB, parseNaturalEdit } from '../verbal/edits'
import { parseEditorCommand, parseKeys } from '../verbal/keys'
import type { Score } from './scheduler'
import { scoreCue, type DrillContext, type TypeHook } from './session'
import { runSketch, type Runners, type SyntaxCheck } from './sketch'

export interface DictateAi {
  available(): boolean
  explainError(d: Drill, learnerCode: string, failure: string, signal?: AbortSignal): Promise<string | null>
  /** A spoken edit the rules couldn't do ("make the loop go backwards"); only that change, never a fix. */
  editCode?(d: Drill, code: string, instruction: string, signal?: AbortSignal): Promise<EditReply | null>
}

/** Session commands that stay live while dictating ("done" and "next" are Verbal Syntax here). */
export const DICTATE_COMMANDS: readonly Command[] = ['repeat', 'hint', 'skip', 'idk', 'answer', 'read_back', 'pause', 'stop', 'wait']

/** Problems the learner can fix by editing before the attempt is graded. */
const FIXABLE = /SyntaxError|IndentationError|syntax error|incomplete input|unterminated|no such column|no such table|ambiguous column|is not defined/i

function sayFixable(failure: string): string {
  const fn = failure.match(/function (\w+) is not defined/)
  if (fn) return `I can't find a function named ${fn[1].replace(/_/g, ' ')}. Check the def line.`
  const col = failure.match(/no such (column|table): ([\w.]+)/i)
  if (col) return `There's no ${col[1]} called ${col[2].replace(/[_.]/g, ' ')}. Check the names.`
  const line = failure.match(/line (\d+)/)?.[1]
  return `That doesn't parse yet${line ? `, around line ${line}` : ''}.`
}

function speakSignature(sig: string): string {
  // "def count_above(nums, limit):" -> "def count above open paren nums comma limit close paren colon"
  return sig
    .replace(/\(/g, ' open paren ')
    .replace(/\)/g, ' close paren ')
    .replace(/,/g, ' comma ')
    .replace(/:/g, ' colon ')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function dictatePrompt(d: Drill): string {
  const task = d.prompt_spoken.replace(/^Dictate this in Verbal Syntax\.\s*/, '')
  const start = d.lang === 'python' && d.signature ? ` Start with ${speakSignature(d.signature)}.` : ''
  return `Dictate. ${task}${start} Say run it when you're done.`
}

export interface DictateOptions {
  /** Which mode a Dictate drill starts in. */
  startMode?: () => EditorMode
}

export function makeDictateHook(ai: DictateAi | null, runners: Runners, opts: DictateOptions = {}): TypeHook {
  return {
    thinkMs: 30000,
    async intro(ctx: DrillContext) {
      if (ctx.drill.lang === 'python') runners.preloadPython()
    },
    promptText: dictatePrompt,
    async grade(ctx: DrillContext, first: string) {
      const d = ctx.drill
      const lang = d.lang
      const vocab = d.vocab ?? []
      let st: EditorState = emptyEditor(opts.startMode?.() ?? 'code')
      const history: EditorState[] = []
      const future: EditorState[] = []
      let pending: string | null = first
      let silent = 0
      let hintIdx = 0
      let lastCheck: SyntaxCheck | null = null

      const show = (status?: string) =>
        ctx.show({
          code: editorText(st) || ' ',
          note: undefined,
          editor: snapshot(st, {
            error: lastCheck?.status === 'error' && lastCheck.message ? { message: lastCheck.message, line: lastCheck.line } : undefined,
            status,
          }),
        })

      let seq = 0
      let waitingForPython = false
      const check = async (): Promise<SyntaxCheck | null> => {
        const code = editorText(st)
        const mine = ++seq
        if (!runners.checkSyntax || !code.trim()) return (lastCheck = null)
        if (lang === 'python' && !runners.pythonReady()) {
          // check as soon as Python has loaded, unless the code changed again by then
          if (!waitingForPython && runners.loadPython) {
            waitingForPython = true
            void runners.loadPython().then(
              async () => {
                waitingForPython = false
                if (mine === seq && !ctx.signal.aborted) {
                  await check()
                  show()
                }
              },
              () => (waitingForPython = false),
            )
          } else runners.preloadPython()
          return (lastCheck = null)
        }
        lastCheck = await runners.checkSyntax(lang, d.dataset, code).catch(() => null)
        return lastCheck
      }

      const change = async (next: EditorState) => {
        history.push(st)
        if (history.length > 200) history.shift()
        future.length = 0
        st = next
        await check()
        show()
      }

      const runIt = async (): Promise<'graded' | 'continue'> => {
        const code = editorText(st)
        if (!code.trim()) {
          await ctx.say("There's no code yet. Keep dictating.")
          return 'continue'
        }
        if (lang === 'python' && !runners.pythonReady()) await ctx.say('Loading Python. The first time takes a moment.')
        const hints = Math.max(ctx.hints, hintIdx)
        const run = await runSketch(d, code, runners, hints)
        if (run.failure && FIXABLE.test(run.failure)) {
          lastCheck = { status: 'error', message: run.failure, line: Number(run.failure.match(/line (\d+)/)?.[1]) || undefined }
          show(run.failure)
          await ctx.cue('incorrect')
          await ctx.say(`${sayFixable(run.failure)} Fix it, then say run it. You can say read line or read it back.`)
          return 'continue'
        }
        ctx.show({ code, note: run.failure ?? 'Passed.', editor: snapshot(st, { status: run.failure ?? 'Passed.' }) })
        await ctx.cue(scoreCue(run.score))
        if (!run.failure) {
          await ctx.say(lang === 'sql' ? 'Correct. Your rows match the answer.' : 'Correct. All the tests pass.')
        } else {
          const why = ai?.available() ? await ai.explainError(d, code, run.failure, ctx.signal) : null
          await ctx.say(why ?? `It didn't pass. ${speakable(run.failure, 40)}`)
          if (run.score === 0) await ctx.say(`Here's one way to do it. ${d.model_answer_spoken}`)
        }
        await ctx.saveNote('dictate', code)
        await ctx.record(run.score as Score, 'auto', code)
        return 'graded'
      }

      const sayCheck = async () => {
        const r = await check()
        show()
        if (!editorText(st).trim()) await ctx.say("There's no code yet.")
        else if (!r) await ctx.say(lang === 'python' ? 'Python is still loading. Try again in a moment.' : 'I could not check that.')
        else if (r.status === 'error') await ctx.say(`${r.line ? `Line ${r.line}. ` : ''}${speakable(r.message ?? 'Syntax error.', 30)}`)
        else if (r.later) await ctx.say(speakable(r.later, 30))
        else if (r.status === 'incomplete') await ctx.say("Nothing wrong so far. It isn't finished yet.")
        else await ctx.say('No syntax errors.')
      }

      /** "change total to count": rules first, then Claude for anything else that sounds like an edit. */
      const naturalEdit = async (text: string) => {
        const e = parseNaturalEdit(text, lang, vocab)
        const r = e ? applyNaturalEdit(st, e, lang) : null
        if (r && !r.note) {
          await change(r.st)
          await ctx.cue('gotIt')
          return
        }
        if (ai?.available() && ai.editCode && editorText(st).trim()) {
          ctx.show({ editor: snapshot(st, { status: 'Making that change…' }) })
          const reply = await ai.editCode(d, editorText(st), text, ctx.signal)
          if (reply && 'code' in reply) {
            const lines = reply.code.replace(/\s+$/, '').split('\n')
            if (changedLines(st.lines, lines) > 4) {
              show()
              await ctx.say("That would change more than you asked, so I left the code alone. Try a smaller edit.")
              return
            }
            const next: EditorState = { ...st, lines, anchor: null, cursor: { line: Math.min(st.cursor.line, lines.length - 1), col: 0 } }
            next.cursor.col = next.lines[next.cursor.line].length
            await change(next)
            await ctx.say(reply.summary ? speakable(reply.summary, 12) : 'Done.')
            return
          }
          show()
          await ctx.say(reply && 'unclear' in reply ? speakable(reply.unclear, 20) : (r?.note ?? "I couldn't make that change."))
          return
        }
        await ctx.say(r?.note ?? "I didn't understand that edit. Try change this to that, or add something at the end of line 2.")
      }

      show()
      for (;;) {
        if (pending !== null) {
          const text = pending
          pending = null
          const cmd = parseEditorCommand(text, vocab, lang)
          if (!cmd && EDIT_VERB.test(text.trim())) {
            await naturalEdit(text)
          } else if (!cmd) {
            if (st.mode === 'keys') await change(applyOps(st, parseKeys(text), lang).st)
            else await change(insertVerbal(st, text, lang, vocab))
            await ctx.cue('gotIt')
          } else if (cmd.t === 'run') {
            if ((await runIt()) === 'graded') return 'done'
          } else if (cmd.t === 'check') {
            await sayCheck()
          } else if (cmd.t === 'undo') {
            if (history.length) {
              future.push(st)
              st = history.pop()!
            } else st = emptyEditor(st.mode)
            await check()
            show()
            await ctx.say('Scratched.')
          } else if (cmd.t === 'redo') {
            if (future.length) {
              history.push(st)
              st = future.pop()!
              await check()
              show()
              await ctx.say('Redone.')
            } else await ctx.say('Nothing to redo.')
          } else if (cmd.t === 'readAll') {
            await ctx.say(speakEditor(st, lang))
          } else if (cmd.t === 'readLine') {
            await ctx.say(speakEditorLine(st, cmd.line ? cmd.line - 1 : st.cursor.line, lang))
          } else if (cmd.t === 'spellLine') {
            await ctx.say(spellLine(st, cmd.line ? cmd.line - 1 : st.cursor.line))
          } else if (cmd.t === 'where') {
            await ctx.say(whereAmI(st))
          } else if (cmd.t === 'mode') {
            st = { ...st, mode: cmd.mode }
            show()
            await ctx.say(cmd.mode === 'keys' ? 'Keys mode. Every word is a keystroke.' : 'Code mode.')
          } else if (cmd.t === 'startOver') {
            await change(emptyEditor(st.mode))
            await ctx.say('Cleared. Start again.')
          } else {
            const op = cmd.ops[0]
            const r = applyOps(st, cmd.ops, lang)
            if (op.t === 'goto' && r.note && op.col === undefined) {
              await ctx.say(`There's no line ${op.line}.`)
            } else {
              await change(r.st)
              if (r.note) await ctx.say(r.note)
              else if (op.t === 'goto' && op.col === undefined) await ctx.say(speakEditorLine(st, st.cursor.line, lang))
              else if (op.t === 'goto') await ctx.say(whereAmI(st))
              else if (op.t === 'deleteLine') await ctx.say('Line deleted.')
              else await ctx.cue('gotIt')
            }
          }
        }
        const r = await ctx.hear(DICTATE_COMMANDS, { thinkMs: 30000, endOnPiece: true })
        if (r.command) {
          const c = r.command as Command
          if (c === 'read_back') pending = 'read it back'
          else if (c === 'repeat') await ctx.say(dictatePrompt(d))
          else if (c === 'hint') {
            const h = d.hints_spoken?.[hintIdx]
            if (h) {
              hintIdx++
              await ctx.say(h)
            } else await ctx.say('No more hints.')
          } else if (c === 'skip') {
            await ctx.say('Skipped.')
            ctx.skip()
            return 'done'
          } else if (c === 'idk' || c === 'answer') {
            await ctx.cue('incorrect')
            await ctx.say(`Here's one way to do it. ${d.model_answer_spoken}`)
            await ctx.record(0, 'self', editorText(st))
            return 'done'
          }
          continue
        }
        if (!r.text.trim()) {
          silent++
          if (silent === 1) await ctx.say('Keep dictating, or say run it.')
          else {
            silent = 0
            await ctx.pause("Pausing. Say continue when you're ready to keep dictating.")
          }
          continue
        }
        silent = 0
        pending = r.text
      }
    },
  }
}
