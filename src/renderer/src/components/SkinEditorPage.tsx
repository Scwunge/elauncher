import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { SkinViewer } from 'skinview3d'
import * as THREE from 'three'
import { buildPaintableModel, type BuiltPart, type PixelMesh } from '../skin-mesh-builder'

interface Props {
  skinUrl?: string
  model: 'classic' | 'slim'
  onBack: () => void
  onSaved: (skinUrl: string, model: 'classic' | 'slim') => void
}

type Tool = 'pencil' | 'eraser' | 'bucket' | 'eyedropper'

const SWATCHES = [
  '#f2d3b0', '#e0ac69', '#c68642', '#8d5524', '#5c3a21', '#2e1e14',
  '#000000', '#ffffff', '#e0544a', '#e8b34a', '#57c765', '#4f9cff',
]

const MAX_HISTORY = 30
const BODY_PART_NAMES = ['head', 'body', 'rightArm', 'leftArm', 'rightLeg', 'leftLeg'] as const

function coordKey(x: number, y: number): string {
  return `${x},${y}`
}

/**
 * Real pixel-paint skin editor (pencil/eraser/bucket/eyedropper) - a full page within the Skin tab
 * (left-click "Edit skin" swaps this in, same convention as PlayTab -> InstanceDetailPage), not a
 * popup.
 *
 * Paints onto a purpose-built model of individually-addressed, one-per-pixel meshes
 * (skin-mesh-builder.ts) rather than skinview3d's own shared-box-per-body-part geometry. That
 * shared geometry (one box per part, UV-interpolated across each face) is what every other skin
 * view in the app still uses and is fine for display - but raycasting against it for painting had
 * real ambiguity right at seams (where the inner and outer/overlay layer boxes of the same part
 * nearly touch, or where two body parts meet): tiny floating-point differences in "which surface is
 * closer" could flip which one a ray hit, breaking painting specifically in seam-heavy regions like
 * the back. A working reference implementation
 * (github.com/aeromechanic000/minecraft-skin-editor-3d) sidesteps this by giving every texture pixel
 * its own individually-tagged mesh and raycasting a manually-filtered flat list - no interpolation,
 * no ambiguity, by construction. This mirrors that, but derives every body-part dimension/UV/offset
 * number directly from skinview3d's own verified source (node_modules/skinview3d/libs/model.js)
 * instead of hand-porting a separate coordinate table.
 *
 * The `SkinViewer` is still used for its renderer/camera/lighting/resize handling (all public
 * fields) - the default model is just hidden (`viewer.playerObject.skin.<part>.innerLayer/
 * outerLayer.visible = false`) and our own per-pixel groups are added as siblings under the SAME
 * already-correctly-positioned named body-part groups, so none of skinview3d's own position/pivot
 * math needs re-deriving. No animation is attached (would otherwise subtly move the paint target
 * during editing), and `enableControls: false` + a hand-rolled orbit (see rotateCamera) replaces
 * OrbitControls, whose own native pointer listeners fought with painting in practice.
 *
 * Deliberately NOT built: symmetry, multiple named layers, a flat 2D/UV view, filters, zoom - a
 * pencil/eraser/bucket/eyedropper editor with undo/redo and rotate is the core of what was asked
 * for; those are real follow-up scope, not pretended-finished here.
 */
export default function SkinEditorPage({ skinUrl, model, onBack, onSaved }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<SkinViewer>()
  const sourceCanvasRef = useRef<HTMLCanvasElement>()
  const partsRef = useRef<BuiltPart[]>([])
  // Rebuilt whenever the overlay toggle changes - only meshes in this list are ever raycast
  // against, so an overlay layer that's toggled off is genuinely excluded (not just invisible),
  // and painting always resolves to a real, individually-tagged pixel with zero ambiguity.
  const activeMeshesRef = useRef<PixelMesh[]>([])
  const meshByCoordRef = useRef<Map<string, PixelMesh[]>>(new Map())
  const paintingRef = useRef(false)
  const rotatingRef = useRef(false)
  const lastPointerRef = useRef({ x: 0, y: 0 })
  // The orbit's own canonical state, not re-derived from camera.position each drag step - reading
  // spherical coordinates back OFF the camera and reassigning them on every pointermove accumulates
  // floating-point drift over hundreds of small steps, eventually leaving the camera at a distance/
  // angle where raycasts land on the wrong body part or miss the model entirely. Kept as the single
  // source of truth instead; the camera is just what gets computed FROM it.
  const orbitRef = useRef(new THREE.Spherical())
  const undoStack = useRef<ImageData[]>([])
  const redoStack = useRef<ImageData[]>([])

  const [variant, setVariant] = useState(model)
  const [tool, setTool] = useState<Tool>('pencil')
  const [brushSize, setBrushSize] = useState(1)
  const [color, setColor] = useState('#57c765')
  const [overlayVisible, setOverlayVisible] = useState(true)
  const [, setHistoryTick] = useState(0) // bumped on every undo-stack change, to re-render the Undo/Redo buttons' disabled state
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  /** Tears down any existing paintable model and builds a fresh one from the current source
   *  canvas's pixels - needed on mount, and again whenever Classic/Slim changes (arm width/UV
   *  block actually changes, unlike a simple visibility toggle). */
  function rebuildModel(slim: boolean) {
    const viewer = viewerRef.current
    const sourceCanvas = sourceCanvasRef.current
    if (!viewer || !sourceCanvas) return

    // skinview3d's own constructor defaults this to false and only ever flips it on inside
    // loadSkin() (confirmed in its source) - since we never call loadSkin() here (loading the
    // image into our own hidden canvas instead, not skinview3d's texture pipeline), it stays false
    // forever otherwise, hiding this entire subtree - and everything we build under it - from
    // rendering. Raycasting ignores `.visible` entirely (three.js's own behavior, established
    // earlier), which is exactly why every raycast diagnostic kept coming back looking correct
    // while the canvas stayed blank.
    viewer.playerObject.skin.visible = true

    for (const part of partsRef.current) {
      part.inner.group.parent?.remove(part.inner.group)
      part.outer.group.parent?.remove(part.outer.group)
    }

    const parts = buildPaintableModel(sourceCanvas, slim)
    const byCoord = new Map<string, PixelMesh[]>()
    for (const part of parts) {
      const named = viewer.playerObject.skin[part.name as (typeof BODY_PART_NAMES)[number]]
      named.innerLayer.visible = false
      named.outerLayer.visible = false
      named.add(part.inner.group, part.outer.group)
      for (const mesh of [...part.inner.meshes, ...part.outer.meshes]) {
        const key = coordKey(mesh.userData.x, mesh.userData.y)
        const list = byCoord.get(key)
        if (list) list.push(mesh)
        else byCoord.set(key, [mesh])
      }
    }
    partsRef.current = parts
    meshByCoordRef.current = byCoord
    refreshActiveMeshes()
  }

  /** Only meshes in this list are ever raycast against - excluding the overlay layer entirely
   *  when it's toggled off (not just hiding it) is what lets painting "underneath" resolve
   *  unambiguously to the inner layer. */
  function refreshActiveMeshes() {
    activeMeshesRef.current = partsRef.current.flatMap((p) =>
      overlayVisible ? [...p.inner.meshes, ...p.outer.meshes] : p.inner.meshes,
    )
  }

  useEffect(() => {
    if (!canvasRef.current || !wrapRef.current) return
    const initialRect = wrapRef.current.getBoundingClientRect()
    const viewer = new SkinViewer({
      canvas: canvasRef.current,
      width: Math.max(200, initialRect.width),
      height: Math.max(200, initialRect.height),
      enableControls: false,
    })
    viewerRef.current = viewer
    orbitRef.current.setFromVector3(viewer.camera.position)

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) viewer.setSize(entry.contentRect.width, entry.contentRect.height)
    })
    resizeObserver.observe(wrapRef.current)

    async function load() {
      const sourceCanvas = document.createElement('canvas')
      sourceCanvas.width = 64
      sourceCanvas.height = 64
      if (skinUrl) {
        const image = await new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image()
          img.crossOrigin = 'anonymous'
          img.onload = () => resolve(img)
          img.onerror = () => reject(new Error('Failed to load image'))
          img.src = skinUrl
        })
        // Legacy 64x32 skins stay 64x32 - painting/saving both just follow whatever size loaded.
        sourceCanvas.height = image.height === 32 ? 32 : 64
        sourceCanvas.getContext('2d')?.drawImage(image, 0, 0)
      }
      sourceCanvasRef.current = sourceCanvas
      rebuildModel(variant === 'slim')
      setLoaded(true)
    }
    load().catch(() => setError("Couldn't load the current skin."))

    return () => {
      resizeObserver.disconnect()
      viewer.dispose()
      viewerRef.current = undefined
      sourceCanvasRef.current = undefined
      partsRef.current = []
      activeMeshesRef.current = []
      meshByCoordRef.current = new Map()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Classic/Slim actually changes arm geometry/UV block, not just a visibility flag - rebuild.
  useEffect(() => {
    if (!loaded) return
    rebuildModel(variant === 'slim')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant])

  function ctx2d(): CanvasRenderingContext2D | undefined {
    return sourceCanvasRef.current?.getContext('2d') ?? undefined
  }

  /** Re-reads every currently-built mesh's color/opacity straight from the source canvas - used
   *  after any operation that can touch many pixels at once (undo/redo/flood fill), where updating
   *  meshes one-by-one as they're identified isn't practical. Cheap enough at this scale (a few
   *  thousand 1x1 getImageData reads) since it only runs on discrete user actions, never per frame. */
  function syncAllMeshesFromCanvas() {
    const ctx = ctx2d()
    if (!ctx) return
    for (const meshes of meshByCoordRef.current.values()) {
      const { x, y } = meshes[0].userData
      const [r, g, b, a] = ctx.getImageData(x, y, 1, 1).data
      for (const mesh of meshes) {
        mesh.material.color.setRGB(r / 255, g / 255, b / 255)
        mesh.material.opacity = a / 255
      }
    }
  }

  function pushUndoSnapshot() {
    const ctx = ctx2d()
    const canvas = sourceCanvasRef.current
    if (!ctx || !canvas) return
    undoStack.current.push(ctx.getImageData(0, 0, canvas.width, canvas.height))
    if (undoStack.current.length > MAX_HISTORY) undoStack.current.shift()
    redoStack.current = []
    setHistoryTick((t) => t + 1)
  }

  function undo() {
    const ctx = ctx2d()
    const snapshot = undoStack.current.pop()
    if (!ctx || !snapshot) return
    redoStack.current.push(ctx.getImageData(0, 0, snapshot.width, snapshot.height))
    ctx.putImageData(snapshot, 0, 0)
    syncAllMeshesFromCanvas()
    setHistoryTick((t) => t + 1)
  }

  function redo() {
    const ctx = ctx2d()
    const snapshot = redoStack.current.pop()
    if (!ctx || !snapshot) return
    undoStack.current.push(ctx.getImageData(0, 0, snapshot.width, snapshot.height))
    ctx.putImageData(snapshot, 0, 0)
    syncAllMeshesFromCanvas()
    setHistoryTick((t) => t + 1)
  }

  /** Raycasts against ONLY the currently-active flat mesh list (see refreshActiveMeshes) - never a
   *  nested hierarchy, never anything overlapping/excluded - so a hit's userData is always exactly
   *  the right pixel, no UV interpolation or seam ambiguity possible. */
  function pixelAt(e: ReactPointerEvent<HTMLCanvasElement>): { x: number; y: number } | undefined {
    const viewer = viewerRef.current
    const canvas = canvasRef.current
    if (!viewer || !canvas) return undefined
    const rect = canvas.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    )
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(ndc, viewer.camera)
    const hits = raycaster.intersectObjects(activeMeshesRef.current, false)
    const hit = hits[0] as (THREE.Intersection & { object: PixelMesh }) | undefined
    if (!hit) return undefined
    return hit.object.userData
  }

  function paintAt(x: number, y: number) {
    const ctx = ctx2d()
    if (!ctx) return
    const half = Math.floor(brushSize / 2)
    if (tool === 'pencil') {
      ctx.fillStyle = color
      ctx.fillRect(x - half, y - half, brushSize, brushSize)
      for (let dy = -half; dy < brushSize - half; dy++) {
        for (let dx = -half; dx < brushSize - half; dx++) {
          setMeshColor(x + dx, y + dy, ctx)
        }
      }
    } else if (tool === 'eraser') {
      ctx.clearRect(x - half, y - half, brushSize, brushSize)
      for (let dy = -half; dy < brushSize - half; dy++) {
        for (let dx = -half; dx < brushSize - half; dx++) {
          setMeshColor(x + dx, y + dy, ctx)
        }
      }
    } else if (tool === 'bucket') {
      floodFill(ctx, x, y, color)
      syncAllMeshesFromCanvas()
    } else if (tool === 'eyedropper') {
      const [r, g, b, a] = ctx.getImageData(x, y, 1, 1).data
      if (a > 0) setColor(`#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`)
      setTool('pencil')
    }
  }

  /** Pushes one canvas pixel's current color/opacity out to every mesh tagged with that same
   *  coordinate (inner/outer share the coordinate space, but only meshes actually built for that
   *  spot are in the map - see meshByCoordRef). */
  function setMeshColor(x: number, y: number, ctx: CanvasRenderingContext2D) {
    const meshes = meshByCoordRef.current.get(coordKey(x, y))
    if (!meshes) return
    const [r, g, b, a] = ctx.getImageData(x, y, 1, 1).data
    for (const mesh of meshes) {
      mesh.material.color.setRGB(r / 255, g / 255, b / 255)
      mesh.material.opacity = a / 255
    }
  }

  /** Hand-rolled orbit (no OrbitControls - see the file header comment for why) - spherical
   *  coordinates around the model's center, exactly the technique the reference implementation
   *  this was checked against uses. */
  function rotateCamera(deltaXPx: number, deltaYPx: number) {
    const viewer = viewerRef.current
    const canvas = canvasRef.current
    if (!viewer || !canvas) return
    const rect = canvas.getBoundingClientRect()
    // A full canvas-width drag rotates ~180° horizontally (not 360°) - the original 2x-PI mapping
    // was twitchy enough that landing cleanly on a straight-on rear view took overcorrecting on
    // both axes. Vertical gets an extra half specifically since its usable range (~169°, clamped
    // below) is already narrower than the horizontal's full 360° wrap.
    const dx = (deltaXPx / rect.width) * Math.PI
    const dy = (deltaYPx / rect.height) * Math.PI * 0.5
    const orbit = orbitRef.current
    orbit.theta -= dx
    orbit.phi = Math.max(0.1, Math.min(Math.PI - 0.1, orbit.phi - dy))
    viewer.camera.position.setFromSpherical(orbit)
    viewer.camera.lookAt(0, 0, 0)
  }

  function handlePointerDown(e: ReactPointerEvent<HTMLCanvasElement>) {
    const px = pixelAt(e)
    lastPointerRef.current = { x: e.clientX, y: e.clientY }
    // Authoritatively set BOTH flags every time, not just the one being activated - if a previous
    // stroke ever left paintingRef stuck true (endStroke not firing for some reason), a later click
    // that correctly misses the model and means to rotate would still get treated as painting by
    // handlePointerMove (which checks paintingRef first), silently never rotating the camera at all
    // and instead painting a streak whatever the static view's current back-facing angle happens to
    // be under the cursor as the user drags, thinking they're just orbiting.
    paintingRef.current = !!px
    rotatingRef.current = !px
    if (px) {
      pushUndoSnapshot()
      paintAt(px.x, px.y)
    }
    // The floating tool panels (size/color) sit visually on top of the canvas (Laby's own layout -
    // see index.css) - without pointer capture, dragging under one of them hands the browser's
    // hit-test to that overlapping element instead, firing a spurious pointerleave on the canvas
    // and killing the stroke after just one pixel. Capture keeps every subsequent move/up event
    // targeted at the canvas regardless of what's visually underneath the cursor.
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (paintingRef.current) {
      const px = pixelAt(e)
      if (px) paintAt(px.x, px.y)
      return
    }
    if (rotatingRef.current) {
      const dx = e.clientX - lastPointerRef.current.x
      const dy = e.clientY - lastPointerRef.current.y
      lastPointerRef.current = { x: e.clientX, y: e.clientY }
      rotateCamera(dx, dy)
    }
  }

  function endStroke(e: ReactPointerEvent<HTMLCanvasElement>) {
    paintingRef.current = false
    rotatingRef.current = false
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  function toggleOverlay(visible: boolean) {
    setOverlayVisible(visible)
    for (const part of partsRef.current) part.outer.group.visible = visible
  }

  // refreshActiveMeshes reads `overlayVisible` via closure, so it must re-run whenever that state
  // changes too, not just when the model is rebuilt.
  useEffect(() => {
    refreshActiveMeshes()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlayVisible])

  async function save() {
    const canvas = sourceCanvasRef.current
    if (!canvas) return
    setBusy(true)
    setError(undefined)
    const dataUrl = canvas.toDataURL('image/png')
    const result = await window.api.account.changeSkin(dataUrl.split(',')[1], variant)
    setBusy(false)
    if (result.ok) {
      onSaved(result.skinUrl, result.model)
      onBack()
    } else {
      setError(result.error)
    }
  }

  const TOOLS: { id: Tool; icon: string; label: string }[] = [
    { id: 'pencil', icon: '✏', label: 'Pencil' },
    { id: 'eraser', icon: '🧹', label: 'Eraser' },
    { id: 'bucket', icon: '🪣', label: 'Fill' },
    { id: 'eyedropper', icon: '💧', label: 'Pick' },
  ]

  return (
    <div className="skin-editor-page">
      <div className="skin-editor-header">
        <button className="back-link" onClick={onBack}>
          ← Back to skin
        </button>
        <div className="skin-editor-header-actions">
          <div className="segmented-control">
            <button
              className={`segmented-option${variant === 'classic' ? ' active' : ''}`}
              onClick={() => setVariant('classic')}
            >
              Classic
            </button>
            <button
              className={`segmented-option${variant === 'slim' ? ' active' : ''}`}
              onClick={() => setVariant('slim')}
            >
              Slim
            </button>
          </div>
          <label className="radio-label">
            <input
              type="checkbox"
              checked={overlayVisible}
              onChange={(e) => toggleOverlay(e.target.checked)}
            />
            Overlay
          </label>
          <button className="secondary-button" onClick={onBack}>
            Cancel
          </button>
          <button className="primary-button" disabled={busy || !loaded} onClick={save}>
            {busy ? 'Saving…' : 'Save skin'}
          </button>
        </div>
      </div>

      {error && <p className="error-text">{error}</p>}

      <div className="skin-editor-workspace">
        <div className="skin-editor-rail">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              className={`skin-editor-rail-btn${tool === t.id ? ' active' : ''}`}
              onClick={() => setTool(t.id)}
              title={t.label}
            >
              <span>{t.icon}</span>
              <label>{t.label}</label>
            </button>
          ))}
          <div className="skin-editor-rail-divider" />
          <button className="skin-editor-rail-btn" disabled={undoStack.current.length === 0} onClick={undo} title="Undo">
            <span>↶</span>
            <label>Undo</label>
          </button>
          <button className="skin-editor-rail-btn" disabled={redoStack.current.length === 0} onClick={redo} title="Redo">
            <span>↷</span>
            <label>Redo</label>
          </button>
        </div>

        <div className="skin-editor-canvas-wrap" ref={wrapRef}>
          <canvas
            ref={canvasRef}
            className="skin-viewer-canvas"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={endStroke}
            onPointerLeave={endStroke}
          />
          {!loaded && <p className="field-hint skin-editor-loading">Loading…</p>}

          {(tool === 'pencil' || tool === 'eraser') && (
            <div className="skin-editor-float skin-editor-float-top">
              <span className="skin-editor-float-label">Size</span>
              <div className="segmented-control">
                {[1, 2, 3, 4].map((size) => (
                  <button
                    key={size}
                    className={`segmented-option${brushSize === size ? ' active' : ''}`}
                    onClick={() => setBrushSize(size)}
                  >
                    {size}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="skin-editor-float skin-editor-float-bottom">
            <input
              type="color"
              className="skin-editor-color-input"
              value={color}
              onChange={(e) => setColor(e.target.value)}
            />
            <div className="skin-editor-swatches-float">
              {SWATCHES.map((s) => (
                <button
                  key={s}
                  className="skin-editor-swatch"
                  style={{ background: s }}
                  onClick={() => setColor(s)}
                  title={s}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Iterative (stack-based, not recursive) flood fill in plain 2D pixel space - naturally respects
 *  Minecraft's UV layout with zero body-part-specific logic, since contiguous same-colored pixels
 *  on the shared texture sheet are exactly what should fill together regardless of which 3D face(s)
 *  they render on. */
function floodFill(ctx: CanvasRenderingContext2D, startX: number, startY: number, hex: string) {
  const { width, height } = ctx.canvas
  const image = ctx.getImageData(0, 0, width, height)
  const data = image.data
  const idx = (x: number, y: number) => (y * width + x) * 4

  const start = idx(startX, startY)
  const targetR = data[start]
  const targetG = data[start + 1]
  const targetB = data[start + 2]
  const targetA = data[start + 3]

  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  const fillR = match ? parseInt(match[1], 16) : 0
  const fillG = match ? parseInt(match[2], 16) : 0
  const fillB = match ? parseInt(match[3], 16) : 0

  if (targetR === fillR && targetG === fillG && targetB === fillB && targetA === 255) return

  const stack: [number, number][] = [[startX, startY]]
  const visited = new Uint8Array(width * height)

  while (stack.length > 0) {
    const [x, y] = stack.pop() as [number, number]
    if (x < 0 || y < 0 || x >= width || y >= height) continue
    const pixelIndex = y * width + x
    if (visited[pixelIndex]) continue
    const i = pixelIndex * 4
    if (data[i] !== targetR || data[i + 1] !== targetG || data[i + 2] !== targetB || data[i + 3] !== targetA) continue

    visited[pixelIndex] = 1
    data[i] = fillR
    data[i + 1] = fillG
    data[i + 2] = fillB
    data[i + 3] = 255

    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1])
  }

  ctx.putImageData(image, 0, 0)
}
