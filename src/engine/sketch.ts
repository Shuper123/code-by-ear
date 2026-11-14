// Sketch (Level 2): say a solution in your own words; the AI converts it literally to code; the app
// reads back what it heard plus any assumptions, waits for "go" or "redo", runs the code against the
// reference (SQL rows or Python tests) and explains the first problem. Without AI grading, Sketch is
// offered as a Plan drill instead (spec section 6).
import type { ConverterReply } from '../ai/prompts'
import { speakable } from '../ai/prompts'
import schema from '../data/datasets/schema.json'
import type { DatasetName, Drill, PyTest } from '../data/types'
import { compareRows } from '../grading/sqlCompare'
import type { PyTestsResult } from '../runtimes/py'
import type { SqlRunResult } from '../runtimes/sql'
import { CONFIRM_COMMANDS } from '../speech/commands'
import type { Score } from './scheduler'
import { scoreCue, type DrillContext, type TypeHook } from './session'

export interface SketchAi {
  available(): boolean
  convert(d: Drill, transcript: string, signal?: AbortSignal): Promise<ConverterReply | null>
  explainError(d: Drill, learnerCode: string, failure: string, signal?: AbortSignal): Promise<string | null>
}

export interface Runners {
  runSql(dataset: DatasetName | undefined, sql: string): Promise<SqlRunResult>
  runPyTests(code: string, fn: string, tests: PyTest[]): Promise<PyTestsResult>
  pythonReady(): boolean
  preloadPython(): void
}

type SchemaEntry = { table: string; columns: string[]; spoken: string }

/** Spoken summaries of the tables a drill uses (from its vocabulary). */
export function tableSummaries(d: Drill): string {
  const tables = ((schema as Record<string, SchemaEntry[]>)[d.dataset ?? ''] ?? []).filter((t) =>
    (d.vocab ?? []).includes(t.table),
  )
  return tables.map((t) => t.spoken).join(' ')
}

export interface SketchRun {
  score: Score
  /** First problem, in words, for the error explainer; null when it passed. */
  failure: string | null
}

export async function runSketch(d: Drill, code: string, runners: Runners, hints: number): Promise<SketchRun> {
  const best: Score = hints > 0 ? 2 : 3
  if (d.lang === 'sql') {
    const mine = await runners.runSql(d.dataset, code)
    const ref = await runners.runSql(d.dataset, d.reference ?? '')
    if (!ref.ok) return { score: 0, failure: `The reference query failed: ${ref.error}` }
    if (!mine.ok) return { score: 0, failure: `The query failed with this error: ${mine.error}` }
    const cmp = compareRows(mine, ref, !!d.order_matters)
    return cmp.equal ? { score: best, failure: null } : { score: 1, failure: cmp.note }
  }
  const res = await runners.runPyTests(code, d.function_name ?? '', d.tests ?? [])
  if (res.error) {
    return {
      score: 0,
      failure: res.timeout ? 'The code ran too long and was stopped, so there may be an endless loop.' : `The code failed to run: ${res.error}`,
    }
  }
  if (res.ok) return { score: best, failure: null }
  const passed = res.results.filter((r) => r.ok).length
  const first = res.results.find((r) => !r.ok)
  const got = first?.error ? `raised ${first.error}` : `returned ${JSON.stringify(first?.got)}`
  const failure = first
    ? `For input ${JSON.stringify(first.args)} the test expected ${JSON.stringify(first.expected)} but the code ${got}. ${passed} of ${res.results.length} tests passed.`
    : 'Some tests failed.'
  return { score: passed * 2 >= res.results.length && passed > 0 ? 1 : 0, failure }
}

export function makeSketchHook(ai: SketchAi | null, runners: Runners): TypeHook {
  const aiOn = () => !!ai && ai.available()
  return {
    thinkMs: 25000,
    async intro(ctx: DrillContext) {
      const d = ctx.drill
      if (!aiOn()) return
      if (d.lang === 'python') runners.preloadPython()
      if (d.ladder) {
        const plan = await ctx.noteFor(d.ladder)
        if (plan) await ctx.say(`Your plan from before was: ${speakable(plan, 60)}`)
      }
    },
    promptText(d: Drill) {
      if (!aiOn()) return `Sketch, as a plan for now, because AI grading is off. ${d.prompt_spoken} Plan it out loud.`
      const tables = d.lang === 'sql' ? `${tableSummaries(d)} ` : ''
      return `Sketch. ${tables}${d.prompt_spoken} Say the ${d.lang === 'sql' ? 'query' : 'function'} in your own words.`
    },
    async grade(ctx: DrillContext, transcript: string) {
      const d = ctx.drill
      if (!aiOn()) {
        await ctx.saveNote('sketch', transcript)
        await ctx.selfRate(transcript, `Here's a model answer. ${d.model_answer_spoken}`)
        return 'done'
      }
      const conv = await ai!.convert(d, transcript, ctx.signal)
      if (!conv) {
        await ctx.say('Grading is offline, rate yourself.')
        await ctx.selfRate(transcript, `Here's a model answer. ${d.model_answer_spoken}`)
        return 'done'
      }
      ctx.show({ code: conv.code, note: conv.assumptions.length ? `Assumed: ${conv.assumptions.join(' ')}` : undefined })
      const readBack = [`I heard: ${transcript}.`]
      const trim = (x: string) => x.trim().replace(/[.!?;,]+$/, '')
      if (conv.assumptions.length) readBack.push(`I assumed: ${conv.assumptions.map(trim).join('. ')}.`)
      if (conv.unclear.length) readBack.push(`I couldn't place: ${conv.unclear.map(trim).join(', ')}.`)
      readBack.push('Say go to run it, or redo.')
      await ctx.say(readBack.join(' '))
      let decision: 'go' | 'redo' | null = null
      for (let i = 0; i < 3 && !decision; i++) {
        const r = await ctx.hear(CONFIRM_COMMANDS, { thinkMs: 8000 })
        if (r.command === 'go') decision = 'go'
        else if (r.command === 'redo') decision = 'redo'
        else if (r.command === 'repeat') await ctx.say(readBack.join(' '))
        else if (i === 0) await ctx.say('Say go, or redo.')
        else decision = 'go' // after a reminder, silence runs it
      }
      if (decision === 'redo') {
        await ctx.say('Okay, say it again.')
        return 'redo'
      }
      if (d.lang === 'python' && !runners.pythonReady()) await ctx.say('Loading Python. The first time takes a moment.')
      const run = await runSketch(d, conv.code, runners, ctx.hints)
      ctx.show({ note: run.failure ?? (d.lang === 'sql' ? 'Rows match the answer.' : 'All tests pass.') })
      await ctx.cue(scoreCue(run.score))
      if (!run.failure) {
        await ctx.say(d.lang === 'sql' ? 'Correct. Your rows match the answer.' : 'Correct. All the tests pass.')
      } else {
        const why = (await ai!.explainError(d, conv.code, run.failure, ctx.signal)) ?? `It didn't pass. ${speakable(run.failure, 40)}`
        await ctx.say(run.score === 0 ? `${why} Here's one way to do it. ${d.model_answer_spoken}` : why)
      }
      await ctx.saveNote('sketch', transcript)
      await ctx.record(run.score, 'auto', transcript)
      if (run.score > 0 && run.score < 3 && run.failure) await ctx.followUp(transcript)
      return 'done'
    },
  }
}
