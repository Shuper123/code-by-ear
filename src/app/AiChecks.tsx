// Settings card: live AI checks with the key stored on this phone, and the Python runtime download.
import { useEffect, useState } from 'preact/hooks'
import { runConverterCheck, runSelfTest, type CheckResult } from '../ai/selftest'
import { AiServices } from '../ai/services'
import { loadPython, onPythonState, pythonState } from '../runtimes/py'
import { useSettings } from '../settings'
import { runners } from './SessionScreen'

function Results({ results, total }: { results: CheckResult[]; total: number }) {
  if (!results.length) return null
  const passed = results.filter((r) => r.pass).length
  const avg = Math.round(results.reduce((s, r) => s + r.ms, 0) / results.length / 100) / 10
  return (
    <div style={{ marginTop: '10px' }}>
      <p>
        <strong>
          {passed} of {results.length}
        </strong>{' '}
        passed{results.length < total ? ` (${results.length} of ${total} done)` : ''} · about {avg} s each
      </p>
      {results.map((r) => (
        <div class="drill-item">
          <span class={`pill ${r.pass ? 'ok' : 'bad'}`}>{r.pass ? 'pass' : 'fail'}</span>
          <div class="t">
            <div>{r.name}</div>
            <div class="faint" style={{ whiteSpace: 'normal' }}>
              {r.detail} · {(r.ms / 1000).toFixed(1)} s
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

export function AiChecks() {
  const { hasKey } = useSettings()
  const [selfTest, setSelfTest] = useState<CheckResult[]>([])
  const [conv, setConv] = useState<CheckResult[]>([])
  const [busy, setBusy] = useState('')
  const [py, setPy] = useState(pythonState())
  const [pyError, setPyError] = useState('')
  useEffect(() => onPythonState(() => setPy(pythonState())), [])

  const runSelf = async () => {
    setBusy('self')
    setSelfTest([])
    const acc: CheckResult[] = []
    await runSelfTest(new AiServices(), (r) => (acc.push(r), setSelfTest([...acc])))
    setBusy('')
  }
  const runConv = async () => {
    setBusy('conv')
    setConv([])
    const acc: CheckResult[] = []
    try {
      await loadPython()
    } catch (e) {
      setPyError(String(e))
    }
    await runConverterCheck(new AiServices(), runners, (r) => (acc.push(r), setConv([...acc])))
    setBusy('')
  }
  const downloadPython = async () => {
    setPyError('')
    try {
      await loadPython()
    } catch (e) {
      setPyError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div class="card">
      <h2>AI and Python checks</h2>
      <p class="muted small">
        These use the key saved on this phone. The self-test grades 6 canned answers (about 6 small requests). The
        converter check turns 20 spoken Sketch answers into code and runs them: buggy answers must stay buggy.
      </p>
      <div class="row">
        <button class="btn" disabled={!hasKey || !!busy} onClick={() => void runSelf()}>
          {busy === 'self' ? 'Running…' : 'Run AI self-test'}
        </button>
        <button class="btn" disabled={!hasKey || !!busy} onClick={() => void runConv()}>
          {busy === 'conv' ? 'Running…' : 'Run converter check'}
        </button>
      </div>
      {!hasKey && <p class="faint">Add an API key above to run these.</p>}
      <Results results={selfTest} total={6} />
      <Results results={conv} total={20} />
      <div class="row" style={{ marginTop: '12px' }}>
        <span class={`pill ${py === 'ready' ? 'ok' : py === 'loading' ? 'warn' : ''}`}>
          Python: {py === 'ready' ? 'loaded' : py === 'loading' ? 'loading…' : 'not loaded'}
        </span>
        <button class="btn" disabled={py !== 'idle'} onClick={() => void downloadPython()}>
          Load Python now
        </button>
      </div>
      <p class="faint">Python Sketch runs your code on the phone. The first load downloads about 12 MB, then it's cached.</p>
      {pyError && <p class="small" style={{ color: 'var(--red)' }}>{pyError}</p>}
    </div>
  )
}
