// Dictate (Level 3, Parked only): dictate exact code in Verbal Syntax over as many utterances as you
// like, with edit commands, then "run it" checks syntax and runs the tests or compares rows.
// Fully works without AI; with a key, failures get a plain-words explanation (spec section 6).
import { speakable } from '../ai/prompts'
import type { Drill } from '../data/types'
import type { Command } from '../speech/commands'
import { applyEdit, dictate, emptyDoc, parseEdit, render, speakDoc, speakLine, type Doc } from '../verbal/syntax'
import type { Score } from './scheduler'
import { scoreCue, type DrillContext, type TypeHook } from './session'
import { runSketch, type Runners } from './sketch'

export interface DictateAi {
  available(): boolean
  explainError(d: Drill, learnerCode: string, failure: string, signal?: AbortSignal): Promise<string | null>
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

export function makeDictateHook(ai: DictateAi | null, runners: Runners): TypeHook {
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
      let doc: Doc = emptyDoc()
      const history: Doc[] = []
      let pending: string | null = first
      let silent = 0
      let hintIdx = 0
      const show = () => ctx.show({ code: render(doc, lang) || ' ', note: `Cursor on line ${doc.cursor + 1} of ${doc.lines.length}` })

      const runIt = async (): Promise<'graded' | 'continue'> => {
        const code = render(doc, lang)
        if (!code.trim()) {
          await ctx.say("There's no code yet. Keep dictating.")
          return 'continue'
        }
        if (lang === 'python' && !runners.pythonReady()) await ctx.say('Loading Python. The first time takes a moment.')
        const hints = Math.max(ctx.hints, hintIdx)
        const run = await runSketch(d, code, runners, hints)
        if (run.failure && FIXABLE.test(run.failure)) {
          ctx.show({ code, note: run.failure })
          await ctx.cue('incorrect')
          await ctx.say(`${sayFixable(run.failure)} Fix it, then say run it. You can say read line or read it back.`)
          return 'continue'
        }
        ctx.show({ code, note: run.failure ?? 'Passed.' })
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

      for (;;) {
        if (pending !== null) {
          const text = pending
          pending = null
          const edit = parseEdit(text)
          if (!edit) {
            history.push(doc)
            doc = dictate(doc, text, lang, vocab)
            show()
            await ctx.cue('gotIt')
          } else if (edit.t === 'run') {
            if ((await runIt()) === 'graded') return 'done'
          } else if (edit.t === 'scratch') {
            doc = history.pop() ?? emptyDoc()
            show()
            await ctx.say('Scratched.')
          } else if (edit.t === 'read_all') {
            await ctx.say(speakDoc(doc, lang))
          } else if (edit.t === 'read_line') {
            await ctx.say(speakLine(doc, doc.cursor, lang))
          } else if (edit.t === 'goto') {
            if (edit.line < 1 || edit.line > doc.lines.length) await ctx.say(`There's no line ${edit.line}.`)
            else {
              doc = applyEdit(doc, edit)
              show()
              await ctx.say(speakLine(doc, doc.cursor, lang))
            }
          } else {
            history.push(doc)
            doc = applyEdit(doc, edit)
            show()
            await ctx.say(edit.t === 'delete_line' ? 'Line deleted.' : 'Cleared. Start again.')
          }
        }
        const r = await ctx.hear(DICTATE_COMMANDS, { thinkMs: 30000 })
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
            await ctx.record(0, 'self', render(doc, lang))
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
