import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Drill } from '../src/data/types'

const DIR = join(__dirname, '..', 'src', 'data', 'drills')

export function loadDrills(): Drill[] {
  return readdirSync(DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .flatMap((f) => JSON.parse(readFileSync(join(DIR, f), 'utf8')) as Drill[])
}

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']

/** How a person would say a whole number. */
export function sayInt(n: number): string {
  if (n < 0) return `negative ${sayInt(-n)}`
  if (n < 20) return ONES[n]
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? ` ${ONES[n % 10]}` : '')
  if (n < 1000) return `${ONES[Math.floor(n / 100)]} hundred${n % 100 ? ` ${sayInt(n % 100)}` : ''}`
  return `${sayInt(Math.floor(n / 1000))} thousand${n % 1000 ? ` ${sayInt(n % 1000)}` : ''}`
}

/** Read every number in a string out as words ("3.5" -> "three point five"). */
export function sayNumbers(s: string): string {
  return s.replace(/-?\d+(\.\d+)?/g, (m) => {
    const [i, d] = m.split('.')
    const head = sayInt(Number(i))
    return d ? `${head} point ${d.split('').map((c) => ONES[Number(c)]).join(' ')}` : head
  })
}
