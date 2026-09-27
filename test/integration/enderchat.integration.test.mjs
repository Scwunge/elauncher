/**
 * EnderChat end to end: the launcher's own EnderNet client and live socket against a real
 * enderphone-api running locally, with a stand-in for Mojang's session server (the API reads
 * MOJANG_SESSION_SERVER, and so does the launcher) so the real sign-in handshake runs too - and
 * the EnderChat page itself, in Chromium, opened the way the launcher's tab opens it.
 *
 * Alice is the launcher. Bob is "the phone": raw HTTP + WebSocket with his own token, the way the
 * mod talks to the API.
 *
 * Run: ENDERPHONE_API_DIR=/path/to/enderphone-api npm run test:integration
 * (skipped when that isn't set - it needs the API checked out, with `npm ci` run in it). The page
 * checks also need Playwright's Chromium (CHROMIUM_PATH, or a `playwright` install); without it
 * they're skipped and the rest still runs.
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
  carol: { id: crypto.randomUUID().replace(/-/g, ''), name: 'CarolNew', accessToken: 'mc-token-carol' },
}

/** Chromium for the page checks: `playwright` if it can be found (or PLAYWRIGHT_MODULE points at it). */
let chromium
try {
  ;({ chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright'))
} catch {
  chromium = undefined
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

/* ------------------------------------------------------------------ the stack */

let mojang
let apiProc
let apiBase
let enderphoneApi
let realtimeMod
let bob // { token, uuid, ws, events }
let signInAs // (who) => { token, uuid }, the phone's sign-in by hand
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
  signInAs = async (who) => {
    const { serverId } = await (await fetch(`${apiBase}/v1/auth/start`, { method: 'POST' })).json()
    await fetch(`${mojangUrl}/session/minecraft/join`, {
      method: 'POST',
      body: JSON.stringify({ accessToken: accounts[who].accessToken, selectedProfile: accounts[who].id, serverId }),
    })
    const verified = await (
      await fetch(`${apiBase}/v1/auth/verify`, { method: 'POST', body: JSON.stringify({ username: accounts[who].name, serverId }) })
    ).json()
    return { token: verified.token, uuid: verified.profile.uuid }
  }
  bob = { ...(await signInAs('bob')), events: [] }
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

  /* ---------------------------------------------------------- the EnderChat page, as the tab loads it */

  describe('the EnderChat page', { skip: !chromium && 'no Chromium (set CHROMIUM_PATH / install playwright)' }, () => {
    let browser
    let page
    before(async () => {
      browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
      page = await browser.newPage()
    })
    after(() => browser?.close())

    const head = () => page.locator('.chat-head h1').first().textContent({ timeout: 5000 })

    it('opens signed in, straight to the chat asked for (c=)', async () => {
      const { conversations } = await enderphoneApi.api.conversations()
      const dm = conversations.find((c) => c.kind === 'dm')
      const url = (await enderphoneApi.appPageUrl('enderchat')) + `&c=${dm.id}`
      await page.goto(url)
      assert.equal(await head(), accounts.bob.name)
      assert.equal(new URL(page.url()).hash, '', 'the token is wiped from the address bar')
    })

    it('switches chat when the launcher sets the hash, without reloading', async () => {
      await page.evaluate(() => (window.__sameDocument = true))
      const cloud = (await enderphoneApi.api.conversations()).conversations.find((c) => c.system)
      await page.evaluate((id) => (location.hash = `c=${id}`), cloud.id)
      await waitFor(async () => (await page.locator('.chat-head .topic').first().textContent()).includes(cloud.name), 5000, 'EnderCloud to open')
      assert.equal(await page.evaluate(() => window.__sameDocument), true, 'same page, not reloaded')
    })

    it('dm= opens your DM with a friend', async () => {
      await page.evaluate((uuid) => (location.hash = `dm=${uuid}`), bob.uuid)
      await waitFor(async () => (await head()) === accounts.bob.name, 5000, 'the DM with Bob')
    })

    it('dm= with someone new opens a draft DM, like New message does - nothing sent yet', async () => {
      const carol = await signInAs('carol')
      await page.evaluate((uuid) => (location.hash = `dm=${uuid}`), carol.uuid)
      await waitFor(async () => (await head()) === accounts.carol.name, 8000, 'the new DM with Carol')
      const theirs = await (await fetch(`${apiBase}/v1/conversations`, { headers: { authorization: `Bearer ${carol.token}` } })).json()
      assert.ok(!theirs.conversations.some((c) => c.kind === 'dm'), 'nothing reaches Carol until something is said')
    })

    it('recovers from an expired session when handed a fresh token', async () => {
      await page.goto(`${apiBase}/app/enderchat#t=not-a-real-token`)
      await waitFor(async () => (await page.locator('.nothing h2').first().textContent().catch(() => '')).includes('expired'), 5000, 'the expired notice')
      const t = /[#&]t=([^&]+)/.exec(await enderphoneApi.appPageUrl('enderchat'))[1]
      await page.evaluate((tok) => (location.hash = `t=${tok}`), t)
      await waitFor(async () => (await page.locator('.chat-head h1').count()) > 0, 8000, 'the page to come back')
    })
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
