import { useEffect, useState } from 'preact/hooks'
import { loadSettings } from '../settings'
import { kvGet, kvSet } from '../storage/db'
import { DrillsScreen } from './DrillsScreen'
import { Home } from './Home'
import { initNav, useRoute } from './nav'
import { Notice } from './Notice'
import { ProgressScreen } from './ProgressScreen'
import { SessionScreen } from './SessionScreen'
import { SettingsScreen } from './SettingsScreen'
import { Spike } from './Spike'

initNav()

export function App() {
  const route = useRoute()
  const [ready, setReady] = useState(false)
  const [noticeAccepted, setNoticeAccepted] = useState(true)

  useEffect(() => {
    void (async () => {
      await loadSettings()
      setNoticeAccepted(!!(await kvGet<boolean>('noticeAccepted')))
      setReady(true)
    })()
  }, [])

  if (!ready) return <div class="page muted">Loading…</div>

  const accept = async () => {
    await kvSet('noticeAccepted', true)
    setNoticeAccepted(true)
  }

  let screen
  switch (route.screen) {
    case 'spike':
      screen = <Spike />
      break
    case 'settings':
      screen = <SettingsScreen />
      break
    case 'session':
      screen = noticeAccepted ? (
        <SessionScreen profile={route.params?.profile === 'drive' ? 'drive' : 'parked'} drillId={route.params?.drill} />
      ) : (
        <Home />
      )
      break
    case 'progress':
      screen = <ProgressScreen />
      break
    case 'drills':
      screen = <DrillsScreen />
      break
    default:
      screen = <Home />
  }
  return (
    <>
      {screen}
      {!noticeAccepted && <Notice onAccept={accept} />}
    </>
  )
}
