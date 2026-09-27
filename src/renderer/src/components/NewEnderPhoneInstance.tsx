import { useEffect, useMemo, useState } from 'react'
import { useLaunch } from '../state'
import type { Edition, EnderPhoneTarget, ProgressEvent } from '../types'
import Icon from './Icon'

interface Props {
  onClose: () => void
  onCreated?: (id: string) => void
  suggestedName?: string
}

const EDITIONS: { id: Edition; name: string; blurb: string }[] = [
  { id: 'full', name: 'EnderPhone', blurb: 'Every app, the Modern phone, and the web browser with MCEF built in.' },
  { id: 'lite', name: 'EnderPhone Lite', blurb: 'The same phone without the browser engine - a smaller download.' },
]

const EXTRAS: { id: 'sodium' | 'iris'; name: string; blurb: string }[] = [
  { id: 'sodium', name: 'Sodium', blurb: 'Much faster rendering. EnderPhone runs alongside it.' },
  { id: 'iris', name: 'Iris Shaders', blurb: 'Shader packs. EnderPhone runs under Iris.' },
]

/**
 * The one-screen way to get EnderPhone: pick a Minecraft version and loader it's built for, pick
 * the edition, tick any extras - E-Launcher makes the instance and downloads EnderPhone (and Fabric
 * API on Fabric) right away. Only versions with a real build are offered, straight from the
 * release feed.
 */
export default function NewEnderPhoneInstance({ onClose, onCreated, suggestedName }: Props) {
  const { reloadModpacks, select } = useLaunch()
  const [targets, setTargets] = useState<EnderPhoneTarget[]>()
  const [minecraft, setMinecraft] = useState<string>()
  const [loader, setLoader] = useState<'fabric' | 'neoforge'>('fabric')
  const [edition, setEdition] = useState<Edition>('full')
  const [extras, setExtras] = useState<Set<'sodium' | 'iris'>>(new Set(['sodium']))
  const [name, setName] = useState('')
  const [nameTouched, setNameTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<ProgressEvent>()
  const [error, setError] = useState<string>()

  useEffect(() => {
    window.api.enderphone.targets().then((r) => {
      const list = r.ok ? r.data : []
      setTargets(list)
      setMinecraft(list[0]?.minecraft)
    })
    window.api.settings.get().then((s) => s.defaultEdition && setEdition(s.defaultEdition))
  }, [])
  useEffect(() => window.api.setup.onProgress(setProgress), [])

  const target = targets?.find((t) => t.minecraft === minecraft)
  useEffect(() => {
    if (target && !target.loaders.includes(loader)) setLoader(target.loaders[0] ?? 'fabric')
  }, [target, loader])

  const defaultName = useMemo(
    () => suggestedName ?? `EnderPhone ${minecraft ?? ''}${loader === 'neoforge' ? ' NeoForge' : ''}`.trim(),
    [suggestedName, minecraft, loader],
  )
  const finalName = nameTouched && name.trim() ? name.trim() : defaultName

  function toggleExtra(id: 'sodium' | 'iris') {
    setExtras((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function create() {
    if (!minecraft) return
    setBusy(true)
    setError(undefined)
    const result = await window.api.modpacks.createEnderPhone({
      name: finalName,
      minecraftVersion: minecraft,
      loader,
      edition,
      extras: [...extras],
    })
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    await reloadModpacks()
    select(result.id)
    onCreated?.(result.id)
    onClose()
  }

  return (
    <div className="settings-overlay" onClick={busy ? undefined : onClose}>
      <div className="settings-panel wizard-panel" onClick={(e) => e.stopPropagation()}>
        <div className="wizard-head">
          <span className="connect-icon">
            <Icon name="phone" size={22} />
          </span>
          <div>
            <h2>New EnderPhone instance</h2>
            <p className="field-hint">EnderPhone is installed now and kept up to date every time you press Play.</p>
          </div>
        </div>

        {targets === undefined ? (
          <p className="field-hint">Checking which versions EnderPhone is built for…</p>
        ) : targets.length === 0 ? (
          <p className="error-text">Couldn't load EnderPhone's releases. Check your connection and try again.</p>
        ) : (
          <>
            <div className="field">
              <label>Minecraft version</label>
              <div className="seg-row">
                {targets.map((t) => (
                  <button key={t.minecraft} className={`seg${minecraft === t.minecraft ? ' active' : ''}`} onClick={() => setMinecraft(t.minecraft)}>
                    {t.minecraft}
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <label>Loader</label>
              <div className="seg-row">
                {(['fabric', 'neoforge'] as const).map((l) => (
                  <button
                    key={l}
                    className={`seg${loader === l ? ' active' : ''}`}
                    disabled={!target?.loaders.includes(l)}
                    title={target?.loaders.includes(l) ? '' : `No ${l} build for ${minecraft}`}
                    onClick={() => setLoader(l)}
                  >
                    {l === 'fabric' ? 'Fabric' : 'NeoForge'}
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <label>Edition</label>
              <div className="choice-grid">
                {EDITIONS.map((e) => (
                  <button key={e.id} className={`choice${edition === e.id ? ' active' : ''}`} onClick={() => setEdition(e.id)}>
                    <strong>{e.name}</strong>
                    <span>{e.blurb}</span>
                    {e.id === 'full' && <span className="ribbon">Recommended</span>}
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <label>Extras</label>
              <div className="choice-grid">
                {EXTRAS.map((x) => (
                  <label key={x.id} className={`choice check${extras.has(x.id) ? ' active' : ''}`}>
                    <input type="checkbox" checked={extras.has(x.id)} onChange={() => toggleExtra(x.id)} />
                    <strong>{x.name}</strong>
                    <span>{x.blurb}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="field">
              <label>Name</label>
              <input
                type="text"
                value={nameTouched ? name : defaultName}
                onChange={(e) => {
                  setNameTouched(true)
                  setName(e.target.value)
                }}
              />
            </div>
          </>
        )}

        {busy && progress && <p className="field-hint progress-line">{progress.message}</p>}
        {error && <p className="error-text">{error}</p>}

        <div className="settings-actions">
          <button className="secondary-button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" disabled={busy || !minecraft} onClick={create}>
            {busy ? 'Setting up…' : 'Create instance'}
          </button>
        </div>
      </div>
    </div>
  )
}
