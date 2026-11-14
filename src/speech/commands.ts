// Voice commands (spec section 5). A command counts only when it is the whole utterance, so an
// answer that happens to contain "skip" or "repeat" is still an answer. Which commands are live
// depends on what the app is listening for.
import type { PieceAction } from './stt'

export type Command =
  | 'repeat'
  | 'slower'
  | 'faster'
  | 'hint'
  | 'skip'
  | 'idk'
  | 'answer'
  | 'explain_more'
  | 'read_back'
  | 'wait'
  | 'done'
  | 'pause'
  | 'continue'
  | 'stop'
  | 'go'
  | 'redo'

const PHRASES: Record<Command, string[]> = {
  repeat: ['repeat', 'repeat that', 'repeat please', 'repeat the question', 'say again', 'say that again', 'again',
    'come again', 'one more time', 'what was the question'],
  slower: ['slower', 'slow down', 'go slower', 'speak slower', 'talk slower', 'more slowly'],
  faster: ['faster', 'speed up', 'go faster', 'speak faster', 'talk faster'],
  hint: ['hint', 'give me a hint', 'a hint', 'can i get a hint', 'help', 'clue', 'another hint', 'next hint'],
  skip: ['skip', 'skip it', 'skip this', 'skip this one', 'skip that'],
  idk: ["i don't know", 'i do not know', "don't know", 'dont know', 'i dont know', 'no idea', 'i have no idea',
    'i give up', 'give up', 'not sure', "i'm not sure", 'no clue', 'dunno'],
  answer: ['answer', 'tell me the answer', 'what is the answer', "what's the answer", 'whats the answer',
    'give me the answer', 'show the answer', 'the answer'],
  explain_more: ['explain more', 'explain', 'explain that', 'tell me more', 'more', 'why', 'explain it',
    'more detail', 'go deeper'],
  read_back: ['read it back', 'read back', 'read that back', 'read my answer', 'what did i say', 'read it',
    'read my code', 'read the code'],
  wait: ['wait', 'hold on', 'one second', 'one sec', 'one moment', 'give me a second', 'hang on', 'just a second',
    'wait a second', 'let me think'],
  done: ['done', "i'm done", 'im done', 'i am done', "that's it", 'thats it', 'that is it', "that's all",
    'thats all', 'finished', 'end of answer'],
  pause: ['pause', 'pause session', 'pause please', 'take a break', 'hold up', 'stop'],
  continue: ['continue', 'resume', 'keep going', "let's go", 'lets go', 'go on', 'ready', 'unpause', "i'm ready",
    'next', 'carry on', 'go ahead'],
  stop: ['stop session', 'end session', 'stop the session', 'end the session', 'quit session', 'finish session',
    "that's enough for today", 'end practice', 'stop practice'],
  go: ['go', 'yes go', 'grade it', 'check it', 'run it', 'yes', 'yeah', 'correct', 'submit', 'that is right',
    "that's right", 'go ahead'],
  redo: ['redo', 'try again', 'start over', 'no', 'nope', 'redo it', 'do over', 'say it again'],
}

/** Commands live while waiting for an answer to a drill. */
export const ANSWER_COMMANDS: readonly Command[] = [
  'repeat', 'slower', 'faster', 'hint', 'skip', 'idk', 'answer', 'read_back', 'wait', 'done', 'pause', 'stop',
]
/** While paused (including breaks). */
export const PAUSE_COMMANDS: readonly Command[] = ['continue', 'stop']
/** While waiting for a self-rating. */
export const RATING_COMMANDS: readonly Command[] = ['repeat', 'skip', 'pause', 'stop', 'wait']
/** After a read-back in Sketch and Dictate: grade it or redo it. */
export const CONFIRM_COMMANDS: readonly Command[] = ['go', 'redo', 'repeat', 'pause', 'stop', 'wait']
/** Short window after feedback for follow-ups. */
export const FOLLOWUP_COMMANDS: readonly Command[] = [
  'answer', 'explain_more', 'read_back', 'repeat', 'continue', 'skip', 'pause', 'stop',
]

const LEADING = /^(?:(?:okay|ok|um|uh|er|hey|so|please|alright|all right|well)\s+)+/
const TRAILING = /(?:\s+(?:please|thanks|thank you|now))+$/

export function cleanUtterance(s: string): string {
  return s
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^\w\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(LEADING, '')
    .replace(TRAILING, '')
    .trim()
}

const LOOKUP = new Map<string, Command[]>()
for (const [cmd, list] of Object.entries(PHRASES) as [Command, string[]][]) {
  for (const p of list) {
    const k = cleanUtterance(p)
    LOOKUP.set(k, [...(LOOKUP.get(k) ?? []), cmd])
  }
}

/** The command an utterance is, if it is nothing but a command that is live right now. */
export function matchCommand(utterance: string, allowed: readonly Command[]): Command | null {
  const k = cleanUtterance(utterance)
  if (!k) return null
  const cmds = LOOKUP.get(k)
  if (!cmds) return null
  return cmds.find((c) => allowed.includes(c)) ?? null
}

/** "select part id from lots done" -> the answer without "done", and whether it ended with done. */
export function splitTrailingDone(utterance: string): { text: string; done: boolean } {
  const m = utterance.match(/^(.*?)[\s,.;!?]*\b(?:i'?m done|i am done|done)[\s.!?]*$/i)
  if (!m) return { text: utterance, done: false }
  return { text: m[1].trim(), done: true }
}

/** Self-rating: no 0, partly 1, yes 2, easy 3 (spec section 6). */
export function parseSelfRating(utterance: string): 0 | 1 | 2 | 3 | null {
  const k = cleanUtterance(utterance)
  if (!k) return null
  if (/\b(too easy|easy|very easy|super easy|nailed it|trivial)\b/.test(k)) return 3
  if (/\b(partly|partially|part|sort of|kind of|half|halfway|somewhat|mostly|almost|close|a little|some of it)\b/.test(k)) return 1
  if (/^(no|nope|nah|wrong|incorrect|not really|missed it|i missed it|i was wrong|not at all|zero)\b/.test(k)) return 0
  if (/^(yes|yeah|yep|yup|right|correct|i got it|got it|i was right|true|sure|i did)\b/.test(k)) return 2
  return null
}

/** Build the classifier the speech loop uses to spot whole-utterance commands. */
export function classifierFor(allowed: readonly Command[]): (piece: string, soFar: string) => PieceAction | null {
  return (piece: string) => {
    const k = cleanUtterance(piece)
    if (!k) return null
    if (allowed.includes('wait') && matchCommand(k, ['wait'])) return { kind: 'extend', ms: 10000 }
    if (allowed.includes('done')) {
      if (matchCommand(k, ['done'])) return { kind: 'end', keep: '' }
      const d = splitTrailingDone(piece)
      if (d.done && d.text) return { kind: 'end', keep: d.text }
    }
    const cmd = matchCommand(k, allowed.filter((c) => c !== 'wait' && c !== 'done'))
    return cmd ? { kind: 'command', command: cmd } : null
  }
}
