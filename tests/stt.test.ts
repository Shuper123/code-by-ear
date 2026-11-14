import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { joinPieces, listen, mapRecognitionError, mergeSegments, type PieceAction } from '../src/speech/stt'
import { FakeRecognizer } from './fakeRecognizer'

const factory = () => new FakeRecognizer()
const base = { silenceMs: 4000, initialWaitMs: 12000, restartDelayMs: 100, factory }

const doneOrCommand = (piece: string): PieceAction | null => {
  const p = piece.trim().toLowerCase()
  if (p === 'repeat') return { kind: 'command', command: 'repeat' }
  if (p === 'wait') return { kind: 'extend', ms: 10000 }
  const m = piece.match(/^(.*?)\s*\bdone$/i)
  if (m) return { kind: 'end', keep: m[1] }
  return null
}

beforeEach(() => {
  vi.useFakeTimers()
  FakeRecognizer.reset()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('mergeSegments / joinPieces', () => {
  it('keeps the longer of repeated cumulative results', () => {
    expect(mergeSegments(['hello', 'hello world'])).toBe('hello world')
    expect(mergeSegments(['hello world', 'hello'])).toBe('hello world')
    expect(mergeSegments(['select part id', 'from lots'])).toBe('select part id from lots')
  })
  it('joins pieces with single spaces', () => {
    expect(joinPieces([' a ', '', 'b  c'])).toBe('a b c')
  })
  it('maps error codes', () => {
    expect(mapRecognitionError('no-speech')).toBeNull()
    expect(mapRecognitionError('aborted')).toBeNull()
    expect(mapRecognitionError('network')).toBe('network')
    expect(mapRecognitionError('not-allowed')).toBe('not-allowed')
    expect(mapRecognitionError('service-not-allowed')).toBe('not-allowed')
  })
})

describe('listen() restart loop', () => {
  it('joins an answer split across recognizer restarts and ends after the silence window', async () => {
    const h = listen({ ...base })
    FakeRecognizer.last().hear('select part id', false)
    FakeRecognizer.last().hear('select part id', true, 0)
    FakeRecognizer.last().end() // Android ends after a short pause
    await vi.advanceTimersByTimeAsync(1500) // restart after 100 ms, user pauses
    expect(FakeRecognizer.all.length).toBe(2)
    FakeRecognizer.last().hear('and the sum of quantity')
    FakeRecognizer.last().end()
    await vi.advanceTimersByTimeAsync(5000)
    const r = await h.result
    expect(r.reason).toBe('silence')
    expect(r.text).toBe('select part id and the sum of quantity')
    expect(r.pieces).toEqual(['select part id', 'and the sum of quantity'])
    expect(r.restarts).toBeGreaterThanOrEqual(2)
    expect(r.heardSpeech).toBe(true)
  })

  it('does not end during a pause shorter than the silence window', async () => {
    const h = listen({ ...base })
    FakeRecognizer.last().hear('first part')
    FakeRecognizer.last().end()
    await vi.advanceTimersByTimeAsync(3500) // 3.5 s pause < 4 s
    FakeRecognizer.last().hear('second part')
    FakeRecognizer.last().end()
    await vi.advanceTimersByTimeAsync(4500)
    const r = await h.result
    expect(r.text).toBe('first part second part')
  })

  it('reports no-speech when nothing is said within the thinking time', async () => {
    const h = listen({ ...base, initialWaitMs: 8000 })
    // Android: each run ends with a no-speech error after a few seconds
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(2500)
      FakeRecognizer.last().error('no-speech')
      FakeRecognizer.last().end()
    }
    await vi.advanceTimersByTimeAsync(2000)
    const r = await h.result
    expect(r.reason).toBe('no-speech')
    expect(r.text).toBe('')
    expect(r.heardSpeech).toBe(false)
  })

  it('treats a whole-utterance command as a command and drops it from the text', async () => {
    const h = listen({ ...base, classify: doneOrCommand })
    FakeRecognizer.last().hear('repeat')
    await vi.advanceTimersByTimeAsync(50)
    const r = await h.result
    expect(r.reason).toBe('command')
    expect(r.command).toBe('repeat')
    expect(r.text).toBe('')
  })

  it('ends immediately on a trailing "done" and keeps the rest', async () => {
    const h = listen({ ...base, classify: doneOrCommand })
    FakeRecognizer.last().hear('it prints one done')
    await vi.advanceTimersByTimeAsync(50)
    const r = await h.result
    expect(r.reason).toBe('done')
    expect(r.text).toBe('it prints one')
  })

  it('"wait" extends listening by 10 seconds', async () => {
    const h = listen({ ...base, classify: doneOrCommand })
    FakeRecognizer.last().hear('wait')
    FakeRecognizer.last().end()
    await vi.advanceTimersByTimeAsync(8000) // past the 4 s silence window, inside the 10 s extension
    FakeRecognizer.last().hear('it returns three')
    FakeRecognizer.last().end()
    await vi.advanceTimersByTimeAsync(5000)
    const r = await h.result
    expect(r.text).toBe('it returns three')
    expect(r.reason).toBe('silence')
  })

  it('retries network errors twice, then reports offline', async () => {
    const h = listen({ ...base })
    for (let i = 0; i < 3; i++) {
      FakeRecognizer.last().error('network')
      FakeRecognizer.last().end()
      await vi.advanceTimersByTimeAsync(200)
    }
    const r = await h.result
    expect(r.reason).toBe('error')
    expect(r.error).toBe('network')
  })

  it('reports a blocked microphone at once', async () => {
    const h = listen({ ...base })
    FakeRecognizer.last().error('not-allowed')
    await vi.advanceTimersByTimeAsync(1000)
    const r = await h.result
    expect(r.error).toBe('not-allowed')
  })

  it('keeps interim words that never became final when the answer times out', async () => {
    const h = listen({ ...base, silenceMs: 10000, maxMs: 6000 })
    FakeRecognizer.last().hear('group by part', false)
    await vi.advanceTimersByTimeAsync(7000)
    const r = await h.result
    expect(r.reason).toBe('max')
    expect(r.text).toBe('group by part')
  })

  it('returns unsupported when there is no recognizer', async () => {
    const r = await listen({ ...base, factory: null }).result
    expect(r.error).toBe('unsupported')
  })
})
