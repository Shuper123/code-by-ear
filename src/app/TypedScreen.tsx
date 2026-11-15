// Typed mode: a short set of tasks at the keyboard. The tasks you built by voice come back here, run
// against the same reference query on the same practice database. No voice on this screen. Matching on the
// first Run is the number that says whether the voice practice is carrying over.
import { useEffect, useRef, useState } from 'preact/hooks'
import { ALL_DRILLS } from '../data/drills'
import { UNIT_NAMES, type Drill } from '../data/types'
import { localDate } from '../engine/dates'
import { idbStore } from '../engine/progress'
import type { Score } from '../engine/scheduler'
import { recordTyped, typedId, typedQueue, typedTasks, type TypedItem } from '../engine/typed'
import { compareRows, type CompareResult } from '../grading/sqlCompare'
import { runSql, type SqlRunResult } from '../runtimes/sql'
import { getSettings } from '../settings'
import type { DrillState } from '../storage/db'
import { formatSql } from '../build/format'
import { ResultTable, SchemaCard } from './BuildView'
import { goBack, navigate } from './nav'

const KEYS = ['(', ')', ',', '*', "'", '_', '=', '<', '>', '.']
const SHOWN = 10

interface Outcome {
  score: Score
  tries: number
  shown: boolean
}

function scoreLabel(o: Outcome): string {
  if (o.shown) return 'Answer shown'
  return o.tries === 1 ? 'Match on the first try' : `Match on try ${o.tries}`
}

export function TypedScreen({ drillId }: { drillId?: string }) {
  const [items, setItems] = useState<TypedItem[] | null>(null)
  const [states, setStates] = useState<Map<string, DrillState>>(new Map())
  const [index, setIndex] = useState(0)
  const [text, setText] = useState('')
  const [tries, setTries] = useState(0)
  const [run, setRun] = useState<SqlRunResult | null>(null)
  const [cmp, setCmp] = useState<CompareResult | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<{ drill: Drill; outcome: Outcome | null }[]>([])
  const box = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    void (async () => {
      const [st, attempts] = await Promise.all([idbStore.loadStates(), idbStore.loadAttempts()])
      setStates(st)
      const one = drillId ? ALL_DRILLS.find((d) => d.id === drillId) : undefined
      setItems(one ? [{ drill: one, reason: 'voice' }] : typedQueue(ALL_DRILLS, st, attempts, localDate(), getSettings().typedPerSet))
      setIndex(0)
      setResults([])
    })()
  }, [drillId])

  const item = items?.[index]
  useEffect(() => {
    setText('')
    setTries(0)
    setRun(null)
    setCmp(null)
    setRevealed(false)
    setOutcome(null)
    box.current?.focus()
  }, [item?.drill.id])

  if (!items) return <div class="page muted">Loading…</div>

  const header = (title: string) => (
    <div class="topbar">
      <button class="back" onClick={goBack}>
        ← Back
      </button>
      <h1>{title}</h1>
    </div>
  )

  // ---------- nothing queued: explain, and offer every task ----------
  if (!items.length) {
    const all = typedTasks(ALL_DRILLS)
    return (
      <div class="page">
        {header('Typed')}
        <div class="card">
          <p>Nothing is waiting to be typed.</p>
          <p class="muted">
            A task shows up here after you pass it by voice in a Build session, and again when its typed review is due. You can
            also type any task now.
          </p>
        </div>
        <div class="card">
          {all.map((d) => {
            const s = states.get(typedId(d.id))
            return (
              <div class="drill-item" key={d.id}>
                <div class="t">
                  <div>{d.prompt_spoken}</div>
                  <div class="faint">
                    {d.unit} {UNIT_NAMES[d.unit]}
                    {s?.reps ? ` · typed, last ${s.lastScore ?? '–'}/3` : ' · not typed yet'}
                  </div>
                </div>
                <button class="btn" onClick={() => navigate('typed', { drill: d.id })}>
                  Type it
                </button>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // ---------- the set is finished ----------
  if (!item) {
    const first = results.filter((r) => r.outcome && r.outcome.score === 3).length
    return (
      <div class="page">
        {header('Typed set done')}
        <div class="card">
          <p style={{ fontSize: '1.1rem' }}>
            First try: <strong>{first}</strong> of {results.length}
          </p>
          {results.map((r) => (
            <div class="drill-item" key={r.drill.id}>
              <div class="t">
                <div>{r.drill.prompt_spoken}</div>
                <div class={`faint ${r.outcome?.score === 3 ? 'typed-ok' : ''}`}>{r.outcome ? scoreLabel(r.outcome) : 'Skipped'}</div>
              </div>
            </div>
          ))}
        </div>
        <div class="grid2">
          <button class="btn primary big" onClick={() => navigate('home')}>
            Home
          </button>
          <button class="btn big" onClick={() => navigate('progress')}>
            Progress
          </button>
        </div>
      </div>
    )
  }

  // ---------- one task ----------
  const d = item.drill
  const insert = (s: string) => {
    const el = box.current
    if (!el) return
    const at = el.selectionStart ?? text.length
    const next = text.slice(0, at) + s + text.slice(el.selectionEnd ?? at)
    setText(next)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(at + s.length, at + s.length)
    })
  }
  const finish = async (o: { tries: number; revealed: boolean }) => {
    const score = await recordTyped(idbStore, d, { ...o, sql: text }, new Date())
    setOutcome({ score, tries: o.tries, shown: o.revealed })
  }
  const onRun = async () => {
    if (!text.trim() || busy) return
    setBusy(true)
    const n = tries + 1
    setTries(n)
    const mine = await runSql(d.dataset, text)
    const ref = await runSql(d.dataset, d.reference ?? '')
    const c = mine.ok && ref.ok ? compareRows(mine, ref, !!d.order_matters) : null
    setRun(mine)
    setCmp(c)
    if (c?.equal && !outcome) await finish({ tries: n, revealed: false })
    setBusy(false)
  }
  const onReveal = async () => {
    setRevealed(true)
    if (!outcome) await finish({ tries, revealed: true })
  }
  const onNext = () => {
    setResults([...results, { drill: d, outcome }])
    setIndex(index + 1)
  }

  return (
    <div class="page">
      {header(`Typed · ${index + 1} of ${items.length}`)}
      <div class="card">
        <div class="step">
          SQL · {UNIT_NAMES[d.unit]} · {item.reason === 'review' ? 'typed review' : 'from your voice practice'}
        </div>
        <p style={{ fontSize: '1.05rem' }}>{d.type === 'sketch' ? d.prompt_spoken.replace(/^Using the [\w ]+? tables?, /, '') : d.prompt_spoken}</p>
      </div>
      <SchemaCard dataset={d.dataset} />
      <div class="card">
        <textarea
          ref={box}
          class="typed-box"
          value={text}
          placeholder="Type the query here"
          autocapitalize="off"
          autocomplete="off"
          autocorrect="off"
          spellcheck={false}
          onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
        />
        <div class="keys-row">
          {KEYS.map((k) => (
            <button type="button" onClick={() => insert(k)} aria-label={`Insert ${k}`}>
              {k}
            </button>
          ))}
        </div>
        <div class="row">
          <button class="btn primary" disabled={busy || !text.trim()} onClick={() => void onRun()}>
            Run
          </button>
          <button class="btn" disabled={revealed} onClick={() => void onReveal()}>
            Show answer
          </button>
          <button class="btn" onClick={onNext}>
            {outcome ? 'Next' : 'Skip'}
          </button>
        </div>
        {outcome && <p class={outcome.score === 3 ? 'typed-ok' : 'typed-miss'}>{scoreLabel(outcome)}.</p>}
        {run && !run.ok && <p class="ed-error">{run.error}</p>}
        {run?.ok && cmp && !cmp.equal && <p class="typed-miss">Try {tries}: not a match. {cmp.note}</p>}
        {run?.ok && <ResultTable columns={run.columns} rows={run.rows.slice(0, SHOWN)} total={run.rows.length} />}
      </div>
      {revealed && (
        <div class="card">
          <div class="step">One answer</div>
          <div class="code" style={{ marginTop: '8px' }}>
            {formatSql(d.reference ?? '')}
          </div>
          <p class="small">{d.model_answer_spoken}</p>
        </div>
      )}
    </div>
  )
}
