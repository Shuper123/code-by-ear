// App settings, persisted in IndexedDB. The API key is stored under its own key so that
// exports never include it.
import { useEffect, useState } from 'preact/hooks'
import { kvDelete, kvGet, kvSet } from './storage/db'

export const MODELS = ['claude-haiku-5-5', 'claude-sonnet-5-5'] as const
export type ModelId = (typeof MODELS)[number] | string

export interface Settings {
  workspaceId: string
  model: ModelId // grading model
  sketchModel: ModelId // Sketch converter model
  voiceURI: string
  rateDrive: number
  rateParked: number
  silenceDriveMs: number // silence that ends an answer, Drive
  silenceParkedMs: number // silence that ends an answer, Parked
  thinkMs: number // how long to wait for the first words before a prompt counts as unanswered
  languageMix: 'both' | 'sql' | 'python'
  newPerSession: number
  sessionMinutes: number // Drive session length
  sttContinuous: boolean // recognizer "continuous" flag; false = one utterance per recognizer run
  restartDelayMs: number // pause between recognizer restarts
  pauseListening: boolean // while paused, keep listening for "continue"
  mediaButtons: boolean // M4 spike: headset and steering-wheel buttons through the Media Session API
  breakEveryMin: number
  cueVolume: number // 0..1
}

export const DEFAULT_SETTINGS: Settings = {
  workspaceId: '',
  model: 'claude-haiku-5-5',
  sketchModel: 'claude-haiku-5-5',
  voiceURI: '',
  rateDrive: 0.9,
  rateParked: 1.0,
  silenceDriveMs: 4000,
  silenceParkedMs: 2500,
  thinkMs: 15000,
  languageMix: 'both',
  newPerSession: 5,
  sessionMinutes: 25,
  sttContinuous: false,
  restartDelayMs: 120,
  pauseListening: true,
  mediaButtons: false,
  breakEveryMin: 10,
  cueVolume: 0.35,
}

let current: Settings = { ...DEFAULT_SETTINGS }
let apiKey = ''
let loaded = false
const listeners = new Set<() => void>()

function notify() {
  for (const l of listeners) l()
}

export async function loadSettings(): Promise<Settings> {
  const saved = (await kvGet<Partial<Settings>>('settings')) ?? {}
  current = { ...DEFAULT_SETTINGS, ...saved }
  apiKey = (await kvGet<string>('apiKey')) ?? ''
  loaded = true
  notify()
  return current
}

export function settingsLoaded(): boolean {
  return loaded
}

export function getSettings(): Settings {
  return current
}

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  current = { ...current, ...patch }
  await kvSet('settings', current)
  notify()
}

export async function resetSettings(): Promise<void> {
  current = { ...DEFAULT_SETTINGS }
  await kvSet('settings', current)
  notify()
}

export function getApiKey(): string {
  return apiKey
}

export function hasApiKey(): boolean {
  return apiKey.trim().length > 0
}

export async function setApiKey(key: string): Promise<void> {
  apiKey = key.trim()
  if (apiKey) await kvSet('apiKey', apiKey)
  else await kvDelete('apiKey')
  notify()
}

export function subscribeSettings(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Preact hook: re-renders when settings or the API key change. */
export function useSettings(): { settings: Settings; hasKey: boolean } {
  const [, force] = useState(0)
  useEffect(() => subscribeSettings(() => force((n) => n + 1)), [])
  return { settings: current, hasKey: hasApiKey() }
}
