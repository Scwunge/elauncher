import * as THREE from 'three'

/** A single 1-texture-pixel plane on the model, tagged with the exact sheet coordinate it
 *  represents. This is the whole point of this module - see its header comment. */
export type PixelMesh = THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> & {
  userData: { x: number; y: number }
}

export interface BuiltLayer {
  group: THREE.Group
  meshes: PixelMesh[]
}

export interface BuiltPart {
  name: string
  inner: BuiltLayer
  outer: BuiltLayer
}

interface LayerSpec {
  /** Physical box size this layer actually renders at (the outer/"biased" layer is always
   *  slightly larger than its own pixel-grid size - e.g. a 4-wide arm's outer layer renders at
   *  4.5 wide - so each pixel plane ends up marginally larger than 1 unit, not the grid itself
   *  being a different pixel count). */
  renderWidth: number
  renderHeight: number
  renderDepth: number
  /** Pixel-grid size (always integers, matching the source texture) - independent of renderWidth/
   *  Height/Depth for exactly the reason above. */
  pixelWidth: number
  pixelHeight: number
  pixelDepth: number
  /** Top-left of this box's UV block on the 64x64 (or 64x32) skin sheet, matching skinview3d's own
   *  setUVs(box, u, v, w, h, d) calls in node_modules/skinview3d/libs/model.js verbatim - reusing
   *  its already-correct numbers rather than re-deriving Minecraft's skin layout by hand. */
  u: number
  v: number
  /** This layer's own local position offset, relative to the BodyPart group it's a child of (NOT
   *  world space) - e.g. the head mesh sits at local y=4 within the "head" group, arms/legs sit at
   *  their pivot group's own offset within the arm/leg group. Both layers of a part share the same
   *  offset (they're siblings under the same pivot in skinview3d's own hierarchy). */
  offsetX: number
  offsetY: number
  offsetZ: number
}

interface PartSpec {
  name: string
  inner: LayerSpec
  outer: LayerSpec
}

/** Every number here is read directly from skinview3d's own SkinObject constructor
 *  (node_modules/skinview3d/libs/model.js) - box dimensions, setUVs() calls, and each mesh's own
 *  local position/pivot offset - not re-derived from scratch. `slim` only changes arm width
 *  (3/3.5 vs 4/4.5), matching the classic/slim toggle exactly as skinview3d itself does it. */
function partSpecs(slim: boolean): PartSpec[] {
  const armInnerW = slim ? 3 : 4
  const armOuterW = slim ? 3.5 : 4.5
  const armPivotX = slim ? 0.5 : 1
  return [
    {
      name: 'head',
      inner: { renderWidth: 8, renderHeight: 8, renderDepth: 8, pixelWidth: 8, pixelHeight: 8, pixelDepth: 8, u: 0, v: 0, offsetX: 0, offsetY: 4, offsetZ: 0 },
      outer: { renderWidth: 9, renderHeight: 9, renderDepth: 9, pixelWidth: 8, pixelHeight: 8, pixelDepth: 8, u: 32, v: 0, offsetX: 0, offsetY: 4, offsetZ: 0 },
    },
    {
      name: 'body',
      inner: { renderWidth: 8, renderHeight: 12, renderDepth: 4, pixelWidth: 8, pixelHeight: 12, pixelDepth: 4, u: 16, v: 16, offsetX: 0, offsetY: 0, offsetZ: 0 },
      outer: { renderWidth: 8.5, renderHeight: 12.5, renderDepth: 4.5, pixelWidth: 8, pixelHeight: 12, pixelDepth: 4, u: 16, v: 32, offsetX: 0, offsetY: 0, offsetZ: 0 },
    },
    {
      name: 'rightArm',
      inner: { renderWidth: armInnerW, renderHeight: 12, renderDepth: 4, pixelWidth: armInnerW, pixelHeight: 12, pixelDepth: 4, u: 40, v: 16, offsetX: -armPivotX, offsetY: -4, offsetZ: 0 },
      outer: { renderWidth: armOuterW, renderHeight: 12.5, renderDepth: 4.5, pixelWidth: armInnerW, pixelHeight: 12, pixelDepth: 4, u: 40, v: 32, offsetX: -armPivotX, offsetY: -4, offsetZ: 0 },
    },
    {
      name: 'leftArm',
      inner: { renderWidth: armInnerW, renderHeight: 12, renderDepth: 4, pixelWidth: armInnerW, pixelHeight: 12, pixelDepth: 4, u: 32, v: 48, offsetX: armPivotX, offsetY: -4, offsetZ: 0 },
      outer: { renderWidth: armOuterW, renderHeight: 12.5, renderDepth: 4.5, pixelWidth: armInnerW, pixelHeight: 12, pixelDepth: 4, u: 48, v: 48, offsetX: armPivotX, offsetY: -4, offsetZ: 0 },
    },
    {
      name: 'rightLeg',
      inner: { renderWidth: 4, renderHeight: 12, renderDepth: 4, pixelWidth: 4, pixelHeight: 12, pixelDepth: 4, u: 0, v: 16, offsetX: 0, offsetY: -6, offsetZ: 0 },
      outer: { renderWidth: 4.5, renderHeight: 12.5, renderDepth: 4.5, pixelWidth: 4, pixelHeight: 12, pixelDepth: 4, u: 0, v: 32, offsetX: 0, offsetY: -6, offsetZ: 0 },
    },
    {
      name: 'leftLeg',
      inner: { renderWidth: 4, renderHeight: 12, renderDepth: 4, pixelWidth: 4, pixelHeight: 12, pixelDepth: 4, u: 16, v: 48, offsetX: 0, offsetY: -6, offsetZ: 0 },
      outer: { renderWidth: 4.5, renderHeight: 12.5, renderDepth: 4.5, pixelWidth: 4, pixelHeight: 12, pixelDepth: 4, u: 0, v: 48, offsetX: 0, offsetY: -6, offsetZ: 0 },
    },
  ]
}

type FaceName = 'right' | 'left' | 'top' | 'bottom' | 'front' | 'back'

/** Per-face pixel-grid dimensions, the physical size each pixel-plane needs to be to exactly fill
 *  this box's (possibly non-integer, for the outer/"biased" layer) render size, and the UV-sheet
 *  sub-rect offset within the layer's overall (u,v) block - matching setUVs()'s own
 *  toFaceVertices() calls exactly (right/left/top/bottom/front/back, same order and offsets, see
 *  model.js). */
function faceLayout(spec: LayerSpec): {
  face: FaceName
  cols: number
  rows: number
  sheetU: number
  sheetV: number
  pixelSizeCol: number
  pixelSizeRow: number
}[] {
  const { pixelWidth: w, pixelHeight: h, pixelDepth: d, u, v, renderWidth, renderHeight, renderDepth } = spec
  const colW = renderWidth / w
  const rowH = renderHeight / h
  const colD = renderDepth / d
  return [
    { face: 'right', cols: d, rows: h, sheetU: u, sheetV: v + d, pixelSizeCol: colD, pixelSizeRow: rowH },
    { face: 'left', cols: d, rows: h, sheetU: u + d + w, sheetV: v + d, pixelSizeCol: colD, pixelSizeRow: rowH },
    { face: 'top', cols: w, rows: d, sheetU: u + d, sheetV: v, pixelSizeCol: colW, pixelSizeRow: colD },
    { face: 'bottom', cols: w, rows: d, sheetU: u + d + w, sheetV: v, pixelSizeCol: colW, pixelSizeRow: colD },
    { face: 'front', cols: w, rows: h, sheetU: u + d, sheetV: v + d, pixelSizeCol: colW, pixelSizeRow: rowH },
    { face: 'back', cols: w, rows: h, sheetU: u + 2 * d + w, sheetV: v + d, pixelSizeCol: colW, pixelSizeRow: rowH },
  ]
}

/** Builds one Group per layer, containing a `cols*rows` grid of 1-pixel PlaneGeometry meshes per
 *  face of the box, each carrying its exact sheet coordinate in `userData`. Colors are read
 *  straight from `sourceCanvas` at build time. */
function buildLayer(spec: LayerSpec, sourceCanvas: HTMLCanvasElement): BuiltLayer {
  const group = new THREE.Group()
  const meshes: PixelMesh[] = []
  const ctx = sourceCanvas.getContext('2d')

  function colorAt(x: number, y: number): { color: THREE.Color; opacity: number } {
    if (!ctx || x < 0 || y < 0 || x >= sourceCanvas.width || y >= sourceCanvas.height) {
      return { color: new THREE.Color(0xffffff), opacity: 0 }
    }
    const [r, g, b, a] = ctx.getImageData(x, y, 1, 1).data
    return { color: new THREE.Color(r / 255, g / 255, b / 255), opacity: a / 255 }
  }

  for (const layout of faceLayout(spec)) {
    const { pixelSizeCol, pixelSizeRow } = layout

    for (let row = 0; row < layout.rows; row++) {
      for (let col = 0; col < layout.cols; col++) {
        const sheetX = Math.round(layout.sheetU + col)
        const sheetY = Math.round(layout.sheetV + row)
        const { color, opacity } = colorAt(sheetX, sheetY)
        // A mesh is generated even for currently-transparent pixels (opacity 0, invisible until
        // painted) - skipping them would make it impossible to ever start a brand-new design on a
        // blank overlay area, since raycasting can only ever hit geometry that exists. Layer
        // selection (paint the overlay vs. paint underneath it) is handled by which mesh LIST is
        // raycast against (the overlay toggle), not by transparent pixels being un-hittable.
        const geometry = new THREE.PlaneGeometry(pixelSizeCol, pixelSizeRow)
        const material = new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity,
          side: THREE.FrontSide,
        })
        const mesh = new THREE.Mesh(geometry, material) as PixelMesh
        mesh.userData = { x: sheetX, y: sheetY }

        // Local offset of this pixel's plane center within the face (face center is at the box's
        // own local origin +/- half its size along the face's normal axis).
        const colOffset = (col - layout.cols / 2 + 0.5) * pixelSizeCol
        const rowOffsetFromTop = (row - layout.rows / 2 + 0.5) * pixelSizeRow

        switch (layout.face) {
          case 'front':
            mesh.position.set(colOffset, -rowOffsetFromTop, spec.renderDepth / 2)
            break
          case 'back':
            mesh.position.set(-colOffset, -rowOffsetFromTop, -spec.renderDepth / 2)
            mesh.rotation.y = Math.PI
            break
          case 'right':
            mesh.position.set(spec.renderWidth / 2, -rowOffsetFromTop, -colOffset)
            mesh.rotation.y = Math.PI / 2
            break
          case 'left':
            mesh.position.set(-spec.renderWidth / 2, -rowOffsetFromTop, colOffset)
            mesh.rotation.y = -Math.PI / 2
            break
          case 'top':
            // Verified by hand against three.js's actual X-rotation matrix (y'=y·cosθ-z·sinθ,
            // z'=y·sinθ+z·cosθ applied to the plane's default +Z-facing normal): rotation.x=+90°
            // resolves to a -Y (downward, inward) normal, not +Y - the two were swapped here
            // originally, making every top/bottom face invisible from outside the model.
            mesh.position.set(colOffset, spec.renderHeight / 2, -rowOffsetFromTop)
            mesh.rotation.x = -Math.PI / 2
            break
          case 'bottom':
            mesh.position.set(colOffset, -spec.renderHeight / 2, rowOffsetFromTop)
            mesh.rotation.x = Math.PI / 2
            break
        }

        group.add(mesh)
        meshes.push(mesh)
      }
    }
  }

  group.position.set(spec.offsetX, spec.offsetY, spec.offsetZ)
  return { group, meshes }
}

/** Builds the whole paintable model (all 6 body parts, both layers) from a source canvas already
 *  holding the current skin's pixels. Attach each part's `{inner,outer}.group` as a child of the
 *  matching NAMED group on the real `viewer.playerObject.skin` (e.g. `skin.head.add(part.inner.group,
 *  part.outer.group)`) rather than re-deriving world-space positions from scratch - the named groups
 *  are already correctly positioned/parented by skinview3d itself. */
export function buildPaintableModel(sourceCanvas: HTMLCanvasElement, slim: boolean): BuiltPart[] {
  return partSpecs(slim).map((spec) => ({
    name: spec.name,
    inner: buildLayer(spec.inner, sourceCanvas),
    outer: buildLayer(spec.outer, sourceCanvas),
  }))
}
