// Service worker registration. New versions wait until the user taps "Reload" on Home, so an
// update never interrupts a session.
import { registerSW } from 'virtual:pwa-register'

let updateFn: ((reload?: boolean) => Promise<void>) | null = null
let needRefresh = false
let offlineReady = false
const subs = new Set<() => void>()
const notify = () => subs.forEach((f) => f())

export function initPwa(): void {
  if (!('serviceWorker' in navigator)) return
  updateFn = registerSW({
    immediate: true,
    onNeedRefresh() {
      needRefresh = true
      notify()
    },
    onOfflineReady() {
      offlineReady = true
      notify()
    },
    onRegisteredSW(_url, reg) {
      if (!reg) return
      const check = () => {
        if (document.visibilityState === 'visible' && navigator.onLine) reg.update().catch(() => {})
      }
      document.addEventListener('visibilitychange', check)
      setInterval(check, 30 * 60 * 1000)
    },
  })
}

export const pwa = {
  updateReady: () => needRefresh,
  offlineReady: () => offlineReady,
  applyUpdate: () => void updateFn?.(true),
  subscribe(fn: () => void): () => void {
    subs.add(fn)
    return () => subs.delete(fn)
  },
}

export function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  )
}
