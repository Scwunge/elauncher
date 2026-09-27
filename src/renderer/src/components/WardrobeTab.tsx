import { useEffect, useRef, useState, type DragEvent } from 'react'
import { useEnderNet } from '../state'
import type { CapeInfo, Profile } from '../types'
import Icon from './Icon'
import SkinEditorPage from './SkinEditorPage'
import SkinViewer3D from './SkinViewer3D'

interface Props {
  profile: Profile
  onSkinUploaded: (skinUrl: string, skinModel: 'classic' | 'slim') => void
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

/**
 * Skin and cape, previewed together on one 3D model. The skin is your Minecraft skin (uploaded to
 * Mojang, seen everywhere); the cape is your EnderPhone cape (stored on EnderNet, seen by other
 * EnderPhone players on any server - PNG or animated GIF, on the cape and the elytra).
 */
export default function WardrobeTab({ profile, onSkinUploaded }: Props) {
  const { session, requestConnect } = useEnderNet()
  const [variant, setVariant] = useState<'classic' | 'slim'>(profile.skinModel ?? 'classic')
  const [skinPreview, setSkinPreview] = useState<string>()
  const [skinBase64, setSkinBase64] = useState<string>()
  const [skinBusy, setSkinBusy] = useState(false)
  const [skinMsg, setSkinMsg] = useState<{ text: string; bad?: boolean }>()
  const [editorOpen, setEditorOpen] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const skinInput = useRef<HTMLInputElement>(null)

  const [cape, setCape] = useState<CapeInfo>()
  const [capeError, setCapeError] = useState<string>()
  const [capePreview, setCapePreview] = useState<Blob>()
  // The saved cape's picture, as bytes from the main process - never fetched by this page, because
  // the live CDN sends no CORS header (see src/main/cape-download.js).
  const [capeSaved, setCapeSaved] = useState<Blob>()
  const [capeShowError, setCapeShowError] = useState<string>()
  const [capeBase64, setCapeBase64] = useState<string>()
  const [capeBusy, setCapeBusy] = useState(false)
  const [capeMsg, setCapeMsg] = useState<{ text: string; bad?: boolean }>()
  const [showCape, setShowCape] = useState(true)
  const [elytra, setElytra] = useState(false)
  const capeInput = useRef<HTMLInputElement>(null)

  async function loadCape() {
    const r = await window.api.endernet.cape()
    if (r.ok) {
      setCape(r.data)
      setCapeError(undefined)
    } else setCapeError(r.error)
  }
  useEffect(() => {
    if (session.connected) void loadCape()
  }, [session.connected])

  useEffect(() => {
    const url = cape?.cape
    if (!url) {
      setCapeSaved(undefined)
      return
    }
    let cancelled = false
    void window.api.endernet.capeImage(url).then((r) => {
      if (cancelled) return
      if (r.ok) {
        const bytes = Uint8Array.from(atob(r.data.base64), (c) => c.charCodeAt(0))
        setCapeSaved(new Blob([bytes], { type: r.data.type }))
        setCapeShowError(undefined)
      } else {
        setCapeSaved(undefined)
        setCapeShowError(`Couldn't show your cape (${r.error}).`)
      }
    })
    return () => {
      cancelled = true
    }
  }, [cape?.cape])

  async function pickSkin(file: File) {
    setSkinMsg(undefined)
    const dataUrl = await readAsDataUrl(file)
    setSkinPreview(dataUrl)
    setSkinBase64(dataUrl.split(',')[1])
  }

  async function uploadSkin() {
    if (!skinBase64) return
    setSkinBusy(true)
    const result = await window.api.account.changeSkin(skinBase64, variant)
    setSkinBusy(false)
    if (result.ok) {
      setSkinMsg({ text: 'Skin updated - it shows everywhere you play.' })
      setSkinPreview(undefined)
      setSkinBase64(undefined)
      onSkinUploaded(result.skinUrl, result.model)
    } else setSkinMsg({ text: result.error, bad: true })
  }

  async function pickCape(file: File) {
    setCapeMsg(undefined)
    if (cape && file.size > cape.maxBytes) {
      setCapeMsg({ text: `That file is ${(file.size / 1e6).toFixed(1)}MB - a cape can be at most ${(cape.maxBytes / 1e6).toFixed(0)}MB.`, bad: true })
      return
    }
    const dataUrl = await readAsDataUrl(file)
    setCapePreview(file)
    setCapeBase64(dataUrl.split(',')[1])
    setShowCape(true)
  }

  async function uploadCape() {
    if (!capeBase64) return
    setCapeBusy(true)
    const r = await window.api.endernet.setCape(capeBase64)
    setCapeBusy(false)
    if (r.ok) {
      setCapeMsg({ text: 'Cape saved. Other EnderPhone players see it next time they load you in.' })
      setCapePreview(undefined)
      setCapeBase64(undefined)
      await loadCape()
    } else setCapeMsg({ text: r.error, bad: true })
  }

  async function removeCape() {
    if (!confirm('Remove your EnderPhone cape?')) return
    setCapeBusy(true)
    const r = await window.api.endernet.clearCape()
    setCapeBusy(false)
    if (r.ok) {
      setCapeMsg({ text: 'Cape removed.' })
      await loadCape()
    } else setCapeMsg({ text: r.error, bad: true })
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) void pickSkin(file)
  }

  if (editorOpen) {
    return (
      <SkinEditorPage
        skinUrl={profile.skinUrl}
        model={variant}
        onBack={() => setEditorOpen(false)}
        onSaved={(url, model) => {
          onSkinUploaded(url, model)
          setEditorOpen(false)
        }}
      />
    )
  }

  const shownCape = showCape ? capePreview ?? capeSaved ?? undefined : undefined

  return (
    <div className="wardrobe">
      <div className="wardrobe-stage">
        <div className="wardrobe-glow" aria-hidden="true" />
        <SkinViewer3D
          skinUrl={skinPreview ?? profile.skinUrl}
          model={variant}
          cape={shownCape}
          elytra={elytra}
          onCapeError={setCapeShowError}
          width={320}
          height={440}
          nameTag={profile.name}
        />
        <p className="skin-viewer-hint">Drag to turn</p>
        {capeShowError && <p className="error-text">{capeShowError}</p>}
        <div className="seg-row center">
          <button className={`seg${!elytra ? ' active' : ''}`} onClick={() => setElytra(false)}>
            Cape
          </button>
          <button className={`seg${elytra ? ' active' : ''}`} onClick={() => setElytra(true)}>
            Elytra
          </button>
          <button className={`seg${!showCape ? ' active' : ''}`} onClick={() => setShowCape((v) => !v)}>
            {showCape ? 'Hide' : 'Show'}
          </button>
        </div>
      </div>

      <div className="wardrobe-panels">
        <section className="wardrobe-card">
          <div className="wardrobe-card-head">
            <Icon name="shirt" size={20} />
            <div>
              <h3>Skin</h3>
              <p>Your Minecraft skin. Changing it here changes it on your Microsoft account.</p>
            </div>
          </div>
          <div className="field">
            <label>Model</label>
            <div className="seg-row">
              <button className={`seg${variant === 'classic' ? ' active' : ''}`} onClick={() => setVariant('classic')}>
                Classic
              </button>
              <button className={`seg${variant === 'slim' ? ' active' : ''}`} onClick={() => setVariant('slim')}>
                Slim
              </button>
            </div>
          </div>
          <div
            className={`skin-dropzone${dragOver ? ' dragover' : ''}`}
            onClick={() => skinInput.current?.click()}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
          >
            <div className="skin-dropzone-text">
              <strong>{skinPreview ? 'Previewing your file' : 'Drop a skin here'}</strong>
              <span>or click to browse - PNG, 64×64 or 64×32</span>
            </div>
            <input ref={skinInput} type="file" accept="image/png" hidden onChange={(e) => e.target.files?.[0] && pickSkin(e.target.files[0])} />
          </div>
          {skinMsg && <p className={skinMsg.bad ? 'error-text' : 'good-text'}>{skinMsg.text}</p>}
          <div className="settings-actions">
            <button className="secondary-button" onClick={() => setEditorOpen(true)}>
              Open the skin editor
            </button>
            {skinPreview && (
              <>
                <button
                  className="secondary-button"
                  onClick={() => {
                    setSkinPreview(undefined)
                    setSkinBase64(undefined)
                  }}
                >
                  Cancel
                </button>
                <button className="primary-button" disabled={skinBusy} onClick={uploadSkin}>
                  {skinBusy ? 'Uploading…' : 'Use this skin'}
                </button>
              </>
            )}
          </div>
        </section>

        <section className="wardrobe-card">
          <div className="wardrobe-card-head">
            <Icon name="cape" size={20} />
            <div>
              <h3>EnderPhone cape</h3>
              <p>Your own PNG or animated GIF, worn on the cape and the elytra. Other EnderPhone players see it on any server.</p>
            </div>
          </div>
          {!session.connected ? (
            <>
              <p className="field-hint">Capes live on your EnderNet account.</p>
              <button className="primary-button" onClick={requestConnect}>
                Connect to EnderNet
              </button>
            </>
          ) : capeError ? (
            <p className="error-text">{capeError}</p>
          ) : !cape ? (
            <p className="field-hint">Loading your cape…</p>
          ) : !cape.canCustomise ? (
            <div className="locked-note">
              <Icon name="lock" size={18} />
              <p>
                A custom cape comes with the <strong>{cape.tier}</strong> supporter tier.{' '}
                <button className="link-button" onClick={() => window.api.app.getApiBase().then((b) => window.api.shell.openExternal(`${b}/app/donate`))}>
                  See how to support EnderPhone
                </button>
              </p>
            </div>
          ) : (
            <>
              <p className="field-hint">
                {cape.cape ? 'You have a cape set.' : 'No cape set yet.'} Up to {(cape.maxBytes / 1e6).toFixed(0)}MB, {cape.maxSide}px on the long side
                {cape.maxFrames > 1 ? `, ${cape.maxFrames} frames for a GIF` : ''}.
              </p>
              <input ref={capeInput} type="file" accept="image/png,image/gif" hidden onChange={(e) => e.target.files?.[0] && pickCape(e.target.files[0])} />
              {capeMsg && <p className={capeMsg.bad ? 'error-text' : 'good-text'}>{capeMsg.text}</p>}
              <div className="settings-actions">
                {cape.cape && !capePreview && (
                  <button className="danger-button" disabled={capeBusy} onClick={removeCape}>
                    Remove
                  </button>
                )}
                {capePreview ? (
                  <>
                    <button
                      className="secondary-button"
                      onClick={() => {
                        setCapePreview(undefined)
                        setCapeBase64(undefined)
                      }}
                    >
                      Cancel
                    </button>
                    <button className="primary-button" disabled={capeBusy} onClick={uploadCape}>
                      {capeBusy ? 'Saving…' : 'Save cape'}
                    </button>
                  </>
                ) : (
                  <button className="primary-button" onClick={() => capeInput.current?.click()}>
                    <Icon name="download" size={16} /> Choose a cape file
                  </button>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
