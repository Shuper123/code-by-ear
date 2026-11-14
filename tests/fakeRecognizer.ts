// A fake SpeechRecognition that behaves like Chrome on Android: each run delivers results and
// then ends on its own after a pause; the caller has to restart it.
import type { RecognizerLike, SpeechResultEventLike } from '../src/speech/stt'

export class FakeRecognizer implements RecognizerLike {
  static all: FakeRecognizer[] = []
  lang = ''
  continuous = false
  interimResults = false
  maxAlternatives = 1
  onstart: ((ev: unknown) => void) | null = null
  onaudiostart: ((ev: unknown) => void) | null = null
  onsoundstart: ((ev: unknown) => void) | null = null
  onspeechstart: ((ev: unknown) => void) | null = null
  onspeechend: ((ev: unknown) => void) | null = null
  onsoundend: ((ev: unknown) => void) | null = null
  onaudioend: ((ev: unknown) => void) | null = null
  onresult: ((ev: SpeechResultEventLike) => void) | null = null
  onerror: ((ev: { error: string }) => void) | null = null
  onend: ((ev: unknown) => void) | null = null
  running = false
  results: { text: string; final: boolean }[] = []

  constructor() {
    FakeRecognizer.all.push(this)
  }
  static reset() {
    FakeRecognizer.all = []
  }
  static last(): FakeRecognizer {
    return FakeRecognizer.all[FakeRecognizer.all.length - 1]
  }
  start() {
    this.running = true
    this.onstart?.({})
    this.onaudiostart?.({})
  }
  stop() {
    if (!this.running) return
    // stop() finalizes pending interim text, then ends
    this.results = this.results.map((r) => ({ ...r, final: true }))
    if (this.results.length) this.emit(0)
    this.end()
  }
  abort() {
    if (!this.running) return
    this.end()
  }
  /** Simulate a result at index i (defaults to appending). */
  hear(text: string, final = true, index = this.results.length) {
    this.onspeechstart?.({})
    this.results[index] = { text, final }
    this.emit(index)
  }
  emit(from: number) {
    const arr = this.results.map((r) => ({ isFinal: r.final, length: 1, 0: { transcript: r.text } }))
    const results = Object.assign([...arr], { length: arr.length }) as unknown as SpeechResultEventLike['results']
    this.onresult?.({ resultIndex: from, results })
  }
  error(code: string) {
    this.onerror?.({ error: code })
  }
  end() {
    if (!this.running) return
    this.running = false
    this.onaudioend?.({})
    this.onend?.({})
  }
}
