import { useEffect, useRef, useState } from 'react'
import { parseClip } from '../chat-model'
import Icon from './Icon'

const MAX_BYTES = 7.5 * 1024 * 1024 // under the API's 8MB, with room for base64 rounding

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the image.'))), 'image/png'))
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

/**
 * Any image (a pasted screenshot, a JPEG, a WebP) as a PNG the API will take: the API only accepts
 * PNG, so the conversion happens here. Big images are scaled down until they fit under 8MB.
 */
export async function toPngBase64(file: Blob): Promise<string> {
  const bitmap = await createImageBitmap(file)
  let scale = Math.min(1, 2560 / Math.max(bitmap.width, bitmap.height))
  for (let attempt = 0; attempt < 5; attempt++) {
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const png = await canvasToPng(canvas)
    if (png.size <= MAX_BYTES) {
      bitmap.close()
      return blobToBase64(png)
    }
    scale *= 0.7
  }
  bitmap.close()
  throw new Error('That image is too big to send, even scaled down.')
}

/**
 * A phone clip in a message. Clips are the phone's own CPV1 container (JPEG frames with
 * timestamps), which no browser plays, so this decodes it onto a canvas - the same approach as the
 * EnderChat page. Downloaded only when clicked.
 */
export function ClipPlayer({ url }: { url: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'playing' | 'error'>('idle')
  const clipRef = useRef<{ buf: ArrayBuffer; clip: ReturnType<typeof parseClip> }>()
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const playing = useRef(false)

  useEffect(
    () => () => {
      playing.current = false
      clearTimeout(timer.current)
    },
    [],
  )

  async function playFrom(idx: number) {
    const loaded = clipRef.current
    const canvas = canvasRef.current
    if (!loaded || !canvas || !playing.current) return
    const { buf, clip } = loaded
    if (idx >= clip.frames.length) {
      playing.current = false
      setState('idle')
      return
    }
    const f = clip.frames[idx]!
    try {
      const bmp = await createImageBitmap(new Blob([new Uint8Array(buf, f.start, f.length)], { type: 'image/jpeg' }))
      canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
      bmp.close()
    } catch {
      // A bad frame is skipped, not fatal.
    }
    const next = clip.frames[idx + 1]
    timer.current = setTimeout(() => playFrom(idx + 1), next ? Math.max(0, next.ts - f.ts) : 0)
  }

  async function toggle() {
    if (playing.current) {
      playing.current = false
      clearTimeout(timer.current)
      setState('idle')
      return
    }
    if (!clipRef.current) {
      setState('loading')
      try {
        const res = await fetch(url)
        if (!res.ok) throw new Error()
        const buf = await res.arrayBuffer()
        const clip = parseClip(buf)
        clipRef.current = { buf, clip }
        if (canvasRef.current) {
          canvasRef.current.width = clip.width
          canvasRef.current.height = clip.height
        }
      } catch {
        setState('error')
        return
      }
    }
    playing.current = true
    setState('playing')
    void playFrom(0)
  }

  return (
    <button className={`chat-clip ${state}`} onClick={toggle} disabled={state === 'error'}>
      <canvas ref={canvasRef} width={320} height={180} />
      {state !== 'playing' && (
        <span className="chat-clip-overlay">
          {state === 'loading' ? <span className="spinner" /> : state === 'error' ? 'Clip unavailable' : <Icon name="play" size={26} />}
        </span>
      )}
      <span className="chat-clip-tag">Clip</span>
    </button>
  )
}
