// Export and import of progress (spec section 12). The API key never goes into a backup.
import { useRef, useState } from 'preact/hooks'
import { backupFileName, describeBackup, exportBackup, importBackup, parseBackup, type Backup } from '../storage/backup'
import { BUILD } from '../version'

type State =
  | { t: 'idle'; msg?: string; err?: string }
  | { t: 'confirm'; backup: Backup; name: string }
  | { t: 'working' }

export function BackupCard() {
  const [st, setSt] = useState<State>({ t: 'idle' })
  const fileRef = useRef<HTMLInputElement>(null)

  const doExport = async (share: boolean) => {
    try {
      setSt({ t: 'working' })
      const b = await exportBackup(`${BUILD.version} ${BUILD.sha}`)
      const name = backupFileName()
      const blob = new Blob([JSON.stringify(b, null, 1)], { type: 'application/json' })
      const file = new File([blob], name, { type: 'application/json' })
      if (share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Code by Ear backup' })
      } else {
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = name
        document.body.appendChild(a)
        a.click()
        a.remove()
        setTimeout(() => URL.revokeObjectURL(url), 10000)
      }
      setSt({ t: 'idle', msg: `Saved ${name}: ${describeBackup(b)}.` })
    } catch (e) {
      const aborted = e instanceof DOMException && e.name === 'AbortError'
      setSt(aborted ? { t: 'idle' } : { t: 'idle', err: `Export failed: ${(e as Error).message}` })
    }
  }

  const onFile = async (e: Event) => {
    const input = e.target as HTMLInputElement
    const f = input.files?.[0]
    input.value = ''
    if (!f) return
    const parsed = parseBackup(await f.text())
    setSt(parsed.ok ? { t: 'confirm', backup: parsed.backup, name: f.name } : { t: 'idle', err: parsed.error })
  }

  const doImport = async (b: Backup) => {
    try {
      setSt({ t: 'working' })
      await importBackup(b)
      setSt({ t: 'idle', msg: 'Imported. Restarting the app…' })
      setTimeout(() => location.reload(), 900)
    } catch (e) {
      setSt({ t: 'idle', err: `Import failed, nothing was changed: ${(e as Error).message}` })
    }
  }

  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'
  return (
    <div class="card">
      <h2>Backup</h2>
      <p class="faint">
        One JSON file with your progress, notes, sessions and settings. Your API key is never included, and importing
        keeps the key already on this phone.
      </p>
      {st.t === 'confirm' ? (
        <>
          <p>
            <strong>{st.name}</strong>: {describeBackup(st.backup)}.
          </p>
          <p>Importing replaces all progress on this phone with this backup.</p>
          <div class="row">
            <button class="btn danger" onClick={() => doImport(st.backup)}>
              Replace my progress
            </button>
            <button class="btn" onClick={() => setSt({ t: 'idle' })}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <div class="row">
          <button class="btn" disabled={st.t === 'working'} onClick={() => doExport(false)}>
            Export progress
          </button>
          {canShare && (
            <button class="btn" disabled={st.t === 'working'} onClick={() => doExport(true)}>
              Share backup
            </button>
          )}
          <button class="btn" disabled={st.t === 'working'} onClick={() => fileRef.current?.click()}>
            Import progress
          </button>
        </div>
      )}
      <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={onFile} />
      {st.t === 'idle' && st.msg && <p class="small">{st.msg}</p>}
      {st.t === 'idle' && st.err && (
        <p class="small" style={{ color: 'var(--red)' }}>
          {st.err}
        </p>
      )}
    </div>
  )
}
