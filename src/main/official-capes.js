/**
 * The official Minecraft capes on the signed-in account: which ones it owns, which one it wears,
 * and switching between them - what the official launcher's "Capes" page does.
 *
 * All of it is Mojang's own profile API, called with the account's Minecraft access token, which
 * this process already holds for launching the game (auth.js). The token only ever goes to Mojang.
 *
 * The owned list is also what ender.bio shows on a player's page. The site can't see it itself -
 * Mojang only makes the equipped cape public - so enderphone-api.js reports it to EnderNet
 * (/v1/me/mojang-capes: texture ids and names only, never the token), the same report the
 * EnderPhone mod makes after signing in.
 */
const PROFILE_API = 'https://api.minecraftservices.com/minecraft/profile'
const TEXTURE_URL = /^https?:\/\/textures\.minecraft\.net\/texture\/([0-9a-f]{40,64})$/
const CAPE_ID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i
const TIMEOUT_MS = 15_000
/** A cape texture is a small PNG (64x32, a few KB); far past that isn't one. */
const MAX_TEXTURE_BYTES = 256 * 1024

async function timed(url, init, fetchImpl) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

/** Mojang's profile's `capes`, as [{id, name, texture, active}] - capes whose address isn't a texture are left out. */
export function parseCapes(profile) {
  const out = []
  for (const c of Array.isArray(profile?.capes) ? profile.capes : []) {
    const texture = String(c?.url ?? '').match(TEXTURE_URL)?.[1]
    if (!texture || typeof c?.id !== 'string') continue
    out.push({ id: c.id, name: String(c.alias ?? 'Cape').slice(0, 40), texture, active: c.state === 'ACTIVE' })
  }
  return out
}

/** Every official cape the account owns, the one it wears marked `active`. */
export async function listOfficialCapes(accessToken, fetchImpl = fetch) {
  const res = await timed(PROFILE_API, { headers: { Authorization: `Bearer ${accessToken}` } }, fetchImpl)
  if (!res.ok) throw new Error(`Mojang didn't return your capes (${res.status}). Try again in a moment.`)
  return parseCapes(await res.json())
}

/**
 * Wears the cape with this id, or none (`null`), on the account - seen by every player in game.
 * @returns the list afterwards, as Mojang now has it
 */
export async function setActiveCape(accessToken, capeId, fetchImpl = fetch) {
  if (capeId !== null && !CAPE_ID.test(String(capeId))) throw new Error('That is not a cape on this account.')
  const res = capeId === null
    ? await timed(`${PROFILE_API}/capes/active`, { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } }, fetchImpl)
    : await timed(`${PROFILE_API}/capes/active`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ capeId }),
    }, fetchImpl)
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Mojang didn't change your cape (${res.status})${detail ? `: ${detail.slice(0, 200)}` : '.'}`)
  }
  // Both calls answer with the updated profile; read it rather than ask again.
  const body = await res.json().catch(() => null)
  return body ? parseCapes(body) : listOfficialCapes(accessToken, fetchImpl)
}

/**
 * A cape's texture, for the Wardrobe's 3D preview: fetched here because the page's CSP and CORS
 * would stop it doing so itself (see cape-download.js for the same reasoning). Only Mojang's
 * texture CDN, by texture id - never an address the renderer makes up.
 * @returns {{base64: string, type: 'image/png'}}
 */
export async function downloadCapeTexture(texture, fetchImpl = fetch) {
  if (!/^[0-9a-f]{40,64}$/.test(String(texture))) throw new Error('That is not a cape texture.')
  const res = await timed(`https://textures.minecraft.net/texture/${texture}`, {}, fetchImpl)
  if (!res.ok) throw new Error(`the texture didn't download (${res.status})`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > MAX_TEXTURE_BYTES || buf.subarray(0, 4).toString('hex') !== '89504e47') throw new Error('that is not a cape texture')
  return { base64: buf.toString('base64'), type: 'image/png' }
}
