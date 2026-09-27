import { useEffect, useState } from 'react'
import type { LaunchOverride } from '../types'

interface Props {
  modpackId: string
  modpackName: string
  onClose: () => void
}

/**
 * Per-modpack launch overrides (memory + extra JVM args) - the global Settings tab's
 * minMemoryMb/maxMemoryMb still apply everywhere by default, this only takes effect for this one
 * instance, for e.g. one heavy modpack that needs more heap than everything else.
 */
export default function LaunchSettings({ modpackId, modpackName, onClose }: Props) {
  const [override, setOverride] = useState<LaunchOverride>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    window.api.launchOverrides.get(modpackId).then(setOverride)
  }, [modpackId])

  async function save(patch: Partial<LaunchOverride>) {
    setSaving(true)
    await window.api.launchOverrides.set(modpackId, patch)
    setOverride((prev) => {
      const next = { ...prev, ...patch }
      for (const k of Object.keys(next) as (keyof LaunchOverride)[]) {
        if (next[k] == null) delete next[k]
      }
      return next
    })
    setSaving(false)
  }

  async function reset() {
    setSaving(true)
    await window.api.launchOverrides.set(modpackId, { minMemoryMb: undefined, maxMemoryMb: undefined, jvmArgs: undefined })
    setOverride({})
    setSaving(false)
  }

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <h2>Launch settings for this instance</h2>
        <p className="field-hint">{modpackName}</p>

        <div className="field">
          <label>Min memory (MB) — leave blank to use the global default</label>
          <input
            type="number"
            value={override.minMemoryMb ?? ''}
            placeholder="e.g. 2048"
            onChange={(e) => setOverride((prev) => ({ ...prev, minMemoryMb: e.target.value ? Number(e.target.value) : undefined }))}
            onBlur={() => save({ minMemoryMb: override.minMemoryMb })}
          />
        </div>

        <div className="field">
          <label>Max memory (MB) — leave blank to use the global default</label>
          <input
            type="number"
            value={override.maxMemoryMb ?? ''}
            placeholder="e.g. 8192"
            onChange={(e) => setOverride((prev) => ({ ...prev, maxMemoryMb: e.target.value ? Number(e.target.value) : undefined }))}
            onBlur={() => save({ maxMemoryMb: override.maxMemoryMb })}
          />
        </div>

        <div className="field">
          <label>Extra JVM arguments — space-separated, e.g. "-XX:+UseG1GC"</label>
          <input
            type="text"
            value={override.jvmArgs ?? ''}
            placeholder="leave blank for none"
            onChange={(e) => setOverride((prev) => ({ ...prev, jvmArgs: e.target.value || undefined }))}
            onBlur={() => save({ jvmArgs: override.jvmArgs })}
          />
        </div>

        <div className="settings-actions">
          <button className="danger-button" disabled={saving} onClick={reset}>
            Reset to defaults
          </button>
          <button className="primary-button" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
