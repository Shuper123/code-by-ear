// Screen Wake Lock: keeps the screen on during a session. The lock drops whenever the page is
// hidden, so it is re-acquired when the app comes back to the front.

interface Sentinel {
  released: boolean
  release(): Promise<void>
  addEventListener(type: 'release', fn: () => void): void
}

let sentinel: Sentinel | null = null
let wanted = false
let listenerAdded = false
const subscribers = new Set<() => void>()

export type WakeState = 'held' | 'released' | 'unsupported'

export function wakeLockSupported(): boolean {
  return typeof navigator !== 'undefined' && 'wakeLock' in navigator
}

export function wakeLockState(): WakeState {
  if (!wakeLockSupported()) return 'unsupported'
  return sentinel && !sentinel.released ? 'held' : 'released'
}

export function onWakeLockChange(fn: () => void): () => void {
  subscribers.add(fn)
  return () => subscribers.delete(fn)
}

function notify() {
  for (const f of subscribers) f()
}

async function acquire(): Promise<void> {
  if (!wakeLockSupported() || document.visibilityState !== 'visible') return
  try {
    const wl = (navigator as unknown as { wakeLock: { request(t: 'screen'): Promise<Sentinel> } }).wakeLock
    sentinel = await wl.request('screen')
    sentinel.addEventListener('release', notify)
  } catch {
    sentinel = null
  }
  notify()
}

export async function holdWakeLock(): Promise<WakeState> {
  wanted = true
  if (!listenerAdded && typeof document !== 'undefined') {
    listenerAdded = true
    document.addEventListener('visibilitychange', () => {
      if (wanted && document.visibilityState === 'visible' && wakeLockState() !== 'held') void acquire()
    })
  }
  await acquire()
  return wakeLockState()
}

export async function releaseWakeLock(): Promise<void> {
  wanted = false
  const s = sentinel
  sentinel = null
  if (s && !s.released) {
    try {
      await s.release()
    } catch {
      /* ignore */
    }
  }
  notify()
}
