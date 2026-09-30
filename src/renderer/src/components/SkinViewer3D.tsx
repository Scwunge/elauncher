import { useEffect, useRef } from 'react'
import { SkinViewer, IdleAnimation } from 'skinview3d'
import { loadCapeFrames } from '../cape-art'

/** Elytra wing thickness relative to skinview3d's (vanilla-inflated) box. */
const ELYTRA_DEPTH = 0.5

interface Props {
  skinUrl?: string
  model: 'classic' | 'slim'
  /**
   * An EnderPhone cape: its URL, or a picked file. It's a picture, not a cape texture, so it goes
   * through the mod's own fitting (cape-art.ts) - the preview is what other players see in game.
   */
  cape?: string | Blob
  /**
   * The cape is already a real cape texture (an official Minecraft cape, from Mojang's CDN), not a
   * picture: skinview3d wears it as it is, with no fitting.
   */
  capeIsTexture?: boolean
  /** Show the cape as an elytra instead. */
  elytra?: boolean
  width?: number
  height?: number
  nameTag?: string
  /** Told when a cape can't be shown (unreadable file, download failed), with why. */
  onCapeError?: (message: string | undefined) => void
}

/**
 * Full 3D, drag-to-rotate skin preview (skinview3d + three.js). The viewer is created once and
 * kept across re-renders; only the textures reload when their inputs change, so dragging to rotate
 * isn't reset by anything else on the page.
 */
export default function SkinViewer3D({ skinUrl, model, cape, capeIsTexture, elytra, width = 240, height = 300, nameTag, onCapeError }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewerRef = useRef<SkinViewer>()
  const elytraRef = useRef(elytra)
  elytraRef.current = elytra

  useEffect(() => {
    if (!canvasRef.current) return
    const viewer = new SkinViewer({
      canvas: canvasRef.current,
      width,
      height,
      animation: new IdleAnimation(),
      nameTag,
    })
    // Pull the camera back a little when there's a name tag, so the tag isn't cut off at the top.
    if (nameTag) viewer.zoom = 0.78
    // skinview3d builds each elytra wing as vanilla's 10x20x2 box inflated by 1 all round (12x22x4),
    // which reads chunky this close up. Half the depth: same texture, same outline, a thinner wing.
    // (Scaled about the box's own centre, so it stays against the back.)
    for (const wing of [viewer.playerObject.elytra.leftWing, viewer.playerObject.elytra.rightWing]) {
      for (const mesh of wing.children) mesh.scale.z = ELYTRA_DEPTH
    }
    // Slowly spins on its own; skinview3d suspends autoRotate while the player is dragging.
    viewer.autoRotate = true
    viewer.autoRotateSpeed = 0.6
    viewerRef.current = viewer
    return () => {
      viewer.dispose()
      viewerRef.current = undefined
    }
    // Mount-only - width/height/nameTag are fixed per caller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return
    if (skinUrl) {
      viewer.loadSkin(skinUrl, { model: model === 'classic' ? 'default' : 'slim' }).catch(() => {
        // A broken/unreachable URL just leaves the previous (or blank) model showing.
      })
    } else {
      viewer.loadSkin(null)
    }
  }, [skinUrl, model])

  // The cape: built into a texture (every frame of a GIF), then played if animated.
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return
    if (!cape) {
      viewer.loadCape(null)
      onCapeError?.(undefined)
      return
    }
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const turnRound = () => {
      // A cape is worn on the back: turn round to show it, then carry on spinning from there.
      viewer.resetCameraPose()
      viewer.playerObject.rotation.y = Math.PI
    }
    if (capeIsTexture) {
      const source = typeof cape === 'string' ? fetch(cape).then((r) => r.blob()) : Promise.resolve(cape)
      source
        .then((blob) => createImageBitmap(blob))
        .then((bitmap) => {
          if (cancelled) return
          const canvas = document.createElement('canvas')
          canvas.width = bitmap.width
          canvas.height = bitmap.height
          canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
          onCapeError?.(undefined)
          viewer.loadCape(canvas, { backEquipment: elytraRef.current ? 'elytra' : 'cape' })
          turnRound()
        })
        .catch((err: Error) => {
          if (cancelled) return
          viewer.loadCape(null)
          onCapeError?.(`Couldn't show that cape (${err.message}).`)
        })
      return () => {
        cancelled = true
      }
    }
    loadCapeFrames(cape)
      .then((frames) => {
        if (cancelled || !frames.length) return
        onCapeError?.(undefined)
        viewer.loadCape(frames[0]!.canvas, { backEquipment: elytraRef.current ? 'elytra' : 'cape' })
        turnRound()
        if (frames.length < 2) return
        // Later frames are drawn into the texture the first one created, rather than a new
        // texture per frame.
        let i = 0
        const tick = () => {
          if (cancelled) return
          i = (i + 1) % frames.length
          const ctx = viewer.capeCanvas.getContext('2d')
          if (ctx) {
            ctx.clearRect(0, 0, viewer.capeCanvas.width, viewer.capeCanvas.height)
            ctx.drawImage(frames[i]!.canvas, 0, 0)
            const map = viewer.playerObject.cape.map
            if (map) map.needsUpdate = true
          }
          timer = setTimeout(tick, frames[i]!.delayMs)
        }
        timer = setTimeout(tick, frames[0]!.delayMs)
      })
      .catch((err: Error) => {
        if (cancelled) return
        viewer.loadCape(null)
        onCapeError?.(`Couldn't show that cape (${err.message}).`)
      })
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // onCapeError is a callback prop; the cape itself is what reloads this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cape, capeIsTexture])

  // Cape or elytra: the same texture, worn differently.
  useEffect(() => {
    const viewer = viewerRef.current
    if (viewer && viewer.playerObject.backEquipment) viewer.playerObject.backEquipment = elytra ? 'elytra' : 'cape'
  }, [elytra])

  return <canvas ref={canvasRef} className="skin-viewer-canvas" />
}
