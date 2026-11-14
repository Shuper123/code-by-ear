// The session engine: a hands-free loop (spec section 5).
//   speak the prompt -> beep, listen -> command? run it : grade -> speak feedback -> schedule -> next
// Speech, listening, tones, time and storage are injected, so the whole loop runs in tests with fakes.
// Half-duplex: the engine never listens while it speaks.
import type { Drill, Lang } from '../data/types'
import { UNIT_NAMES } from '../data/types'
import { answersMatch, mentionedLines } from '../grading/normalize'
import type { Settings } from '../settings'
import {
  ANSWER_COMMANDS,
  classifierFor,
  FOLLOWUP_COMMANDS,
  PAUSE_COMMANDS,
  parseSelfRating,
  RATING_COMMANDS,
  type Command,
} from '../speech/commands'
import type { CueName } from '../speech/cues'
import { describeSttError, type ListenHandle, type ListenOptions, type ListenResult, type SttErrorKind } from '../speech/stt'
import type { Attempt, DrillState, Profile, SessionRecord } from '../storage/db'
import { addDays } from './dates'
import { mastery, type ProgressStore } from './progress'
import { languagesFor, SessionQueue, type QueueItem } from './queue'
import { schedule, type SchedState, type Score } from './scheduler'
import { newDrillUnit } from './unlock'

/** Optional AI grading (milestone 2). Returning null means "fall back to self-rating". */
export interface AiGrader {
  available(): boolean
  grade(d: Drill, transcript: string, signal: AbortSignal): Promise<{ score: Score; feedback: string } | null>
  explainMore(d: Drill, signal: AbortSignal): Promise<string | null>
}

export interface EngineDeps {
  speak(text: string, rate: number, signal: AbortSignal): Promise<void>
  stopSpeaking(): void
  listen(opts: ListenOptions): ListenHandle
  cue(name: CueName): Promise<void>
  now(): number
  today(): string
  store: ProgressStore
  grader?: AiGrader
  onRateChange?(profile: Profile, rate: number): void
  /** Drill types this build can run. */
  supportedTypes: ReadonlySet<string>
  /** Optional extra handlers for Level 2 and 3 drills (added in later milestones). */
  levelHandlers?: Partial<Record<string, (ctx: DrillContext) => Promise<void>>>
}

export interface EngineConfig {
  profile: Profile
  settings: Settings
  drills: Drill[]
}

export type Phase =
  | 'starting'
  | 'speaking'
  | 'listening'
  | 'grading'
  | 'paused'
  | 'break'
  | 'recap'
  | 'ended'

export type PauseReason = '' | 'user' | 'auto' | 'break' | 'hidden' | 'error'

export interface EngineView {
  phase: Phase
  drill: Drill | null
  reason: QueueItem['reason'] | null
  done: number
  scored: number
  scoreSum: number
  lastScore: number | null
  heard: string
  lastAnswer: string
  said: string
  elapsedMs: number
  paused: boolean
  pauseReason: PauseReason
  rate: number
  recap: string
  error: string
}

export class Interrupt extends Error {
  constructor(public kind: 'pause' | 'stop') {
    super(kind)
  }
}

/** What a level handler gets to work with (Sketch, Dictate). */
export interface DrillContext {
  drill: Drill
  hints: number
  say(text: string): Promise<void>
  hear(allowed: readonly Command[], opts?: { silenceMs?: number; thinkMs?: number }): Promise<ListenResult & { command?: string }>
  cue(name: CueName): Promise<void>
  record(score: Score, gradedBy: Attempt['gradedBy'], transcript: string): Promise<void>
  selfRate(transcript: string, preface: string): Promise<void>
  noteFor(ladder: string): Promise<string | undefined>
  saveNote(field: 'plan' | 'sketch' | 'dictate', text: string): Promise<void>
  profile: Profile
  signal: AbortSignal
}

const RATE_MIN = 0.5
const RATE_MAX = 1.6

export function scoreCue(score: number): CueName {
  return score >= 2 ? 'correct' : score === 1 ? 'partial' : 'incorrect'
}

export class SessionEngine {
  view: EngineView
  private subs = new Set<(v: EngineView) => void>()
  private ctrl = new AbortController()
  private pauseRequested: PauseReason = ''
  private stopRequested = false
  private resumeResolve: (() => void) | null = null
  private listenHandle: ListenHandle | null = null
  private pendingCommand: Command | null = null
  private pauseListenStop = false
  private queue!: SessionQueue
  private states = new Map<string, DrillState>()
  private attempts: Attempt[] = []
  private readonly sessionId: string
  private startedAt = 0
  private activeSinceBreak = 0
  private lastTick = 0
  private consecutiveUnanswered = 0
  private lastLang: Lang | null = null
  private sessionScores: { drill: Drill; score: number }[] = []
  private rate: number
  private running = false
  private silentRecap = false

  constructor(
    private cfg: EngineConfig,
    private deps: EngineDeps,
  ) {
    const s = cfg.settings
    this.rate = cfg.profile === 'drive' ? s.rateDrive : s.rateParked
    this.sessionId = `s-${deps.now()}`
    this.view = {
      phase: 'starting',
      drill: null,
      reason: null,
      done: 0,
      scored: 0,
      scoreSum: 0,
      lastScore: null,
      heard: '',
      lastAnswer: '',
      said: '',
      elapsedMs: 0,
      paused: false,
      pauseReason: '',
      rate: this.rate,
      recap: '',
      error: '',
    }
  }

  // ---------- observation ----------

  subscribe(fn: (v: EngineView) => void): () => void {
    this.subs.add(fn)
    fn(this.view)
    return () => this.subs.delete(fn)
  }

  private update(patch: Partial<EngineView>) {
    this.view = { ...this.view, ...patch, elapsedMs: this.startedAt ? this.deps.now() - this.startedAt : 0 }
    for (const f of this.subs) f(this.view)
  }

  // ---------- controls (screen taps, buttons, app visibility) ----------

  /** Pause now, interrupting speech or listening. */
  requestPause(reason: PauseReason = 'user'): void {
    if (this.view.paused || this.stopRequested || !this.running) return
    this.pauseRequested = reason
    this.interruptIo()
  }

  resume(): void {
    if (!this.view.paused) return
    this.resumeResolve?.()
  }

  togglePause(): void {
    if (this.view.paused) this.resume()
    else this.requestPause('user')
  }

  /** End the session (it still speaks the recap). */
  requestStop(): void {
    if (this.stopRequested) return
    this.stopRequested = true
    this.interruptIo()
    this.resumeResolve?.()
  }

  /** Buttons in Parked mode inject commands as if they were spoken. */
  injectCommand(cmd: Command): void {
    if (cmd === 'pause') return this.requestPause('user')
    if (cmd === 'stop') return this.requestStop()
    if (this.listenHandle) {
      this.pendingCommand = cmd
      this.listenHandle.abort()
    }
  }

  /** "Done talking" button: end the current answer and keep what was heard. */
  finishAnswer(): void {
    this.listenHandle?.stop()
  }

  /** The app came back to the front after being hidden: say so, then listen for "continue". */
  onVisible(): void {
    if (!(this.view.paused && this.view.pauseReason === 'hidden')) return
    void (async () => {
      try {
        await this.deps.cue('paused')
        await this.deps.speak("You're paused. Say continue when you're ready.", this.rate, this.ctrl.signal)
      } catch {
        /* resumed meanwhile */
      }
      if (this.view.paused) this.startPauseListening()
    })()
  }

  /** Leave the session screen: stop at once, without speaking the recap. */
  quit(): void {
    this.silentRecap = true
    this.requestStop()
    this.deps.stopSpeaking()
  }

  private interruptIo() {
    this.ctrl.abort()
    this.listenHandle?.abort()
    this.deps.stopSpeaking()
  }

  // ---------- small helpers ----------

  private check() {
    if (this.stopRequested) throw new Interrupt('stop')
    if (this.pauseRequested) throw new Interrupt('pause')
  }

  private async say(text: string) {
    this.check()
    this.update({ phase: 'speaking', said: text })
    await this.deps.speak(text, this.rate, this.ctrl.signal)
    this.check()
  }

  private async cue(name: CueName) {
    this.check()
    await this.deps.cue(name)
  }

  private listenOpts(allowed: readonly Command[], o: { silenceMs?: number; thinkMs?: number } = {}): ListenOptions {
    const s = this.cfg.settings
    return {
      silenceMs: o.silenceMs ?? (this.cfg.profile === 'drive' ? s.silenceDriveMs : s.silenceParkedMs),
      initialWaitMs: o.thinkMs ?? s.thinkMs,
      maxMs: 120000,
      continuous: s.sttContinuous,
      restartDelayMs: s.restartDelayMs,
      classify: classifierFor(allowed),
      onUpdate: (p) => this.update({ heard: p.text }),
    }
  }

  /** Beep, then listen. Pause and stop commands interrupt right here. */
  private async hear(
    allowed: readonly Command[],
    o: { silenceMs?: number; thinkMs?: number } = {},
  ): Promise<ListenResult & { command?: string }> {
    this.check()
    await this.deps.cue('listening')
    this.check()
    this.update({ phase: 'listening', heard: '' })
    this.pendingCommand = null
    const h = this.deps.listen(this.listenOpts(allowed, o))
    this.listenHandle = h
    let r: ListenResult & { command?: string }
    try {
      r = await h.result
    } finally {
      if (this.listenHandle === h) this.listenHandle = null
    }
    if (this.pendingCommand) {
      r = { ...r, reason: 'command', command: this.pendingCommand, text: '' }
      this.pendingCommand = null
    }
    this.check()
    if (r.command === 'pause') {
      this.pauseRequested = 'user'
      throw new Interrupt('pause')
    }
    if (r.command === 'stop') {
      this.stopRequested = true
      throw new Interrupt('stop')
    }
    return r
  }

  private changeRate(cmd: 'slower' | 'faster') {
    const next = Math.round((this.rate + (cmd === 'slower' ? -0.1 : 0.1)) * 10) / 10
    this.rate = Math.min(RATE_MAX, Math.max(RATE_MIN, next))
    this.update({ rate: this.rate })
    this.deps.onRateChange?.(this.cfg.profile, this.rate)
  }

  private elapsed(): number {
    return this.deps.now() - this.startedAt
  }

  private timeUp(): boolean {
    if (this.cfg.profile !== 'drive') return false
    return this.elapsed() >= this.cfg.settings.sessionMinutes * 60000
  }

  private tickActive() {
    const now = this.deps.now()
    if (!this.view.paused) this.activeSinceBreak += now - this.lastTick
    this.lastTick = now
  }

  private breakDue(): boolean {
    this.tickActive()
    return this.activeSinceBreak >= this.cfg.settings.breakEveryMin * 60000
  }

  // ---------- pausing ----------

  private async pausedWait(reason: PauseReason, message?: string) {
    this.tickActive()
    this.pauseRequested = ''
    this.ctrl = new AbortController()
    this.listenHandle?.abort()
    this.update({ phase: reason === 'break' ? 'break' : 'paused', paused: true, pauseReason: reason })
    const resumed = new Promise<void>((resolve) => (this.resumeResolve = resolve))
    try {
      await this.deps.cue('paused')
      const text =
        message ??
        (reason === 'hidden'
          ? ''
          : `Paused. Say continue when you're ready${this.cfg.profile === 'drive' ? ', or tap the screen' : ''}.`)
      if (text) {
        this.update({ said: text })
        await Promise.race([this.deps.speak(text, this.rate, this.ctrl.signal), resumed])
      }
    } catch {
      /* interrupted by resume */
    }
    if (reason !== 'hidden' && !this.stopRequested) this.startPauseListening()
    if (!this.stopRequested) await resumed
    this.resumeResolve = null
    this.pauseListenStop = true
    this.listenHandle?.abort()
    this.deps.stopSpeaking()
    this.ctrl = new AbortController()
    this.lastTick = this.deps.now()
    if (reason === 'break') this.activeSinceBreak = 0
    this.update({ paused: false, pauseReason: '' })
  }

  /** While paused, keep listening for "continue" (unless turned off in Settings). */
  private startPauseListening() {
    if (!this.cfg.settings.pauseListening) return
    this.pauseListenStop = false
    void (async () => {
      let failures = 0
      while (!this.pauseListenStop && this.view.paused && !this.stopRequested) {
        const h = this.deps.listen({
          ...this.listenOpts(PAUSE_COMMANDS, { silenceMs: 1500, thinkMs: 60000 }),
          onUpdate: (p) => this.update({ heard: p.text }),
        })
        this.listenHandle = h
        const r = await h.result
        if (this.listenHandle === h) this.listenHandle = null
        if (this.pauseListenStop || !this.view.paused) return
        if (r.command === 'continue') return this.resume()
        if (r.command === 'stop') return this.requestStop()
        if (r.error) {
          failures++
          if (r.error === 'not-allowed' || r.error === 'unsupported' || r.error === 'audio-capture' || failures > 20) return
          await new Promise((res) => setTimeout(res, 5000)) // offline: try again in a bit
        }
      }
    })()
  }

  // ---------- the session ----------

  async run(): Promise<void> {
    if (this.running) return
    this.running = true
    const today = this.deps.today()
    this.states = await this.deps.store.loadStates()
    this.attempts = await this.deps.store.loadAttempts()
    this.queue = new SessionQueue({
      drills: this.cfg.drills,
      profile: this.cfg.profile,
      languageMix: this.cfg.settings.languageMix,
      newPerSession: this.cfg.settings.newPerSession,
      states: this.states,
      attempts: this.attempts,
      today,
      seed: Math.floor(this.deps.now() / 86400000),
      supportedTypes: this.deps.supportedTypes,
    })
    this.startedAt = this.deps.now()
    this.lastTick = this.startedAt
    try {
      await this.guard(() => this.intro())
      while (!this.stopRequested) {
        if (this.timeUp()) break
        if (this.breakDue()) {
          await this.pausedWait(
            'break',
            `${this.cfg.settings.breakEveryMin} minutes done. Take a break if you need one. Say continue when ready.`,
          )
          continue
        }
        const item = this.queue.next()
        if (!item) break
        await this.runDrill(item)
      }
      await this.recap()
    } finally {
      this.running = false
      this.pauseListenStop = true
      await this.saveSessionRecord()
      this.update({ phase: 'ended' })
    }
  }

  /** Run a step; if it gets interrupted by a pause, wait and then carry on. */
  private async guard(fn: () => Promise<void>) {
    try {
      await fn()
    } catch (e) {
      if (!(e instanceof Interrupt)) throw e
      if (e.kind === 'pause') await this.pausedWait(this.pauseRequested || 'user')
    }
  }

  private async intro() {
    const langs = languagesFor(this.cfg.settings.languageMix)
    const what = langs.length === 2 ? 'SQL and Python' : langs[0] === 'sql' ? 'SQL' : 'Python'
    const text =
      this.cfg.profile === 'drive'
        ? `Drive session, ${what}, about ${this.cfg.settings.sessionMinutes} minutes. Say pause any time, or tap the screen.`
        : `Parked session, ${what}. Say stop session when you're done.`
    await this.say(text)
  }

  private context(drill: Drill, hintsRef: { n: number }): DrillContext {
    return {
      drill,
      get hints() {
        return hintsRef.n
      },
      say: (t) => this.say(t),
      hear: (allowed, o) => this.hear(allowed, o),
      cue: (n) => this.cue(n),
      record: (score, by, transcript) => this.record(drill, score, by, transcript, hintsRef.n),
      selfRate: (transcript, preface) => this.selfRate(drill, transcript, hintsRef.n, preface),
      noteFor: async (ladder) => (await this.deps.store.getNote(ladder))?.plan,
      saveNote: (field, text) => (drill.ladder ? this.deps.store.saveNote(drill.ladder, field, text) : Promise.resolve()),
      profile: this.cfg.profile,
      signal: this.ctrl.signal,
    }
  }

  private async runDrill(item: QueueItem) {
    const d = item.drill
    this.queue.markSeen(d.id)
    this.update({ drill: d, reason: item.reason, heard: '', lastAnswer: '' })
    const hints = { n: 0 }
    let skipPrompt = false
    let missed = 0
    for (;;) {
      try {
        const handler = this.deps.levelHandlers?.[d.type]
        if (handler) {
          await handler(this.context(d, hints))
          return
        }
        if (!skipPrompt) await this.speakPrompt(d)
        skipPrompt = false
        const r = await this.hear(ANSWER_COMMANDS)
        if (r.error) {
          await this.handleSttError(r.error)
          continue
        }
        if (r.command) {
          const cmd = r.command as Command
          if (cmd === 'repeat') continue
          if (cmd === 'slower' || cmd === 'faster') {
            this.changeRate(cmd)
            await this.say(cmd === 'slower' ? 'Slower.' : 'Faster.')
            continue
          }
          if (cmd === 'hint') {
            const h = d.hints_spoken?.[hints.n]
            if (h) {
              hints.n++
              await this.say(h)
            } else await this.say('No more hints.')
            skipPrompt = true
            continue
          }
          if (cmd === 'skip') {
            await this.say('Skipped.')
            this.update({ done: this.view.done + 1 })
            return
          }
          if (cmd === 'idk' || cmd === 'answer') {
            await this.cue('incorrect')
            await this.say(cmd === 'idk' ? `No problem. ${d.model_answer_spoken}` : d.model_answer_spoken)
            await this.record(d, 0, 'self', '', hints.n)
            return
          }
          if (cmd === 'read_back') {
            await this.say("You haven't answered yet.")
            skipPrompt = true
            continue
          }
        }
        if (!r.text.trim()) {
          missed++
          this.consecutiveUnanswered++
          if (this.consecutiveUnanswered >= 2) {
            this.consecutiveUnanswered = 0
            await this.pausedWait('auto', `I haven't heard an answer twice in a row, so I'm pausing. Say continue when you're ready.`)
            continue
          }
          await this.say(missed === 1 ? "I didn't hear an answer. Here it is again." : 'Here it is again.')
          continue
        }
        this.consecutiveUnanswered = 0
        this.update({ lastAnswer: r.text })
        await this.cue('gotIt')
        await this.gradeAndFeedback(d, r.text, hints.n)
        return
      } catch (e) {
        if (!(e instanceof Interrupt)) throw e
        if (e.kind === 'stop') return
        await this.pausedWait(this.pauseRequested || 'user')
        if (this.stopRequested) return
        skipPrompt = false
      }
    }
  }

  private async handleSttError(err: SttErrorKind) {
    const msg = describeSttError(err)
    this.update({ error: msg })
    if (err === 'network') {
      await this.pausedWait('error', `${msg} Pausing. Say continue or tap when you have signal again.`)
      return
    }
    // no microphone, no permission, no speech recognition: nothing to do hands-free
    try {
      await this.say(`${msg} Ending the session.`)
    } catch {
      /* already stopping */
    }
    this.stopRequested = true
    throw new Interrupt('stop')
  }

  private async speakPrompt(d: Drill) {
    const parts: string[] = []
    if (this.lastLang !== d.lang) parts.push(d.lang === 'sql' ? 'SQL.' : 'Python.')
    this.lastLang = d.lang
    if (d.type === 'spot_bug') parts.push('Spot the bug.')
    if (d.code_spoken) parts.push(d.code_spoken)
    parts.push(d.prompt_spoken)
    await this.say(parts.join(' '))
  }

  // ---------- grading ----------

  private async gradeAndFeedback(d: Drill, text: string, hints: number) {
    this.update({ phase: 'grading' })
    if (d.type === 'predict' && d.expected !== undefined) {
      if (answersMatch(text, d.expected, d.accept ?? [], { strictNumbers: d.strict_numbers })) {
        const score: Score = hints > 0 ? 2 : 3
        await this.cue('correct')
        await this.say(`Right. ${d.model_answer_spoken}`)
        await this.record(d, score, 'auto', text, hints)
        return
      }
    }
    if (d.type === 'plan' && d.ladder) await this.deps.store.saveNote(d.ladder, 'plan', text)

    const grader = this.deps.grader
    if (grader?.available()) {
      this.update({ phase: 'grading' })
      const g = await grader.grade(d, text, this.ctrl.signal).catch(() => null)
      this.check()
      if (g) {
        const score = (hints > 0 ? Math.min(g.score, 2) : g.score) as Score
        await this.cue(scoreCue(score))
        await this.say(g.feedback)
        await this.record(d, score, 'ai', text, hints)
        if (score > 0 && score < 3) await this.followUp(d, text)
        return
      }
      await this.say('Grading is offline, rate yourself.')
    }

    let preface: string
    if (d.type === 'predict') preface = `I heard ${text}. ${d.model_answer_spoken}`
    else if (d.type === 'spot_bug' && d.bug) {
      const right = mentionedLines(text).includes(d.bug.line)
      preface = `${right ? 'You named the right line. ' : ''}Here's the answer. ${d.model_answer_spoken}`
    } else if (d.type === 'plan') preface = `Your notes are saved. Here's a model plan. ${d.model_answer_spoken}`
    else preface = `Here's a model answer. ${d.model_answer_spoken}`
    await this.selfRate(d, text, hints, preface)
  }

  /** Hear the model answer, then say yes, partly, no or easy (spec section 6). */
  private async selfRate(d: Drill, transcript: string, hints: number, preface: string) {
    const question =
      d.type === 'predict' ? 'Were you right? Say yes, partly, or no.' : 'How did you do? Say yes, partly, no, or easy.'
    await this.say(`${preface} ${question}`)
    let silent = 0
    for (let tries = 0; tries < 4; tries++) {
      const r = await this.hear(RATING_COMMANDS, { thinkMs: 10000 })
      if (r.error) {
        await this.handleSttError(r.error)
        await this.say(question)
        continue
      }
      if (r.command === 'repeat') {
        await this.say(`${preface} ${question}`)
        continue
      }
      if (r.command === 'skip') {
        await this.say('Skipped.')
        this.update({ done: this.view.done + 1 })
        return
      }
      const rating = parseSelfRating(r.text)
      if (rating !== null) {
        const score = (hints > 0 ? Math.min(rating, 2) : rating) as Score
        await this.cue(scoreCue(score))
        await this.say(['Okay. You will see it again soon.', 'Okay, partly.', 'Good.', 'Nice.'][score])
        await this.record(d, score, 'self', transcript, hints)
        return
      }
      if (!r.text.trim()) {
        silent++
        if (silent >= 2) {
          await this.pausedWait('auto', `I didn't hear a rating, so I'm pausing. Say continue when you're ready.`)
          await this.say(question)
          silent = 0
          continue
        }
      }
      await this.say('Say yes, partly, no, or easy.')
    }
    await this.say('No rating. Moving on.')
    this.update({ done: this.view.done + 1 })
  }

  /** After AI feedback on a partial answer: a short window for "answer", "explain more" or "read it back". */
  private async followUp(d: Drill, transcript: string) {
    for (let i = 0; i < 3; i++) {
      const r = await this.hear(FOLLOWUP_COMMANDS, { thinkMs: this.cfg.profile === 'drive' ? 4000 : 3000 })
      const cmd = r.command as Command | undefined
      if (!cmd || cmd === 'continue' || cmd === 'skip') return
      if (cmd === 'answer') await this.say(d.model_answer_spoken)
      else if (cmd === 'read_back') await this.say(transcript ? `You said: ${transcript}` : 'I have nothing saved.')
      else if (cmd === 'repeat') await this.say(this.view.said)
      else if (cmd === 'explain_more') {
        const more = await this.deps.grader?.explainMore(d, this.ctrl.signal).catch(() => null)
        await this.say(more ?? 'A longer explanation needs AI grading. Here is the model answer. ' + d.model_answer_spoken)
      }
    }
  }

  private async record(d: Drill, score: Score, gradedBy: Attempt['gradedBy'], transcript: string, hints: number) {
    const today = this.deps.today()
    const nowIso = new Date(this.deps.now()).toISOString()
    const prev = this.states.get(d.id)
    const prevSched: SchedState | undefined = prev
      ? { ease: prev.ease, interval: prev.interval, reps: prev.reps, lapses: prev.lapses, due: prev.due, lastScore: prev.lastScore }
      : undefined
    const { next, requeue } = schedule(prevSched, score, today)
    const state: DrillState = { id: d.id, ...next, firstSeen: prev?.firstSeen ?? nowIso, lastSeen: nowIso }
    this.states.set(d.id, state)
    const attempt: Attempt = {
      drillId: d.id,
      lang: d.lang,
      unit: d.unit,
      level: d.level,
      type: d.type,
      score,
      at: nowIso,
      sessionId: this.sessionId,
      profile: this.cfg.profile,
      gradedBy,
      transcript,
      hints,
    }
    this.attempts.push(attempt)
    this.sessionScores.push({ drill: d, score })
    await this.deps.store.saveState(state)
    await this.deps.store.addAttempt(attempt)
    if (requeue) this.queue.requeue(d)
    this.update({
      done: this.view.done + 1,
      scored: this.view.scored + 1,
      scoreSum: this.view.scoreSum + score,
      lastScore: score,
    })
    await this.saveSessionRecord()
  }

  // ---------- recap ----------

  recapText(): string {
    const n = this.sessionScores.length
    if (!n) return 'Session over. No drills were scored this time.'
    const avg = this.sessionScores.reduce((s, x) => s + x.score, 0) / n
    const units = [...new Set(this.sessionScores.map((x) => `${x.drill.unit}:${x.drill.level}`))]
    let weakest: { unit: string; avg: number } | null = null
    for (const key of units) {
      const [unit, level] = key.split(':')
      const m = mastery(this.attempts, unit, Number(level))
      if (m.avg !== null && (!weakest || m.avg < weakest.avg)) weakest = { unit, avg: m.avg }
    }
    const tomorrow = addDays(this.deps.today(), 1)
    let dueTomorrow = 0
    const ids = new Set(this.cfg.drills.map((d) => d.id))
    for (const s of this.states.values()) if (ids.has(s.id) && s.reps > 0 && s.due <= tomorrow) dueTomorrow++
    const seen = new Set([...this.states.values()].filter((s) => s.reps > 0).map((s) => s.id))
    const nextUnits = languagesFor(this.cfg.settings.languageMix)
      .map((l) => newDrillUnit(this.cfg.drills, l, seen))
      .filter((u): u is string => !!u)
      .map((u) => UNIT_NAMES[u] ?? u)
    const parts = [
      `Session over. ${n} drill${n === 1 ? '' : 's'}, average ${avg.toFixed(1)} out of 3.`,
      weakest ? `Weakest: ${UNIT_NAMES[weakest.unit] ?? weakest.unit}, ${weakest.avg.toFixed(1)} out of 3.` : '',
      `Next: ${dueTomorrow} review${dueTomorrow === 1 ? '' : 's'} due by tomorrow${
        nextUnits.length ? `, and new drills from ${nextUnits.join(' and ')}` : ''
      }.`,
    ]
    return parts.filter(Boolean).join(' ')
  }

  private async recap() {
    const text = this.recapText()
    this.pauseRequested = ''
    this.ctrl = new AbortController()
    this.update({ phase: 'recap', recap: text, said: text, paused: false })
    if (this.silentRecap) return
    try {
      await this.deps.speak(text, this.rate, this.ctrl.signal)
    } catch {
      /* ignore */
    }
  }

  private async saveSessionRecord() {
    if (!this.startedAt) return
    const n = this.sessionScores.length
    const rec: SessionRecord = {
      id: this.sessionId,
      profile: this.cfg.profile,
      startedAt: new Date(this.startedAt).toISOString(),
      endedAt: new Date(this.deps.now()).toISOString(),
      drills: this.view.done,
      scored: n,
      avg: n ? this.sessionScores.reduce((s, x) => s + x.score, 0) / n : 0,
      minutes: Math.round(this.elapsed() / 60000),
    }
    await this.deps.store.saveSession(rec).catch(() => {})
  }
}
