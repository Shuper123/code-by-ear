// Audio cues: short tones (all under 300 ms) generated with the Web Audio API, no audio files.
//   listening  rising sweep        "your turn"
//   gotIt      soft click          "got it"
//   correct    two rising notes
//   partial    one middle note
//   incorrect  one low note
//   paused     falling pair

export type CueName = 'listening' | 'gotIt' | 'correct' | 'partial' | 'incorrect' | 'paused'

export const CUE_LABELS: Record<CueName, string> = {
  listening: 'Listening',
  gotIt: 'Got it',
  correct: 'Correct',
  partial: 'Partly right',
  incorrect: 'Incorrect',
  paused: 'Paused',
}

interface Note {
  f0: number // start frequency, Hz
  f1: number // end frequency, Hz
  at: number // start offset, seconds
  dur: number // seconds
  type: OscillatorType
  gain: number // relative loudness
}

const CUES: Record<CueName, Note[]> = {
  listening: [{ f0: 520, f1: 1040, at: 0, dur: 0.18, type: 'sine', gain: 1 }],
  gotIt: [{ f0: 1700, f1: 1400, at: 0, dur: 0.035, type: 'triangle', gain: 0.7 }],
  correct: [
    { f0: 660, f1: 660, at: 0, dur: 0.11, type: 'sine', gain: 1 },
    { f0: 880, f1: 880, at: 0.13, dur: 0.13, type: 'sine', gain: 1 },
  ],
  partial: [{ f0: 587, f1: 587, at: 0, dur: 0.18, type: 'sine', gain: 1 }],
  incorrect: [{ f0: 220, f1: 205, at: 0, dur: 0.24, type: 'triangle', gain: 1.2 }],
  paused: [
    { f0: 784, f1: 784, at: 0, dur: 0.11, type: 'sine', gain: 0.9 },
    { f0: 523, f1: 523, at: 0.13, dur: 0.13, type: 'sine', gain: 0.9 },
  ],
}

export function cueDurationMs(name: CueName): number {
  return Math.round(Math.max(...CUES[name].map((n) => n.at + n.dur)) * 1000)
}

let ctx: AudioContext | null = null

/** Create/resume the audio context. Call from a user gesture (the Start button). */
export function unlockAudio(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) return null
  if (!ctx) ctx = new AC()
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

export function audioSupported(): boolean {
  return typeof window !== 'undefined' && !!(window.AudioContext ?? (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext)
}

/** Play a cue and resolve when it has finished. */
export function playCue(name: CueName, volume = 0.35): Promise<void> {
  const ac = unlockAudio()
  const total = cueDurationMs(name) + 40
  if (!ac) return Promise.resolve()
  const t0 = ac.currentTime + 0.02
  for (const n of CUES[name]) {
    const osc = ac.createOscillator()
    const g = ac.createGain()
    osc.type = n.type
    osc.frequency.setValueAtTime(n.f0, t0 + n.at)
    if (n.f1 !== n.f0) osc.frequency.exponentialRampToValueAtTime(n.f1, t0 + n.at + n.dur)
    const peak = Math.min(1, volume * n.gain)
    g.gain.setValueAtTime(0.0001, t0 + n.at)
    g.gain.exponentialRampToValueAtTime(peak, t0 + n.at + Math.min(0.012, n.dur / 3))
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + n.at + n.dur)
    osc.connect(g).connect(ac.destination)
    osc.start(t0 + n.at)
    osc.stop(t0 + n.at + n.dur + 0.02)
  }
  return new Promise((r) => setTimeout(r, total))
}
