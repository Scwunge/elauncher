/**
 * Downloading an EnderPhone cape picture for the Wardrobe preview.
 *
 * <h2>Why here, in the main process</h2>
 * On the live site `/cdn/*` is served by Caddy straight from disk, and that response carries no
 * `Access-Control-Allow-Origin`. The renderer is a web page, so a `fetch()` of the cape URL from it
 * is a cross-origin request the browser refuses - and the preview came up with no cape, whatever
 * you had set. Node's fetch has no such rule, so the picture is fetched here and handed over as
 * bytes. (Locally it worked, because there the API itself serves `/cdn` and does send the header.)
 *
 * <h2>Only our own cape files</h2>
 * The URL comes from the API's reply, but it still crosses from the renderer, so only the API's own
 * cape paths are fetched: same origin as the API, `/cdn/capes/<2 hex>/<sha256>.png|gif`, no query.
 */
const CAPE_PATH = /^\/cdn\/capes\/[0-9a-f]{2}\/[0-9a-f]{64}\.(png|gif)$/

/** The server allows 2MB; a little room over that, and never an unbounded read. */
export const MAX_CAPE_DOWNLOAD = 4 * 1024 * 1024

export function isCapeUrl(url, apiBase) {
  try {
    const u = new URL(url)
    return u.origin === new URL(apiBase).origin && CAPE_PATH.test(u.pathname) && !u.search && !u.hash
  } catch {
    return false
  }
}

/** @returns {{ base64: string, type: string }} */
export async function downloadCape(url, apiBase, fetchImpl = fetch) {
  if (!isCapeUrl(url, apiBase)) throw new Error('That is not an EnderPhone cape address.')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20_000)
  try {
    const res = await fetchImpl(url, { signal: controller.signal })
    if (!res.ok) throw new Error(`download failed, ${res.status}`)
    const declared = Number(res.headers.get('content-length') || 0)
    if (declared > MAX_CAPE_DOWNLOAD) throw new Error('the cape file is too large')
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > MAX_CAPE_DOWNLOAD) throw new Error('the cape file is too large')
    return { base64: buf.toString('base64'), type: url.endsWith('.gif') ? 'image/gif' : 'image/png' }
  } finally {
    clearTimeout(timeout)
  }
}
