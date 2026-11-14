import { describe, expect, it } from 'vitest'
import {
  ANSWER_COMMANDS,
  classifierFor,
  CONFIRM_COMMANDS,
  FOLLOWUP_COMMANDS,
  matchCommand,
  parseSelfRating,
  PAUSE_COMMANDS,
  splitTrailingDone,
} from '../src/speech/commands'

describe('whole-utterance commands', () => {
  it('recognizes commands said on their own', () => {
    expect(matchCommand('repeat', ANSWER_COMMANDS)).toBe('repeat')
    expect(matchCommand('Repeat.', ANSWER_COMMANDS)).toBe('repeat')
    expect(matchCommand('okay repeat please', ANSWER_COMMANDS)).toBe('repeat')
    expect(matchCommand('skip', ANSWER_COMMANDS)).toBe('skip')
    expect(matchCommand("I don't know.", ANSWER_COMMANDS)).toBe('idk')
    expect(matchCommand('slow down', ANSWER_COMMANDS)).toBe('slower')
    expect(matchCommand('faster', ANSWER_COMMANDS)).toBe('faster')
    expect(matchCommand('give me a hint', ANSWER_COMMANDS)).toBe('hint')
    expect(matchCommand('read it back', ANSWER_COMMANDS)).toBe('read_back')
    expect(matchCommand('pause', ANSWER_COMMANDS)).toBe('pause')
    expect(matchCommand('stop session', ANSWER_COMMANDS)).toBe('stop')
  })
  it('treats answers that contain a command word as answers', () => {
    expect(matchCommand('it will skip the first item', ANSWER_COMMANDS)).toBeNull()
    expect(matchCommand('repeat the loop three times', ANSWER_COMMANDS)).toBeNull()
    expect(matchCommand('the answer is 5', ANSWER_COMMANDS)).toBeNull()
    expect(matchCommand('wait until n is 10', ANSWER_COMMANDS)).toBeNull()
  })
  it('does not steal Python keywords that are real answers', () => {
    expect(matchCommand('continue', ANSWER_COMMANDS)).toBeNull()
    expect(matchCommand('break', ANSWER_COMMANDS)).toBeNull()
    expect(matchCommand('pass', ANSWER_COMMANDS)).toBeNull()
    expect(matchCommand('next', ANSWER_COMMANDS)).toBeNull()
  })
  it('uses context: continue only while paused, go and redo only when confirming', () => {
    expect(matchCommand('continue', PAUSE_COMMANDS)).toBe('continue')
    expect(matchCommand('next', PAUSE_COMMANDS)).toBe('continue')
    expect(matchCommand('go', CONFIRM_COMMANDS)).toBe('go')
    expect(matchCommand('yes', CONFIRM_COMMANDS)).toBe('go')
    expect(matchCommand('redo', CONFIRM_COMMANDS)).toBe('redo')
    expect(matchCommand('go', ANSWER_COMMANDS)).toBeNull()
    expect(matchCommand('explain more', FOLLOWUP_COMMANDS)).toBe('explain_more')
    expect(matchCommand('stop', ANSWER_COMMANDS)).toBe('pause') // a bare "stop" pauses; "stop session" ends
  })
})

describe('done and wait', () => {
  it('strips a trailing done', () => {
    expect(splitTrailingDone('select part id from lots done')).toEqual({ text: 'select part id from lots', done: true })
    expect(splitTrailingDone("it prints one. I'm done.")).toEqual({ text: 'it prints one', done: true })
    expect(splitTrailingDone('it prints one')).toEqual({ text: 'it prints one', done: false })
  })
  it('classifies pieces for the listener', () => {
    const c = classifierFor(ANSWER_COMMANDS)
    expect(c('wait', '')).toEqual({ kind: 'extend', ms: 10000 })
    expect(c('done', 'it prints one')).toEqual({ kind: 'end', keep: '' })
    expect(c('it prints one done', '')).toEqual({ kind: 'end', keep: 'it prints one' })
    expect(c('repeat', '')).toEqual({ kind: 'command', command: 'repeat' })
    expect(c('it prints repeat twice', '')).toBeNull()
  })
})

describe('self-rating', () => {
  it('maps no, partly, yes, easy to 0, 1, 2, 3', () => {
    expect(parseSelfRating('no')).toBe(0)
    expect(parseSelfRating('Nope.')).toBe(0)
    expect(parseSelfRating('partly')).toBe(1)
    expect(parseSelfRating('sort of')).toBe(1)
    expect(parseSelfRating('yes')).toBe(2)
    expect(parseSelfRating('yeah I got it')).toBe(2)
    expect(parseSelfRating('easy')).toBe(3)
    expect(parseSelfRating('that was too easy')).toBe(3)
    expect(parseSelfRating('banana')).toBeNull()
    expect(parseSelfRating('')).toBeNull()
  })
})
