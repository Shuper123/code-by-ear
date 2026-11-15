// Build (SQL): write a query out loud, one clause at a time. Each clause lands in its slot, the app
// types the punctuation and runs the query on the practice database after every step, and you hear what
// came back: the row count, SQLite's own error, or a match with the answer. Mistakes get fixed out loud
// ("undo", "remove where", say the clause again). Rules and a real database only; no AI.
import { missingPiece, rowsPhrase, sayCompare, sayError, sayResults } from '../build/feedback'
import { emptyFrame, isEmptyFrame, isRunnable, renderFrame, sayClause, sayFrame, sayName, type ClauseKey, type Frame } from '../build/frame'
import { applyUtterance, nameStep, parseBuildCommand, removeClause, unfinishedClause, type Applied, type Changed } from '../build/parse'
import { loadBuildSchema, sayColumns, sayTables } from '../build/schema'
import { snapshotOf } from '../build/view'
import type { Drill } from '../data/types'
import { compareRows, type CompareResult } from '../grading/sqlCompare'
import type { SqlRunResult } from '../runtimes/sql'
import type { Command } from '../speech/commands'
import type { Score } from './scheduler'
import type { DrillContext, TypeHook } from './session'
import type { Runners } from './sketch'

/** Session commands that stay live while building. */
export const BUILD_COMMANDS: readonly Command[] = ['repeat', 'hint', 'skip', 'idk', 'answer', 'read_back', 'done', 'pause', 'stop', 'wait']

/** Said when a pause cut a clause short and a later step changed a different clause. */
const NOT_FINISHED: Partial<Record<ClauseKey, string>> = {
  select: "The select clause isn't finished.",
  join: "The join condition isn't finished.",
  where: "The where clause isn't finished.",
  groupBy: "The group by clause isn't finished.",
  having: "The having clause isn't finished.",
  orderBy: "The order by clause isn't finished.",
}

export function buildPrompt(d: Drill): string {
  return `Build. ${d.prompt_spoken}`
}

function sentence(s: string): string {
  const t = s.trim()
  const c = t.charAt(0).toUpperCase() + t.slice(1)
  return /[.!?]$/.test(c) ? c : `${c}.`
}

/** The model answer: the idea in words, then the clauses as you would say them. */
export function buildAnswer(d: Drill): string {
  const steps = (d.say ?? []).map(sentence).join(' ')
  return `Here's one way. ${d.model_answer_spoken}${steps ? ` Say it like this. ${steps}` : ''}`
}

export interface BuildOptions {
  /** Say each clause back as it lands (on by default; the screen shows it either way). */
  echo?: () => boolean
}

export function makeBuildHook(runners: Runners, opts: BuildOptions = {}): TypeHook {
  let tipGiven = false
  return {
    thinkMs: 30000,
    firstPiece: true,
    promptText: buildPrompt,
    modelAnswer: buildAnswer,
    async intro(ctx: DrillContext) {
      void loadBuildSchema(ctx.drill.dataset, runners.runSql)
      if (tipGiven) return
      tipGiven = true
      await ctx.say('Say one clause at a time, like from lots. I run the query after each step. Say tables to hear what is in the database.')
    },
    async grade(ctx: DrillContext, first: string) {
      const d = ctx.drill
      const schema = await loadBuildSchema(d.dataset, runners.runSql)
      const ref = await runners.runSql(d.dataset, d.reference ?? '')
      let frame: Frame = emptyFrame()
      const history: Frame[] = []
      const future: Frame[] = []
      // (typed with "as" because they are set inside the helpers below)
      let run = null as SqlRunResult | null
      let cmp = null as CompareResult | null
      let changed: Changed[] = []
      // the clause a pause cut short, if any: the query isn't run until it is finished
      let open = null as ClauseKey | null
      let steps = 0
      let ownHints = 0
      let silent = 0
      let pending: string | null = first

      const show = () => ctx.show({ build: snapshotOf(frame, changed, run, cmp, steps, open ? 'not finished, keep going' : undefined) })

      const execute = async () => {
        run = null
        cmp = null
        open = unfinishedClause(frame)
        if (open || !isRunnable(frame)) return
        run = await runners.runSql(d.dataset, renderFrame(frame))
        if (run.ok && ref.ok) cmp = compareRows(run, ref, !!d.order_matters)
      }

      const resultLine = (): string => {
        if (!run) return ''
        return run.ok ? rowsPhrase(run.rows.length) : `Error. ${sayError(run.error)}`
      }

      const echoOf = (c: Changed[]): string => {
        if (opts.echo?.() === false) return ''
        return c
          .map((x) => (x.key === 'cte' ? `Saved as ${sayName(frame.ctes[frame.ctes.length - 1]?.name ?? 'a step')}.` : sayClause(frame.main, x.key, x.index)))
          .filter(Boolean)
          .join(' ')
      }

      /** Take a change, run the query, say what happened. True when the rows match the answer. */
      const commit = async (next: Applied): Promise<boolean> => {
        if (!next.changed.length) {
          await ctx.say(next.note ?? "I didn't catch that.")
          return false
        }
        history.push(frame)
        if (history.length > 100) history.shift()
        future.length = 0
        frame = next.frame
        changed = next.changed
        steps++
        await execute()
        show()
        if (open) {
          // half a clause ("select case when quantity less than 150 then small"): no echo, no error, just wait
          const mine = changed.some((c) => c.key === open)
          await ctx.say([mine ? '' : echoOf(changed), next.note ?? (mine ? 'Go on.' : NOT_FINISHED[open])].filter(Boolean).join(' '))
          return false
        }
        const lead = [echoOf(changed), resultLine()].filter(Boolean).join(' ')
        if (cmp?.equal) {
          const score: Score = ctx.hints + ownHints > 0 ? 2 : 3
          await ctx.cue('correct')
          await ctx.say(`${lead} That's a match.`.trim())
          await ctx.record(score, 'auto', renderFrame(frame))
          return true
        }
        await ctx.say([lead, next.note].filter(Boolean).join(' ') || 'Okay.')
        return false
      }

      const restore = async (to: Frame, word: string) => {
        frame = to
        changed = []
        await execute()
        show()
        await ctx.say([word, open ? NOT_FINISHED[open] : resultLine()].filter(Boolean).join(' '))
      }

      /** Why there is nothing to read out or compare yet. */
      const nothingYet = () => (open ? `${NOT_FINISHED[open]} Say the rest of it, or say undo.` : "There's nothing to run yet. Start with from and a table.")

      const hint = async () => {
        const authored = d.hints_spoken ?? []
        const given = ctx.hints + ownHints
        ownHints++
        if (given < authored.length) return ctx.say(authored[given])
        const piece = isEmptyFrame(frame) ? null : missingPiece(renderFrame(frame), d.reference ?? '')
        if (piece) return ctx.say(piece)
        if (cmp && !cmp.equal) return ctx.say(sayCompare(cmp))
        ownHints--
        return ctx.say('No more hints. Say show me to hear one way to do it.')
      }

      const showMe = async () => {
        await ctx.cue('incorrect')
        await ctx.say(buildAnswer(d))
        await ctx.record(0, 'self', renderFrame(frame))
      }

      show()
      for (;;) {
        if (pending !== null) {
          const text = pending
          pending = null
          const cmd = parseBuildCommand(text, schema)
          if (!cmd) {
            if (await commit(applyUtterance(frame, text, schema))) return 'done'
          } else if (cmd.t === 'tables') {
            await ctx.say(sayTables(d.dataset))
          } else if (cmd.t === 'columns') {
            await ctx.say(sayColumns(d.dataset, cmd.table))
          } else if (cmd.t === 'readBack') {
            await ctx.say(sayFrame(frame))
          } else if (cmd.t === 'results') {
            await ctx.say(run ? sayResults(run) : nothingYet())
          } else if (cmd.t === 'compare' || cmd.t === 'done') {
            if (!run) await ctx.say(nothingYet())
            else if (!run.ok) await ctx.say(`Error. ${sayError(run.error)}`)
            else if (cmp) await ctx.say(cmd.t === 'done' ? `Not a match yet. ${sayCompare(cmp)} Keep going, or say show me.` : sayCompare(cmp))
            else await ctx.say(rowsPhrase(run.rows.length))
          } else if (cmd.t === 'undo') {
            if (history.length) {
              future.push(frame)
              await restore(history.pop()!, 'Undone.')
            } else await ctx.say('Nothing to undo.')
          } else if (cmd.t === 'redo') {
            if (future.length) {
              history.push(frame)
              await restore(future.pop()!, 'Redone.')
            } else await ctx.say('Nothing to redo.')
          } else if (cmd.t === 'startOver') {
            if (!isEmptyFrame(frame)) history.push(frame)
            future.length = 0
            await restore(emptyFrame(), 'Cleared. Start again.')
          } else if (cmd.t === 'remove') {
            const r = removeClause(frame, cmd.what)
            if (!r.changed.length) await ctx.say(r.note ?? 'Nothing to remove.')
            else {
              history.push(frame)
              future.length = 0
              frame = r.frame
              changed = []
              steps++
              await execute()
              show()
              if (cmp?.equal) {
                await ctx.cue('correct')
                await ctx.say(`Removed. ${resultLine()} That's a match.`)
                await ctx.record(ctx.hints + ownHints > 0 ? 2 : 3, 'auto', renderFrame(frame))
                return 'done'
              }
              await ctx.say(['Removed.', open ? NOT_FINISHED[open] : resultLine()].filter(Boolean).join(' '))
            }
          } else if (cmd.t === 'name') {
            if (await commit(nameStep(frame, cmd.name))) return 'done'
          } else if (cmd.t === 'showMe') {
            await showMe()
            return 'done'
          }
        }
        const r = await ctx.hear(BUILD_COMMANDS, { thinkMs: 30000, endOnPiece: true })
        if (r.command) {
          const c = r.command as Command
          if (c === 'read_back') pending = 'read it back'
          else if (c === 'done') pending = 'done'
          else if (c === 'repeat') await ctx.say(buildPrompt(d))
          else if (c === 'hint') await hint()
          else if (c === 'skip') {
            await ctx.say('Skipped.')
            ctx.skip()
            return 'done'
          } else if (c === 'idk' || c === 'answer') {
            await showMe()
            return 'done'
          }
          continue
        }
        if (!r.text.trim()) {
          silent++
          if (silent === 1) await ctx.say('Keep going. Say hint if you are stuck.')
          else {
            silent = 0
            await ctx.pause("Pausing. Say continue when you're ready to keep building.")
          }
          continue
        }
        silent = 0
        pending = r.text
      }
    },
  }
}
