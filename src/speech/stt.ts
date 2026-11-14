// Speech in: Chrome's Web Speech API with a restart loop.
//
// Chrome on Android ends recognition after short pauses no matter what `continuous` says, so a
// single answer arrives as several recognizer runs ("pieces"). This module restarts the
// recognizer until the answer is over, joins the pieces, and decides when the answer ended:
//   - `silenceMs` of quiet after speech started (4 s Drive, 2.5 s Parked), or
//   - a piece the caller classifies as "end" (for example the word "done"), or
//   - a piece the caller classifies as a command (for example "repeat"), or
//   - no words at all within `initialWaitMs` (the prompt counts as unanswered), or
//   - `maxMs` total.
// Half-duplex: callers must never start listening while text-to-speech is playing.

export interface SpeechResultAlternativeLike {
  transcript: string
}
export interface SpeechResultLike {
  readonly isFinal: boolean
  readonly length: number
  [index: number]: SpeechResultAlternativeLike
}
export interface SpeechResultEventLike {
  resultIndex: number
  results: { readonly length: number; [index: number]: SpeechResultLike }
}

/** Minimal shape of a SpeechRecognition object, so tests can inject a fake. */
export interface RecognizerLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onstart: ((ev: unknown) => void) | null
  onaudiostart: ((ev: unknown) => void) | null
  onsoundstart: ((ev: unknown) => void) | null
  onspeechstart: ((ev: unknown) => void) | null
  onspeechend: ((ev: unknown) => void) | null
  onsoundend: ((ev: unknown) => void) | null
  onaudioend: ((ev: unknown) => void) | null
  onresult: ((ev: SpeechResultEventLike) => void) | null
  onerror: ((ev: { error: string; message?: string }) => void) | null
  onend: ((ev: unknown) => void) | null
  start(): void
  stop(): void
  abort(): void
}
export type RecognizerFactory = () => RecognizerLike

export type SttErrorKind = 'unsupported' | 'not-allowed' | 'network' | 'audio-capture' | 'language' | 'other'

export type PieceAction =
  | { kind: 'command'; command: string }
  | { kind: 'extend'; ms: number }
  | { kind: 'end'; keep: string }

export interface ListenOptions {
  lang?: string
  continuous?: boolean
  silenceMs: number
  initialWaitMs: number
  maxMs?: number
  restartDelayMs?: number
  /** Called for every final piece; lets the caller turn whole-utterance commands into actions. */
  classify?: (piece: string, soFar: string) => PieceAction | null
  onUpdate?: (p: ListenProgress) => void
  log?: (event: string, detail?: string) => void
  factory?: RecognizerFactory | null
}

export interface ListenProgress {
  text: string // everything heard so far, including the live (interim) words
  pieces: string[]
  restarts: number
}

export type ListenReason = 'silence' | 'no-speech' | 'max' | 'done' | 'command' | 'aborted' | 'error'

export interface ListenResult {
  text: string
  pieces: string[]
  reason: ListenReason
  command?: string
  error?: SttErrorKind
  restarts: number
  heardSpeech: boolean
  durationMs: number
}

export interface ListenHandle {
  result: Promise<ListenResult>
  /** End the answer now and keep what was heard. */
  stop(): void
  /** End now and discard. */
  abort(): void
  /** Keep listening for at least `ms` more. */
  extend(ms: number): void
}

type SRConstructor = new () => RecognizerLike

export function browserRecognizerFactory(): RecognizerFactory | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: SRConstructor; webkitSpeechRecognition?: SRConstructor }
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition
  return Ctor ? () => new Ctor() : null
}

export function speechRecognitionSupported(): boolean {
  return browserRecognizerFactory() !== null
}

/**
 * Join the results of one recognizer run. Some Android builds repeat earlier text inside later
 * results ("hello", "hello world"); when a result starts with the one before it, keep only the
 * longer one.
 */
export function mergeSegments(segments: string[]): string {
  const out: string[] = []
  for (const raw of segments) {
    const t = raw.trim()
    if (!t) continue
    const prev = out[out.length - 1]
    if (prev !== undefined) {
      const a = prev.toLowerCase()
      const b = t.toLowerCase()
      if (b.startsWith(a)) {
        out[out.length - 1] = t
        continue
      }
      if (a.startsWith(b)) continue
    }
    out.push(t)
  }
  return out.join(' ')
}

export function joinPieces(pieces: string[]): string {
  return pieces
    .map((p) => p.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Map a SpeechRecognition error code; null means "not fatal, just restart". */
export function mapRecognitionError(code: string): SttErrorKind | null {
  switch (code) {
    case 'no-speech':
    case 'aborted':
      return null
    case 'network':
      return 'network'
    case 'not-allowed':
    case 'service-not-allowed':
      return 'not-allowed'
    case 'audio-capture':
      return 'audio-capture'
    case 'language-not-supported':
      return 'language'
    default:
      return 'other'
  }
}

export function describeSttError(kind: SttErrorKind | undefined): string {
  switch (kind) {
    case 'unsupported':
      return 'This browser has no speech recognition. Use Chrome on Android.'
    case 'not-allowed':
      return 'Microphone permission is blocked. Allow the microphone for this app in Chrome settings.'
    case 'network':
      return 'Speech recognition is offline. It needs an internet connection.'
    case 'audio-capture':
      return 'No microphone is available.'
    case 'language':
      return 'Speech recognition does not support this language here.'
    default:
      return 'Speech recognition stopped with an error.'
  }
}

interface Segment {
  text: string // text we keep (may be trimmed, e.g. a trailing "done" removed)
  orig: string // text as the recognizer delivered it
  final: boolean
  consumed: boolean // a command or "wait": not part of the answer
}

const NETWORK_RETRIES = 2
const MAX_CONSECUTIVE_ODD_ERRORS = 4

export function listen(opts: ListenOptions): ListenHandle {
  // debug counter: lets the browser smoke test's fake user answer once per listen
  const g = globalThis as unknown as { __cbeListenSeq?: number }
  g.__cbeListenSeq = (g.__cbeListenSeq ?? 0) + 1
  const factory = opts.factory === undefined ? browserRecognizerFactory() : opts.factory
  let resolveResult!: (r: ListenResult) => void
  const result = new Promise<ListenResult>((r) => (resolveResult = r))
  const startedAt = Date.now()
  const log = (ev: string, detail?: string) => opts.log?.(ev, detail)

  if (!factory) {
    resolveResult({
      text: '',
      pieces: [],
      reason: 'error',
      error: 'unsupported',
      restarts: 0,
      heardSpeech: false,
      durationMs: 0,
    })
    return { result, stop() {}, abort() {}, extend() {} }
  }

  const pieces: string[] = []
  let segs: Segment[] = []
  let rec: RecognizerLike | null = null
  let finished = false
  let finalized = false
  let heardSpeech = false
  let lastActivity = startedAt
  let extendUntil = 0
  let restarts = 0
  let networkErrors = 0
  let oddErrors = 0
  let restartTimer: ReturnType<typeof setTimeout> | null = null
  let endWait: ReturnType<typeof setTimeout> | null = null
  let outcome: { reason: ListenReason; command?: string; error?: SttErrorKind } = { reason: 'aborted' }

  const live = () => segs.filter((s) => !s.consumed).map((s) => s.text)
  const sessionText = () => mergeSegments(live())

  function emit() {
    opts.onUpdate?.({ text: joinPieces([...pieces, sessionText()]), pieces: [...pieces], restarts })
  }

  function commitSession() {
    const t = sessionText()
    if (t) pieces.push(t)
    segs = []
  }

  function handleFinal(i: number) {
    if (!opts.classify) return
    const seg = segs[i]
    let piece = seg.text
    // With the repeated-text quirk, classify only the new words.
    const prev = segs[i - 1]
    if (prev && !prev.consumed && piece.toLowerCase().startsWith(prev.text.toLowerCase())) {
      piece = piece.slice(prev.text.length).trim()
    }
    const before = joinPieces([...pieces, mergeSegments(segs.slice(0, i).filter((s) => !s.consumed).map((s) => s.text))])
    const action = opts.classify(piece, before)
    if (!action) return
    if (action.kind === 'extend') {
      seg.consumed = true
      extendUntil = Date.now() + action.ms
      log('extend', String(action.ms))
    } else if (action.kind === 'end') {
      seg.text = action.keep
      if (!action.keep.trim()) seg.consumed = true
      finish('done')
    } else {
      seg.consumed = true
      finish('command', { command: action.command })
    }
  }

  function startRecognizer() {
    if (finished) return
    let r: RecognizerLike
    try {
      r = factory!()
    } catch (err) {
      log('create-failed', String(err))
      finish('error', { error: 'unsupported' })
      return
    }
    rec = r
    r.lang = opts.lang ?? 'en-US'
    r.continuous = !!opts.continuous
    r.interimResults = true
    r.maxAlternatives = 1
    r.onstart = () => log('start')
    r.onaudiostart = () => log('audiostart')
    r.onsoundstart = () => log('soundstart')
    r.onspeechstart = () => {
      log('speechstart')
      lastActivity = Date.now()
    }
    r.onspeechend = () => log('speechend')
    r.onsoundend = () => log('soundend')
    r.onaudioend = () => log('audioend')
    r.onresult = (e) => {
      if (rec !== r) return
      // After "done" or a command, nothing else belongs to this answer.
      if (finished && (outcome.reason === 'done' || outcome.reason === 'command')) return
      oddErrors = 0
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]
        const text = (res[0]?.transcript ?? '').trim()
        const prev = segs[i]
        // A final result we already handled can be re-sent (for example when stop() flushes);
        // keep our edits to it.
        if (prev && prev.final && prev.orig === text) continue
        const wasFinal = prev?.final ?? false
        segs[i] = { text, orig: text, final: !!res.isFinal, consumed: prev?.consumed ?? false }
        if (text) {
          heardSpeech = true
          lastActivity = Date.now()
        }
        log(res.isFinal ? 'final' : 'interim', text)
        if (res.isFinal && !wasFinal && text && !finished) handleFinal(i)
      }
      // fill holes if a result index was skipped
      for (let i = 0; i < segs.length; i++) if (!segs[i]) segs[i] = { text: '', orig: '', final: true, consumed: true }
      emit()
    }
    r.onerror = (e) => {
      log('error', e.error)
      if (rec !== r) return
      const kind = mapRecognitionError(e.error)
      if (kind === null) return // onend follows and we restart
      if (kind === 'network' && networkErrors < NETWORK_RETRIES) {
        networkErrors++
        return // retry via onend/restart
      }
      if (kind === 'other' && ++oddErrors < MAX_CONSECUTIVE_ODD_ERRORS) return
      finish('error', { error: kind })
    }
    r.onend = () => {
      log('end')
      if (rec !== r) return
      commitSession()
      rec = null
      if (finished) finalize()
      else scheduleRestart()
    }
    try {
      r.start()
    } catch (err) {
      log('start-failed', String(err))
      rec = null
      scheduleRestart(300)
    }
  }

  function scheduleRestart(delay = opts.restartDelayMs ?? 120) {
    if (finished) return
    restarts++
    log('restart', `${delay}ms`)
    restartTimer = setTimeout(() => {
      restartTimer = null
      startRecognizer()
    }, delay)
  }

  function finish(reason: ListenReason, extra: { command?: string; error?: SttErrorKind } = {}) {
    if (finished) return
    finished = true
    outcome = { reason, ...extra }
    clearInterval(tick)
    if (restartTimer) {
      clearTimeout(restartTimer)
      restartTimer = null
    }
    log('finish', reason + (extra.command ? `:${extra.command}` : '') + (extra.error ? `:${extra.error}` : ''))
    const r = rec
    if (r) {
      try {
        // stop() flushes pending words as a final result; abort() discards them.
        if (reason === 'aborted' || reason === 'command' || reason === 'error') r.abort()
        else r.stop()
      } catch {
        /* already stopped */
      }
      endWait = setTimeout(() => {
        if (rec === r) {
          commitSession()
          rec = null
        }
        finalize()
      }, 800)
    } else {
      finalize()
    }
  }

  function finalize() {
    if (finalized) return
    finalized = true
    if (endWait) clearTimeout(endWait)
    if (rec) commitSession()
    const text = outcome.reason === 'aborted' ? '' : joinPieces(pieces)
    resolveResult({
      text,
      pieces: [...pieces],
      reason: outcome.reason,
      command: outcome.command,
      error: outcome.error,
      restarts,
      heardSpeech,
      durationMs: Date.now() - startedAt,
    })
  }

  const tick = setInterval(() => {
    if (finished) return
    const now = Date.now()
    if (opts.maxMs && now - startedAt >= opts.maxMs) {
      finish('max')
      return
    }
    if (!heardSpeech) {
      if (now - startedAt >= opts.initialWaitMs && now >= extendUntil) finish('no-speech')
      return
    }
    if (now >= Math.max(lastActivity + opts.silenceMs, extendUntil)) finish('silence')
  }, 100)

  startRecognizer()

  return {
    result,
    stop: () => finish('done'),
    abort: () => finish('aborted'),
    extend: (ms: number) => {
      extendUntil = Math.max(extendUntil, Date.now() + ms)
    },
  }
}
