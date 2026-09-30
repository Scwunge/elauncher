/**
 * Client for the EnderPhone API (api.enderphone.cloud - the `enderphone-api` repo).
 *
 * Signing in works exactly the way the phone mod does it, so the API needs nothing new for it and
 * never sees a Minecraft access token:
 *
 *   1. POST /v1/auth/start          -> { serverId }
 *   2. Mojang sessionserver /join   (from here, with the player's own Minecraft session - the same
 *                                     call the game makes when it joins a server)
 *   3. POST /v1/auth/verify         -> the API asks Mojang's hasJoined, then mints its own token
 *
 * An official player who set an EnderPhone password is asked for it at step 3
 * (`password-required`); the UI prompts and the whole handshake runs again with it, since a
 * serverId is single-use. The password is never stored - only the token the API hands back, which
 * lasts 12 hours on the API side.
 */
import { getCachedSession, trySilentSignIn } from './auth.js'
import { getEnderPhoneSession, setEnderPhoneSession } from './store.js'
import { downloadCape } from './cape-download.js'
import { listOfficialCapes } from './official-capes.js'

export const API_BASE = (process.env.ENDERPHONE_API_BASE || 'https://api.enderphone.cloud').replace(/\/+$/, '')
// Overridable only so the integration tests can stand in for Mojang (the API reads the same name).
const SESSION_SERVER = (process.env.MOJANG_SESSION_SERVER || 'https://sessionserver.mojang.com').replace(/\/+$/, '')
const USER_AGENT = 'E-Launcher/0.1 (+https://enderphone.cloud)'
const FETCH_TIMEOUT_MS = 10_000
/** The API's tokens last 12h; stop trusting ours an hour early rather than fail mid-request. */
const TOKEN_TRUST_MS = 11 * 60 * 60 * 1000

export class EnderPhoneAuthError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

async function timedFetch(url, init = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), init.timeoutMs ?? FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, {
      ...init,
      headers: { 'User-Agent': USER_AGENT, ...init.headers },
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
}

async function readError(res) {
  const body = await res.json().catch(() => ({}))
  return { message: body.error || `${res.status} ${res.statusText}`, code: body.code }
}

/** A public, unauthenticated GET. Throws on a non-2xx. */
export async function publicGet(path) {
  const res = await timedFetch(`${API_BASE}${path}`)
  if (!res.ok) throw new Error((await readError(res)).message)
  return res.json()
}

/* ------------------------------------------------------------------------------ session */

function sessionMatches(saved, mc) {
  return saved && mc && saved.mcId === mc.profile.id && saved.expiresAt > Date.now()
}

/** What the renderer is allowed to know: who, and whether - never the token itself. */
export function sessionSummary() {
  const saved = getEnderPhoneSession()
  const mc = getCachedSession()
  if (!sessionMatches(saved, mc)) return { connected: false }
  return { connected: true, uuid: saved.uuid, name: saved.name, kind: saved.kind, needs: saved.needs ?? [] }
}

export function disconnect() {
  setEnderPhoneSession(undefined)
}

/**
 * Runs the handshake. `password` only matters for an account that has one set.
 * @returns {Promise<{status: 'connected', uuid, name, kind, needs} | {status: 'password-required'|'wrong-password'|'error', message}>}
 */
export async function connect(password) {
  const mc = getCachedSession() ?? (await trySilentSignIn())
  if (!mc) return { status: 'error', message: 'Sign in to Minecraft first.' }
  try {
    const startRes = await timedFetch(`${API_BASE}/v1/auth/start`, { method: 'POST' })
    if (!startRes.ok) return { status: 'error', message: (await readError(startRes)).message }
    const { serverId } = await startRes.json()

    const joinRes = await timedFetch(`${SESSION_SERVER}/session/minecraft/join`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accessToken: mc.accessToken, selectedProfile: mc.profile.id.replace(/-/g, ''), serverId }),
    })
    if (joinRes.status !== 204 && !joinRes.ok) {
      return {
        status: 'error',
        message: `Mojang refused the sign-in handshake (${joinRes.status}). Signing out of Minecraft and back in usually fixes this.`,
      }
    }

    const verifyRes = await timedFetch(`${API_BASE}/v1/auth/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: mc.profile.name, serverId, ...(password ? { password } : {}) }),
    })
    if (!verifyRes.ok) {
      const { message, code } = await readError(verifyRes)
      if (code === 'password-required' || code === 'wrong-password') return { status: code, message }
      return { status: 'error', message }
    }
    const body = await verifyRes.json()
    const session = {
      token: body.token,
      uuid: body.profile.uuid,
      name: body.profile.name,
      kind: body.kind ?? 'official',
      needs: body.needs ?? [],
      mcId: mc.profile.id,
      expiresAt: Date.now() + TOKEN_TRUST_MS,
    }
    setEnderPhoneSession(session)
    // ender.bio shows every official cape the account owns; tell EnderNet which (in the background).
    void reportOwnedCapes(mc.accessToken)
    return { status: 'connected', uuid: session.uuid, name: session.name, kind: session.kind, needs: session.needs }
  } catch (err) {
    return { status: 'error', message: err.name === 'AbortError' ? 'EnderNet did not answer in time.' : err.message }
  }
}

/** A token for an authed call, connecting silently if we can. Throws EnderPhoneAuthError if not.
 *  Exported for the realtime socket (enderchat.js), which sends it once at the handshake. */
export async function token() {
  const saved = getEnderPhoneSession()
  const mc = getCachedSession() ?? (await trySilentSignIn())
  if (sessionMatches(saved, mc)) return saved.token
  const result = await connect()
  if (result.status === 'connected') return getEnderPhoneSession().token
  throw new EnderPhoneAuthError(result.status, result.message)
}

/**
 * An authenticated request. A 401 on a token we thought was good (the API restarted with a new
 * secret, or the account was merged) drops it and retries once with a fresh handshake.
 */
export async function authed(path, init = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await timedFetch(`${API_BASE}${path}`, {
      ...init,
      headers: { ...init.headers, authorization: `Bearer ${await token()}` },
    })
    if (res.status === 401 && attempt === 0) {
      setEnderPhoneSession(undefined)
      continue
    }
    if (!res.ok) throw new Error((await readError(res)).message)
    return res.status === 204 ? {} : res.json()
  }
  throw new EnderPhoneAuthError('error', 'EnderNet did not accept the sign-in.')
}

/**
 * Tells EnderNet which official Minecraft capes this account owns, so the player's ender.bio page
 * can show them all (Mojang only makes the equipped one public). Texture ids and names only - the
 * Minecraft token stays here. `capes` is a list official-capes.js already fetched, else it's asked
 * for. Best effort: only while connected to EnderNet, and it never throws.
 */
export async function reportOwnedCapes(accessToken, capes) {
  try {
    if (!sessionSummary().connected) return
    const list = capes ?? (await listOfficialCapes(accessToken))
    await authed('/v1/me/mojang-capes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ capes: list.map(({ texture, name, active }) => ({ texture, name, active })) }),
    })
  } catch {
    // Not connected, Mojang or EnderNet unreachable: the next connect or Wardrobe visit tries again.
  }
}

/** For an embedded /app/<page>: the page reads the session from the URL fragment (never sent to
 *  a server), the same hand-over the phone's browser does. */
export async function appPageUrl(page) {
  if (!/^[a-z0-9-]{1,32}$/.test(page)) throw new Error('Bad page name.')
  let fragment = ''
  try {
    fragment = `#t=${encodeURIComponent(await token())}`
  } catch {
    // Not connected: the page still opens and shows its own signed-out state.
  }
  return `${API_BASE}/app/${page}${fragment}`
}

/* ------------------------------------------------------------------------------ calls */

export const api = {
  status: () => publicGet('/v1/public/status'),
  servers: ({ q = '', tag = '', sort = 'votes' } = {}) =>
    publicGet(`/v1/endportal/servers?${new URLSearchParams({ q, tag, sort })}`),
  sites: () => publicGet('/v1/sites'),
  releases: () => publicGet('/v1/launcher/releases'),

  account: () => authed('/v1/account'),
  friends: () => authed('/v1/friends'),
  notifications: () => authed('/v1/notifications'),
  unread: () => authed('/v1/unread'),
  radio: () => authed('/v1/radio'),
  follow: (uuid) => authed(`/v1/follows/${encodeURIComponent(uuid)}`, { method: 'POST' }),
  decline: (uuid) => authed(`/v1/friends/requests/${encodeURIComponent(uuid)}`, { method: 'DELETE' }),
  searchPlayers: (q) => authed(`/v1/players?${new URLSearchParams({ q })}`),
  cape: () => authed('/v1/cape'),
  setCape: (bytes) =>
    authed('/v1/cape', { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: bytes }),
  clearCape: () => authed('/v1/cape', { method: 'DELETE' }),
  /** The cape picture itself, fetched here rather than in the page - see cape-download.js. */
  capeImage: (url) => downloadCape(url, API_BASE),

  /* EnderChat: the conversation list, for the unread badge and naming notifications. */
  conversations: () => authed('/v1/conversations'),
}
