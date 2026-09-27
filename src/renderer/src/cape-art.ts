/**
 * An EnderPhone cape picture turned into a cape texture - a straight port of enderphone-core's
 * `CapeArt.java`, so the launcher's preview shows exactly what other players see in game.
 *
 * An uploaded cape is a picture (any size up to 1024px, PNG or GIF), not a cape texture. The mod
 * fits it onto the four faces people see: the cape's outer and inner faces, and both elytra wings,
 * in vanilla's 64x32 layout at a higher resolution (x`scale`). Handing the raw picture to the 3D
 * viewer instead shows the wrong corner of it, or nothing at all when it isn't 2:1.
 *
 * Pixels are packed ARGB ints, like the Java. The Java does its blending in `float`, so the maths
 * here goes through Math.fround at the same steps - the output matches the mod's byte for byte
 * (test/cape-art.test.mjs holds hashes produced by the Java itself).
 */

export const MAX_STATIC_SCALE = 8
export const MAX_ANIMATED_SCALE = 4

const f = Math.fround

/** Java's Math.round(float): floor(x + 0.5f), in float. */
function roundF(x: number): number {
  return Math.floor(f(f(x) + 0.5))
}

export function scaleFor(srcW: number, srcH: number, animated: boolean): number {
  const s = Math.ceil(Math.max(srcW / 10, srcH / 16))
  return Math.max(1, Math.min(animated ? MAX_ANIMATED_SCALE : MAX_STATIC_SCALE, s))
}

export const width = (scale: number) => 64 * scale
export const height = (scale: number) => 32 * scale

/**
 * @param src ARGB, row-major, `srcW * srcH`
 * @returns ARGB, row-major, `width(scale) * height(scale)`; unused areas transparent (0)
 */
export function compose(src: Int32Array, srcW: number, srcH: number, scale: number): Int32Array {
  const s = scale
  const w = width(s)
  const out = new Int32Array(w * height(s))
  const avg = average(src)
  const edge = shade(avg, f(0.7))

  // Cape: edges first, then the two big faces over them.
  fill(out, w, 0, 0, 22 * s, 17 * s, edge)
  cover(out, w, src, srcW, srcH, 12 * s, s, 10 * s, 16 * s, avg, true, f(0.8))
  // Outer face last so it is exactly the picture, not the inner face's darker copy.
  cover(out, w, src, srcW, srcH, s, s, 10 * s, 16 * s, avg, false, 1)

  // Elytra: the same, onto both wing faces.
  fill(out, w, 22 * s, 0, 24 * s, 22 * s, edge)
  cover(out, w, src, srcW, srcH, 24 * s, 2 * s, 10 * s, 20 * s, avg, false, 1)
  cover(out, w, src, srcW, srcH, 36 * s, 2 * s, 10 * s, 20 * s, avg, true, 1)
  return out
}

function fill(out: Int32Array, w: number, x: number, y: number, fw: number, fh: number, colour: number) {
  for (let row = y; row < y + fh; row++) out.fill(colour, row * w + x, row * w + x + fw)
}

/** Draws the picture into one face, cover-fitted (cropped, not stretched), over an opaque background. */
function cover(
  out: Int32Array,
  w: number,
  src: Int32Array,
  sw: number,
  sh: number,
  x: number,
  y: number,
  fw: number,
  fh: number,
  background: number,
  mirror: boolean,
  light: number,
) {
  const faceAspect = fw / fh
  let cropW = sw
  let cropH = sh
  if (sw / sh > faceAspect) cropW = sh * faceAspect
  else cropH = sw / faceAspect
  const x0 = (sw - cropW) / 2
  const y0 = (sh - cropH) / 2
  const stepX = cropW / fw
  const stepY = cropH / fh

  const br = (background >> 16) & 0xff
  const bgc = (background >> 8) & 0xff
  const bb = background & 0xff

  for (let ty = 0; ty < fh; ty++) {
    let sy0 = Math.floor(y0 + ty * stepY)
    let sy1 = Math.max(sy0 + 1, Math.ceil(y0 + (ty + 1) * stepY))
    sy0 = Math.min(Math.max(sy0, 0), sh - 1)
    sy1 = Math.min(sy1, sh)
    for (let tx = 0; tx < fw; tx++) {
      const column = mirror ? fw - 1 - tx : tx
      let sx0 = Math.floor(x0 + column * stepX)
      let sx1 = Math.max(sx0 + 1, Math.ceil(x0 + (column + 1) * stepX))
      sx0 = Math.min(Math.max(sx0, 0), sw - 1)
      sx1 = Math.min(sx1, sw)

      let a = 0
      let r = 0
      let g = 0
      let b = 0
      let n = 0
      for (let yy = sy0; yy < sy1; yy++) {
        for (let xx = sx0; xx < sx1; xx++) {
          const p = src[yy * sw + xx]!
          const pa = (p >>> 24) & 0xff
          a += pa
          r += ((p >> 16) & 0xff) * pa
          g += ((p >> 8) & 0xff) * pa
          b += (p & 0xff) * pa
          n++
        }
      }
      let colour: number
      if (n === 0 || a === 0) {
        colour = background
      } else {
        // Average the covered pixels (alpha-weighted), then lay that over the background by the
        // average alpha - so a half-transparent edge blends.
        const alpha = f(f(a) / f(255 * n))
        const inv = f(1 - alpha)
        const cr = Math.floor(r / a)
        const cg = Math.floor(g / a)
        const cb = Math.floor(b / a)
        colour =
          (0xff000000 |
            (roundF(f(f(cr * alpha) + f(br * inv))) << 16) |
            (roundF(f(f(cg * alpha) + f(bgc * inv))) << 8) |
            roundF(f(f(cb * alpha) + f(bb * inv)))) |
          0
      }
      out[(y + ty) * w + x + tx] = light >= 1 ? colour : shade(colour, light)
    }
  }
}

/** The picture's average colour over its visible pixels, opaque; mid grey if it has none. */
export function average(src: Int32Array): number {
  let a = 0
  let r = 0
  let g = 0
  let b = 0
  for (const p of src) {
    const pa = (p >>> 24) & 0xff
    a += pa
    r += ((p >> 16) & 0xff) * pa
    g += ((p >> 8) & 0xff) * pa
    b += (p & 0xff) * pa
  }
  if (a === 0) return 0xff808080 | 0
  return (0xff000000 | (Math.floor(r / a) << 16) | (Math.floor(g / a) << 8) | Math.floor(b / a)) | 0
}

export function shade(argb: number, factor: number): number {
  const r = roundF(f(((argb >> 16) & 0xff) * factor))
  const g = roundF(f(((argb >> 8) & 0xff) * factor))
  const b = roundF(f((argb & 0xff) * factor))
  return ((argb & 0xff000000) | (r << 16) | (g << 8) | b) | 0
}

/* ------------------------------------------------------------------ browser side */

/** RGBA ImageData bytes -> packed ARGB. */
export function toArgb(rgba: Uint8ClampedArray): Int32Array {
  const out = new Int32Array(rgba.length / 4)
  for (let i = 0; i < out.length; i++) {
    const o = i * 4
    out[i] = ((rgba[o + 3]! << 24) | (rgba[o]! << 16) | (rgba[o + 1]! << 8) | rgba[o + 2]!) | 0
  }
  return out
}

/** Packed ARGB -> RGBA ImageData bytes. */
export function toRgba(argb: Int32Array): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(argb.length * 4)
  for (let i = 0; i < argb.length; i++) {
    const p = argb[i]!
    const o = i * 4
    out[o] = (p >> 16) & 0xff
    out[o + 1] = (p >> 8) & 0xff
    out[o + 2] = p & 0xff
    out[o + 3] = (p >>> 24) & 0xff
  }
  return out
}

export interface CapeFrame {
  canvas: HTMLCanvasElement
  /** How long this frame shows, for an animated cape. */
  delayMs: number
}

function pixelsOf(source: CanvasImageSource, w: number, h: number): Int32Array {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(source, 0, 0, w, h)
  return toArgb(ctx.getImageData(0, 0, w, h).data)
}

function textureCanvas(src: Int32Array, w: number, h: number, scale: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width(scale)
  canvas.height = height(scale)
  canvas.getContext('2d')!.putImageData(new ImageData(toRgba(compose(src, w, h, scale)), canvas.width, canvas.height), 0, 0)
  return canvas
}

/** The mod plays up to this many frames of a GIF cape. */
const MAX_FRAMES = 64

type DecodedFrame = { image: CanvasImageSource & { displayWidth: number; displayHeight: number; duration: number | null; close: () => void } }
type Decoder = {
  tracks: { ready: Promise<void>; selectedTrack: { frameCount: number } | null }
  decode: (o: { frameIndex: number }) => Promise<DecodedFrame>
  close: () => void
}

/**
 * A cape picture (its URL, or a picked file) built into texture(s): one for a still, one per frame
 * for a GIF (decoded with the browser's ImageDecoder; without it, a GIF shows its first frame).
 */
export async function loadCapeFrames(source: string | Blob): Promise<CapeFrame[]> {
  let blob: Blob
  if (typeof source === 'string') {
    const res = await fetch(source)
    if (!res.ok) throw new Error(`download failed, ${res.status}`)
    blob = await res.blob()
  } else blob = source
  const isGif = blob.type === 'image/gif' || (typeof source === 'string' && /\.gif($|\?)/i.test(source))

  const ImageDecoderCtor = (window as unknown as { ImageDecoder?: new (init: { data: ReadableStream | ArrayBuffer; type: string }) => Decoder }).ImageDecoder
  if (isGif && ImageDecoderCtor) {
    const decoder = new ImageDecoderCtor({ data: await blob.arrayBuffer(), type: 'image/gif' })
    try {
      await decoder.tracks.ready
      const count = Math.min(decoder.tracks.selectedTrack?.frameCount ?? 1, MAX_FRAMES)
      const frames: CapeFrame[] = []
      for (let i = 0; i < count; i++) {
        const { image } = await decoder.decode({ frameIndex: i })
        const w = image.displayWidth
        const h = image.displayHeight
        const scale = scaleFor(w, h, count > 1)
        frames.push({ canvas: textureCanvas(pixelsOf(image, w, h), w, h, scale), delayMs: Math.max(20, (image.duration ?? 100_000) / 1000) })
        image.close()
      }
      if (frames.length) return frames
    } finally {
      decoder.close()
    }
  }

  const bitmap = await createImageBitmap(blob)
  try {
    const scale = scaleFor(bitmap.width, bitmap.height, false)
    return [{ canvas: textureCanvas(pixelsOf(bitmap, bitmap.width, bitmap.height), bitmap.width, bitmap.height, scale), delayMs: 0 }]
  } finally {
    bitmap.close()
  }
}
