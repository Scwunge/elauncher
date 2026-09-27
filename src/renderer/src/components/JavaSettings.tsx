import { useEffect, useState } from 'react'
import type { JavaCandidate } from '../types'

interface Props {
  modpackId: string
  modpackName: string
  onClose: () => void
}

/**
 * Per-modpack Java override. Leaving everything blank is the normal case: `ensureJava` in the
 * main process auto-detects (bundled JRE -> previously downloaded -> found on the system ->
 * downloads Eclipse Temurin as a last resort) every time you hit Play, this panel is only for
 * pinning a specific install.
 */
export default function JavaSettings({ modpackId, modpackName, onClose }: Props) {
  const [candidates, setCandidates] = useState<JavaCandidate[]>([])
  const [current, setCurrent] = useState<string | undefined>()
  const [customPath, setCustomPath] = useState('')
  const [error, setError] = useState<string>()
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    window.api.java.list().then(setCandidates)
    window.api.java.getOverride(modpackId).then(setCurrent)
  }, [modpackId])

  async function choose(path: string) {
    setSaving(true)
    setError(undefined)
    const result = await window.api.java.setOverride(modpackId, path)
    setSaving(false)
    if (result.ok) setCurrent(path)
    else setError(result.error)
  }

  async function browseForCustom() {
    const picked = await window.api.java.chooseFile()
    if (picked) {
      setCustomPath(picked)
      await choose(picked)
    }
  }

  async function reset() {
    setSaving(true)
    await window.api.java.clearOverride(modpackId)
    setCurrent(undefined)
    setSaving(false)
  }

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <h2>Java settings for this instance</h2>
        <p className="field-hint">{modpackName}</p>

        <div className="field">
          {candidates.length === 0 ? (
            <p className="field-hint">
              No Java runtimes detected yet - one will be downloaded automatically the first time
              you hit Play.
            </p>
          ) : (
            candidates.map((c) => (
              <label className="radio-label" key={c.path}>
                <input
                  type="radio"
                  name="java-candidate"
                  checked={current === c.path}
                  disabled={saving}
                  onChange={() => choose(c.path)}
                />
                {c.label}
              </label>
            ))
          )}
        </div>

        <div className="field">
          <label>Custom Java path (optional - leave blank to auto-detect)</label>
          <div className="row">
            <input
              type="text"
              value={customPath || current || ''}
              onChange={(e) => setCustomPath(e.target.value)}
              placeholder="C:\Path\To\java.exe"
            />
            <button onClick={browseForCustom}>Browse…</button>
          </div>
        </div>

        {error && <p className="error-text">{error}</p>}

        <div className="settings-actions">
          <button className="danger-button" disabled={saving} onClick={reset}>
            Reset to default
          </button>
          <button className="primary-button" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
