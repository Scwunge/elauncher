import { useEffect, useRef, useState, type DragEvent } from 'react'
import { useEnderNet } from '../state'
import type { CapeInfo, OfficialCape, Profile } from '../types'
import capesIcon from '../assets/ender-capes-icon.png'
import Icon from './Icon'
import SkinEditorPage from './SkinEditorPage'
import SkinViewer3D from './SkinViewer3D'

interface Props {
  profile: Profile
  onSkinUploaded: (skinUrl: string, skinModel: 'classic' | 'slim') => void
}

/** An official cape's front face, cut from its texture the way the game does (64x32 layout, face at 1,1, 10x16). */
function CapeThumb({ texture }: { texture?: Blob }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas || !texture) return
    let cancelled = false
    void createImageBitmap(texture).then((img) => {
      if (cancelled) return
      const k = img.width / 64
      canvas.width = 10 * k
      canvas.height = 16 * k
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(img, k, k, 10 * k, 16 * k, 0, 0, 10 * k, 16 * k)
    }).catch(() => {})
    return () => {
      cancelled = true
    }
  }, [texture])
  return <canvas ref={ref} width={10} height={16} />
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

  // The official Minecraft capes on the account. `picked` is the one being previewed on the model:
  // a texture id, null for "no cape", or undefined when nothing is picked (then the model shows the
  // EnderPhone cape if there is one, else the cape the account wears).
  const [official, setOfficial] = useState<OfficialCape[]>()
  const [officialError, setOfficialError] = useState<string>()
  const [officialBusy, setOfficialBusy] = useState(false)
  const [officialMsg, setOfficialMsg] = useState<{ text: string; bad?: boolean }>()
  const [picked, setPicked] = useState<string | null>()
  const [textures, setTextures] = useState<Record<string, Blob>>({})

  useEffect(() => {
    void window.api.account.capes().then((r) => {
      if (r.ok) setOfficial(r.data)
      else setOfficialError(r.error)
    })
  }, [])

  // Each owned cape's texture, fetched once (by the main process - see official-capes.js).
  useEffect(() => {
    for (const c of official ?? []) {
      if (textures[c.texture]) continue
      void window.api.account.capeTexture(c.texture).then((r) => {
        if (!r.ok) return
        const bytes = Uint8Array.from(atob(r.data.base64), (ch) => ch.charCodeAt(0))
        setTextures((t) => ({ ...t, [c.texture]: new Blob([bytes], { type: r.data.type }) }))
      })
    }
    // Only a new list asks again; textures already fetched are kept.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [official])

  async function wearOfficial(cape: OfficialCape | null) {
    setOfficialBusy(true)
    setOfficialMsg(undefined)
    const r = await window.api.account.setCape(cape ? cape.id : null)
    setOfficialBusy(false)
    if (r.ok) {
      setOfficial(r.data)
      setOfficialMsg({ text: cape ? `You're wearing the ${cape.name} cape. Everyone sees it in game.` : 'No cape on your account now.' })
    } else setOfficialMsg({ text: r.error, bad: true })
  }

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
    setPicked(undefined)
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

  // What the model wears: a picked official cape (or "no cape"); otherwise the EnderPhone cape being
  // previewed or saved; otherwise the official cape the account wears.
  const wornOfficial = official?.find((c) => c.active)?.texture
  const officialShown = picked !== undefined ? picked : !capePreview && !capeSaved ? wornOfficial ?? null : null
  const shownCape = !showCape || picked === null
    ? undefined
    : officialShown
      ? textures[officialShown]
      : capePreview ?? capeSaved ?? undefined
  const pickedCape = picked ? official?.find((c) => c.texture === picked) : undefined

  return (
    <div className="wardrobe">
      <div className="wardrobe-stage">
        <div className="wardrobe-glow" aria-hidden="true" />
        <SkinViewer3D
          skinUrl={skinPreview ?? profile.skinUrl}
          model={variant}
          cape={shownCape}
          capeIsTexture={!!officialShown}
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
              <h3>Minecraft capes</h3>
              <p>The official capes on your Microsoft account. The one you wear shows in game for everyone, on every server. Pick one to try it on.</p>
            </div>
          </div>
          {officialError ? (
            <p className="error-text">{officialError}</p>
          ) : !official ? (
            <p className="field-hint">Loading your capes…</p>
          ) : official.length === 0 ? (
            <p className="field-hint">This account has no official capes yet. Real ones come from Minecraft events, or as codes on Ender Capes.</p>
          ) : (
            <>
              <div className="official-capes">
                <button className={`official-cape${picked === null ? ' selected' : ''}`} onClick={() => setPicked(null)} title="Wear no cape">
                  <span className="official-cape-none"><Icon name="x" size={14} /></span>
                  <span>No cape</span>
                  {!official.some((c) => c.active) && <i className="wearing" title="What you wear now" />}
                </button>
                {official.map((c) => (
                  <button
                    key={c.id}
                    className={`official-cape${officialShown === c.texture ? ' selected' : ''}`}
                    onClick={() => {
                      setPicked(c.texture)
                      setShowCape(true)
                    }}
                    title={c.name}
                  >
                    <CapeThumb texture={textures[c.texture]} />
                    <span>{c.name}</span>
                    {c.active && <i className="wearing" title="What you wear now" />}
                  </button>
                ))}
              </div>
              {officialMsg && <p className={officialMsg.bad ? 'error-text' : 'good-text'}>{officialMsg.text}</p>}
              <div className="settings-actions">
                {picked === null && official.some((c) => c.active) && (
                  <button className="primary-button" disabled={officialBusy} onClick={() => void wearOfficial(null)}>
                    {officialBusy ? 'Saving…' : 'Wear no cape'}
                  </button>
                )}
                {pickedCape && !pickedCape.active && (
                  <button className="primary-button" disabled={officialBusy} onClick={() => void wearOfficial(pickedCape)}>
                    {officialBusy ? 'Saving…' : `Wear ${pickedCape.name}`}
                  </button>
                )}
                {pickedCape?.active && <p className="field-hint">You're wearing this one.</p>}
              </div>
            </>
          )}
        </section>

        <section className="wardrobe-card">
          <div className="wardrobe-card-head">
            <Icon name="cape" size={20} />
            <div>
              <h3>EnderPhone cape</h3>
              <p>Your own PNG or animated GIF, worn on the cape and the elytra. Other EnderPhone players see it on any server.</p>
            </div>
          </div>
          {/* A real Minecraft cape (a Mojang one, seen by every player) is a different thing from the
              EnderPhone cape above - Ender Capes, the cape shop on ender.bio, sells those. */}
          <button className="capes-promo" onClick={() => void window.api.shell.openExternal('https://ender.bio/capes/')}>
            <img src={capesIcon} alt="" />
            <span>
              <strong>Want a real Minecraft cape?</strong>
              <small>Official capes on Ender Capes, delivered as a code in seconds.</small>
            </span>
            <Icon name="external" size={16} />
          </button>
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
