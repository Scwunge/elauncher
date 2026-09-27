import { useState } from 'react'
import type { InstallTarget, Loader } from '../types'

interface Props {
  target?: InstallTarget
  onClose: () => void
  onSaved: () => void
  onDeleted?: () => void
}

/**
 * Create/edit overlay for an instance: name, icon, Minecraft version and loader. EnderPhone itself
 * is switched on from the instance's EnderPhone tab, or by making a New EnderPhone instance.
 */
export default function ModpackEditor({ target, onClose, onSaved, onDeleted }: Props) {
  const isNew = !target
  const [name, setName] = useState(target?.name ?? '')
  const [minecraftVersion, setMinecraftVersion] = useState(target?.minecraftVersion ?? '1.21.1')
  const [loader, setLoader] = useState<Loader>(target?.loader ?? 'vanilla')
  const [loaderVersion, setLoaderVersion] = useState(target?.loaderVersion ?? '')
  const [iconDataUrl, setIconDataUrl] = useState<string>()
  const [error, setError] = useState<string>()
  const [saving, setSaving] = useState(false)

  function handleIcon(file: File) {
    const reader = new FileReader()
    reader.onload = () => setIconDataUrl(reader.result as string)
    reader.readAsDataURL(file)
  }

  async function save() {
    setSaving(true)
    setError(undefined)
    const input = { name, minecraftVersion, loader, loaderVersion: loaderVersion || undefined, iconDataUrl }
    const result = isNew
      ? await window.api.modpacks.create(input)
      : await window.api.modpacks.update(target.id, input)
    setSaving(false)
    if (result.ok) {
      onSaved()
      onClose()
    } else {
      setError('error' in result ? result.error : 'Something went wrong.')
    }
  }

  async function remove() {
    if (!target) return
    if (!confirm(`Delete "${target.name}"? This also deletes its installed files.`)) return
    setSaving(true)
    await window.api.modpacks.remove(target.id, true)
    setSaving(false)
    onDeleted?.()
    onSaved()
    onClose()
  }

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel editor-panel" onClick={(e) => e.stopPropagation()}>
        <h2>{isNew ? 'New blank instance' : 'Edit instance'}</h2>

        <div className="field">
          <label>Name</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div className="field">
          <div className="icon-picker-row">
            <div
              className="icon-preview"
              style={{ backgroundImage: iconDataUrl || target?.iconUrl ? `url(${iconDataUrl ?? target?.iconUrl})` : undefined }}
            >
              {!iconDataUrl && !target?.iconUrl && '?'}
            </div>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => e.target.files?.[0] && handleIcon(e.target.files[0])}
            />
          </div>
        </div>

        <div className="field">
          <label>Minecraft version</label>
          <input
            type="text"
            value={minecraftVersion}
            onChange={(e) => setMinecraftVersion(e.target.value)}
            placeholder="1.21.1"
          />
        </div>

        <div className="field">
          <label>Loader</label>
          <div className="row">
            <select value={loader} onChange={(e) => setLoader(e.target.value as Loader)}>
              <option value="vanilla">Vanilla</option>
              <option value="fabric">Fabric</option>
              <option value="forge">Forge</option>
              <option value="neoforge">NeoForge</option>
              <option value="quilt">Quilt</option>
            </select>
            {loader !== 'vanilla' && (
              <input
                type="text"
                value={loaderVersion}
                onChange={(e) => setLoaderVersion(e.target.value)}
                placeholder="leave blank for latest"
              />
            )}
          </div>
        </div>

        {error && <p className="error-text">{error}</p>}

        <div className="settings-actions">
          {!isNew && (
            <button className="danger-button" disabled={saving} onClick={remove}>
              Delete
            </button>
          )}
          <button className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" disabled={saving || !name} onClick={save}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
