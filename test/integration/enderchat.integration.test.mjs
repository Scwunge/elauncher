/**
 * EnderChat end to end: the launcher's own EnderNet client and live socket against a real
 * enderphone-api running locally, with a stand-in for Mojang's session server (the API reads
 * MOJANG_SESSION_SERVER, and so does the launcher) so the real sign-in handshake runs too.
 *
 * Alice is the launcher. Bob is "the phone": raw HTTP + WebSocket with his own token, the way the
 * mod talks to the API. Every message crosses between the two for real.
 *
 * Run: ENDERPHONE_API_DIR=/path/to/enderphone-api npm run test:integration
 * (skipped when that isn't set - it needs the API checked out, with `npm ci` run in it).
 */
import { after, before, describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import WebSocket from 'ws'

const API_DIR = process.env.ENDERPHONE_API_DIR
const skip = !API_DIR || !fs.existsSync(path.join(API_DIR, 'server.mjs'))

/* ------------------------------------------------------------------ a stand-in Mojang */

const joined = new Map() // serverId -> { id, name }
const accounts = {
  alice: { id: crypto.randomUUID().replace(/-/g, ''), name: 'AliceE', accessToken: 'mc-token-alice' },
  bob: { id: crypto.randomUUID().replace(/-/g, ''), name: 'BobPhone', accessToken: 'mc-token-bob' },
}
const dashed = (id) => id.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5')

function fakeMojang() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x')
    if (req.method === 'POST' && url.pathname === '/session/minecraft/join') {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        const { accessToken, selectedProfile, serverId } = JSON.parse(body)
        const who = Object.values(accounts).find((a) => a.accessToken === accessToken && a.id === selectedProfile)
        if (!who) {
          res.writeHead(403)
          return res.end()
        }
        joined.set(serverId, who)
        res.writeHead(204)
        res.end()
      })
      return
    }
    if (req.method === 'GET' && url.pathname === '/session/minecraft/hasJoined') {
      const who = joined.get(url.searchParams.get('serverId'))
      if (!who || who.name !== url.searchParams.get('username')) {
        res.writeHead(204)
        return res.end()
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ id: who.id, name: who.name }))
    }
    res.writeHead(404)
    res.end()
  })
}

/* ------------------------------------------------------------------ helpers */

function freePort() {
  return new Promise((resolve) => {
    const s = http.createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => resolve(port))
    })
  })
}

function waitFor(pred, ms = 5000, what = 'condition') {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const tick = async () => {
      if (await pred()) return resolve()
      if (Date.now() - start > ms) return reject(new Error(`timed out waiting for ${what}`))
      setTimeout(tick, 25)
    }
    tick()
  })
}

/** A tiny valid PNG (1x1), to send as a chat photo. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

/* ------------------------------------------------------------------ the stack */

let mojang
let apiProc
let apiBase
let enderphoneApi
let realtimeMod
let bob // { token, uuid, ws, events }
const store = { settings: {}, session: undefined }

before(async () => {
  if (skip) return
  mojang = fakeMojang()
  await new Promise((r) => mojang.listen(0, '127.0.0.1', r))
  const mojangUrl = `http://127.0.0.1:${mojang.address().port}`

  const port = await freePort()
  apiBase = `http://127.0.0.1:${port}`
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elauncher-api-'))
  apiProc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.mjs'], {
    cwd: API_DIR,
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: dataDir,
      DOWNLOADS_DIR: path.join(dataDir, 'downloads'),
      SESSION_SECRET: 'integration-secret',
      ADMIN_TOKEN: 'integration-admin',
      PUBLIC_BASE: apiBase,
      MOJANG_SESSION_SERVER: mojangUrl,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = ''
  apiProc.stdout.on('data', (d) => (log += d))
  apiProc.stderr.on('data', (d) => (log += d))
  await waitFor(async () => {
    try {
      return (await fetch(`${apiBase}/health`)).ok
    } catch {
      return false
    }
  }, 15000, `the API to start\n${log}`)

  // The launcher modules read these at import time.
  process.env.ENDERPHONE_API_BASE = apiBase
  process.env.MOJANG_SESSION_SERVER = mojangUrl
  mock.module('../../src/main/store.js', {
    namedExports: {
      getEnderPhoneSession: () => store.session,
      setEnderPhoneSession: (s) => (store.session = s),
    },
  })
  const aliceMc = { accessToken: accounts.alice.accessToken, profile: { id: accounts.alice.id, name: accounts.alice.name } }
  mock.module('../../src/main/auth.js', {
    namedExports: { getCachedSession: () => aliceMc, trySilentSignIn: async () => aliceMc },
  })
  enderphoneApi = await import('../../src/main/enderphone-api.js')
  realtimeMod = await import('../../src/main/enderchat.js')

  // Bob signs in the way the phone does, by hand.
  const { serverId } = await (await fetch(`${apiBase}/v1/auth/start`, { method: 'POST' })).json()
  await fetch(`${mojangUrl}/session/minecraft/join`, {
    method: 'POST',
    body: JSON.stringify({ accessToken: accounts.bob.accessToken, selectedProfile: accounts.bob.id, serverId }),
  })
  const verified = await (
    await fetch(`${apiBase}/v1/auth/verify`, { method: 'POST', body: JSON.stringify({ username: accounts.bob.name, serverId }) })
  ).json()
  bob = { token: verified.token, uuid: verified.profile.uuid, events: [] }
  bob.ws = new WebSocket(`${apiBase.replace('http', 'ws')}/v1/ws`, { headers: { authorization: `Bearer ${bob.token}` } })
  bob.ws.on('message', (d, bin) => !bin && bob.events.push(JSON.parse(d.toString())))
  await new Promise((r, j) => {
    bob.ws.once('open', r)
    bob.ws.once('error', j)
  })
})

after(() => {
  bob?.ws?.close()
  apiProc?.kill()
  mojang?.close()
})

const bobCall = (p, init = {}) =>
  fetch(`${apiBase}${p}`, { ...init, headers: { authorization: `Bearer ${bob.token}`, 'content-type': 'application/json', ...init.headers } }).then(async (r) => {
    const body = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(`${r.status} ${body.error}`)
    return body
  })

describe('EnderChat against a real API', { skip: skip && 'set ENDERPHONE_API_DIR to run' }, () => {
  let aliceUuid
  let rt
  const aliceEvents = []

  it('signs the launcher in with the Mojang handshake', async () => {
    const r = await enderphoneApi.connect()
    assert.equal(r.status, 'connected', r.message)
    assert.equal(r.name, accounts.alice.name)
    assert.equal(r.uuid, dashed(accounts.alice.id))
    aliceUuid = r.uuid
    assert.equal(enderphoneApi.sessionSummary().connected, true)
  })

  it('opens the live socket, and Alice shows as online', async () => {
    rt = realtimeMod.createRealtime({
      url: realtimeMod.realtimeUrl(apiBase),
      getToken: enderphoneApi.token,
      onEvent: (e) => aliceEvents.push(e),
    })
    rt.start()
    await waitFor(() => rt.state === 'live', 5000, 'live')
    const { players } = await bobCall(`/v1/players?q=${accounts.alice.name.slice(0, 4)}`)
    assert.equal(players.find((p) => p.uuid === aliceUuid)?.online, true)
  })

  it('lists conversations, with everyone in EnderCloud', async () => {
    const { conversations } = await enderphoneApi.api.conversations()
    const cloud = conversations.find((c) => c.system)
    assert.ok(cloud, 'EnderCloud is there')
    assert.equal(cloud.kind, 'group')
  })

  it('a message from the phone arrives live in the launcher', async () => {
    await bobCall(`/v1/messages/${aliceUuid}`, { method: 'POST', body: JSON.stringify({ body: 'hi from in-game' }) })
    await waitFor(() => aliceEvents.some((e) => e.type === 'message' && e.message.body === 'hi from in-game'), 5000, 'the live message')
    const { conversations } = await enderphoneApi.api.conversations()
    const dm = conversations.find((c) => c.kind === 'dm')
    assert.equal(dm.unread, 1)
    assert.equal(dm.lastBody, 'hi from in-game')
  })

  it('a reply from the launcher arrives live on the phone, and read clears unread', async () => {
    const { conversations } = await enderphoneApi.api.conversations()
    const dm = conversations.find((c) => c.kind === 'dm')
    const sent = await enderphoneApi.api.send(dm.id, 'hey from E-Launcher')
    assert.equal(sent.body, 'hey from E-Launcher')
    await waitFor(() => bob.events.some((e) => e.type === 'message' && e.message.body === 'hey from E-Launcher'), 5000, 'Bob to get it')
    await enderphoneApi.api.markRead(dm.id)
    const after = (await enderphoneApi.api.conversations()).conversations.find((c) => c.id === dm.id)
    assert.equal(after.unread, 0)
    const { messages } = await enderphoneApi.api.messages(dm.id)
    assert.deepEqual(messages.map((m) => m.body), ['hi from in-game', 'hey from E-Launcher'])
  })

  it('sends a photo, kept out of the public feed', async () => {
    const photo = await enderphoneApi.api.uploadChatPhoto(PNG)
    assert.equal(photo.public, false)
    const { conversations } = await enderphoneApi.api.conversations()
    const dm = conversations.find((c) => c.kind === 'dm')
    const sent = await enderphoneApi.api.send(dm.id, '', photo.id)
    assert.ok(sent.photoUrl?.endsWith('.png'))
    await waitFor(() => bob.events.some((e) => e.type === 'message' && e.message.photoId === photo.id), 5000, 'the photo message')
  })

  it('makes a group; Bob hears about it and can talk in it', async () => {
    const group = await enderphoneApi.api.createGroup('Base builders', [accounts.bob.name])
    assert.equal(group.kind, 'group')
    assert.deepEqual(group.members.map((m) => m.name).sort(), [accounts.alice.name, accounts.bob.name].sort())
    await waitFor(() => bob.events.some((e) => e.type === 'conversation' && e.conversation.id === group.id), 5000, 'the group event')

    await bobCall(`/v1/conversations/${group.id}/messages`, { method: 'POST', body: JSON.stringify({ body: 'on my way' }) })
    await waitFor(() => aliceEvents.some((e) => e.type === 'message' && e.message.conversationId === group.id), 5000, 'the group message')

    await enderphoneApi.api.rename(group.id, 'Sky base')
    const renamed = (await enderphoneApi.api.conversations()).conversations.find((c) => c.id === group.id)
    assert.equal(renamed.name, 'Sky base')

    await enderphoneApi.api.removeMember(group.id, bob.uuid)
    const smaller = (await enderphoneApi.api.conversations()).conversations.find((c) => c.id === group.id)
    assert.deepEqual(smaller.members.map((m) => m.uuid), [aliceUuid])

    await enderphoneApi.api.addMember(group.id, accounts.bob.name)
    await enderphoneApi.api.leave(group.id)
    const gone = (await enderphoneApi.api.conversations()).conversations.find((c) => c.id === group.id)
    assert.equal(gone, undefined, 'left the group')
  })

  it('reports and blocks - and a blocked player can no longer message you', async () => {
    const r = await enderphoneApi.api.report(bob.uuid, 'spam')
    assert.equal(r.reported, true)
    await enderphoneApi.api.block(bob.uuid)
    await assert.rejects(
      bobCall(`/v1/messages/${aliceUuid}`, { method: 'POST', body: JSON.stringify({ body: 'still there?' }) }),
      /403/,
    )
  })

  it('stops cleanly', async () => {
    rt.stop()
    assert.equal(rt.state, 'off')
    await waitFor(async () => {
      const { players } = await bobCall(`/v1/players?q=${accounts.alice.name.slice(0, 4)}`)
      return players.every((p) => p.uuid !== aliceUuid || !p.online)
    }, 5000, 'Alice to show offline')
  })
})
