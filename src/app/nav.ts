// Tiny history-backed navigation so Android's back gesture returns to Home instead of closing the app.
import { useEffect, useState } from 'preact/hooks'

export type ScreenName = 'home' | 'spike' | 'settings' | 'session' | 'progress' | 'drills' | 'typed'
export interface Route {
  screen: ScreenName
  params?: Record<string, string>
}

let current: Route = { screen: 'home' }
const subs = new Set<() => void>()
const notify = () => subs.forEach((f) => f())

export function initNav(): void {
  history.replaceState({ route: current }, '')
  addEventListener('popstate', (e) => {
    const r = (e.state as { route?: Route } | null)?.route
    current = r ?? { screen: 'home' }
    notify()
  })
}

export function navigate(screen: ScreenName, params?: Record<string, string>): void {
  current = { screen, params }
  history.pushState({ route: current }, '')
  notify()
}

export function goBack(): void {
  if (current.screen === 'home') return
  history.back()
}

export function useRoute(): Route {
  const [, force] = useState(0)
  useEffect(() => {
    const f = () => force((n) => n + 1)
    subs.add(f)
    return () => subs.delete(f)
  }, [])
  return current
}
