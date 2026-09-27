import { useEffect, useRef } from 'react'
import { SkinViewer, IdleAnimation } from 'skinview3d'

interface Props {
  skinUrl?: string
  model: 'classic' | 'slim'
  /** An EnderPhone cape (PNG, or the first frame of a GIF) - the same texture other players see. */
  capeUrl?: string
  /** Show the cape as an elytra instead. */
  elytra?: boolean
  width?: number
  height?: number
  nameTag?: string
}

/**
 * Full 3D, drag-to-rotate skin preview (skinview3d + three.js). The viewer is created once and
 * kept across re-renders; only the textures reload when their inputs change, so dragging to rotate
 * isn't reset by anything else on the page.
 */
export default function SkinViewer3D({ skinUrl, model, capeUrl, elytra, width = 240, height = 300, nameTag }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewerRef = useRef<SkinViewer>()

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

  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return
    if (capeUrl) {
      viewer.loadCape(capeUrl, { backEquipment: elytra ? 'elytra' : 'cape' }).catch(() => viewer.loadCape(null))
    } else {
      viewer.loadCape(null)
    }
  }, [capeUrl, elytra])

  return <canvas ref={canvasRef} className="skin-viewer-canvas" />
}
