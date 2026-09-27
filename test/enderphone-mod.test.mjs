/**
 * EnderPhone-in-an-instance: jar recognition, release picking, and the install/replace/checksum
 * rules, against a real local HTTP server and a real temp folder.
 *
 * Run: npm test   (node --test with module mocks - store/api/modrinth are Electron-side, so they're
 * swapped for small fakes; everything under test is the real enderphone-mod.js).
 */
import { after, before, describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

const feed = { releases: [] }
let cache = []
const modrinthCalls = []

mock.module('../src/main/store.js', {
  namedExports: { getReleaseCache: () => cache, setReleaseCache: (r) => (cache = r) },
})
mock.module('../src/main/enderphone-api.js', {
  namedExports: {
    api: {
      releases: async () => {
        if (feed.fail) throw new Error('offline')
        return { releases: feed.releases }
      },
    },
  },
})
mock.module('../src/main/modrinth.js', {
  namedExports: {
    installLatestModrinthProject: async (slug, root, filter) => {
      modrinthCalls.push({ slug, filter })
      fs.mkdirSync(path.join(root, 'mods'), { recursive: true })
      fs.writeFileSync(path.join(root, 'mods', `${slug}-0.1.jar`), 'x')
      return `${slug}-0.1.jar`
    },
  },
})

const ep = await import('../src/main/enderphone-mod.js')

/* ------------------------------------------------------------------ a tiny jar host */

const bodies = new Map()
let server
let base
before(async () => {
  server = http.createServer((req, res) => {
    const body = bodies.get(req.url)
    if (!body) {
      res.writeHead(404)
      return res.end()
    }
    res.writeHead(200, { 'content-length': body.length })
    res.end(body)
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`
})
after(() => server.close())

function release(file, body, extra = {}) {
  const parsed = ep.parseJarName(file)
  bodies.set(`/${file}`, Buffer.from(body))
  return {
    file,
    edition: parsed.edition,
    loader: parsed.loader,
    minecraft: parsed.minecraft,
    version: parsed.version,
    size: Buffer.byteLength(body),
    sha1: crypto.createHash('sha1').update(body).digest('hex'),
    url: `${base}/${file}`,
    latest: true,
    ...extra,
  }
}

function tempInstance() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'elauncher-'))
}
const mods = (root) => fs.readdirSync(path.join(root, 'mods')).sort()

/* ------------------------------------------------------------------ tests */

describe('jar names', () => {
  it('reads edition, loader, versions and whether it is turned off', () => {
    assert.deepEqual(ep.parseJarName('EnderPhone-Fabric-1.21.1-0.5.8.jar'), {
      edition: 'full', loader: 'fabric', minecraft: '1.21.1', version: '0.5.8', enabled: true,
    })
    assert.deepEqual(ep.parseJarName('EnderPhone-Lite-NeoForge-26.2-0.5.8.jar.disabled'), {
      edition: 'lite', loader: 'neoforge', minecraft: '26.2', version: '0.5.8', enabled: false,
    })
  })
  it('ignores anything else', () => {
    assert.equal(ep.parseJarName('fabric-api-0.1.jar'), null)
    assert.equal(ep.parseJarName('EnderPhone-Server-Fabric-1.21.1-0.1.0.jar'), null)
    assert.equal(ep.parseJarName('EnderPhone-Fabric-1.21.1-0.5.8.jar.part'), null)
  })
  it('builds the same names the website uses', () => {
    assert.equal(ep.fileNameFor('lite', 'neoforge', '26.2', '0.5.8'), 'EnderPhone-Lite-NeoForge-26.2-0.5.8.jar')
    assert.equal(ep.fileNameFor('full', 'fabric', '1.21.1', '0.5.8'), 'EnderPhone-Fabric-1.21.1-0.5.8.jar')
  })
  it('compares versions numerically', () => {
    assert.ok(ep.compareVersions('0.5.10', '0.5.9') > 0)
    assert.ok(ep.compareVersions('26.2', '1.21.1') > 0)
  })
  it('gives Quilt the Fabric build and vanilla/forge nothing', () => {
    assert.equal(ep.jarLoaderFor('quilt'), 'fabric')
    assert.equal(ep.jarLoaderFor('neoforge'), 'neoforge')
    assert.equal(ep.jarLoaderFor('forge'), null)
    assert.equal(ep.jarLoaderFor('vanilla'), null)
  })
})

describe('picking a release', () => {
  it('takes the newest build for the instance, and nothing for a version without one', async () => {
    feed.releases = [
      release('EnderPhone-Fabric-1.21.1-0.5.7.jar', 'old'),
      release('EnderPhone-Fabric-1.21.1-0.5.8.jar', 'new'),
      release('EnderPhone-NeoForge-26.2-0.5.8.jar', 'neo'),
    ]
    await ep.listReleases({ fresh: true })
    assert.equal((await ep.resolveRelease({ minecraftVersion: '1.21.1', loader: 'fabric', edition: 'full' })).version, '0.5.8')
    assert.equal((await ep.resolveRelease({ minecraftVersion: '1.21.1', loader: 'quilt', edition: 'full' })).version, '0.5.8')
    assert.equal(await ep.resolveRelease({ minecraftVersion: '1.20.1', loader: 'fabric', edition: 'full' }), null)
    assert.equal(await ep.resolveRelease({ minecraftVersion: '1.21.1', loader: 'forge', edition: 'full' }), null)
  })
  it('falls back to the last good feed when offline', async () => {
    feed.fail = true
    const list = await ep.listReleases({ fresh: true })
    assert.equal(list.length, 3)
    feed.fail = false
  })
  it('lists supported versions per loader, newest first', async () => {
    await ep.listReleases({ fresh: true })
    assert.deepEqual(await ep.supportedTargets(), [
      { minecraft: '26.2', loaders: ['neoforge'] },
      { minecraft: '1.21.1', loaders: ['fabric'] },
    ])
  })
})

describe('installing into an instance', () => {
  const spec = { minecraftVersion: '1.21.1', loader: 'fabric', edition: 'full' }

  it('installs EnderPhone and Fabric API into a fresh instance', async () => {
    feed.releases = [release('EnderPhone-Fabric-1.21.1-0.5.8.jar', 'jar-bytes')]
    await ep.listReleases({ fresh: true })
    const root = tempInstance()
    modrinthCalls.length = 0
    const result = await ep.ensureInstalled(root, spec)
    assert.equal(result.action, 'installed')
    assert.deepEqual(mods(root), ['EnderPhone-Fabric-1.21.1-0.5.8.jar', 'fabric-api-0.1.jar'])
    assert.equal(fs.readFileSync(path.join(root, 'mods', 'EnderPhone-Fabric-1.21.1-0.5.8.jar'), 'utf8'), 'jar-bytes')
    assert.deepEqual(modrinthCalls, [{ slug: 'fabric-api', filter: { loader: 'fabric', minecraftVersion: '1.21.1' } }])

    const again = await ep.ensureInstalled(root, spec)
    assert.equal(again.action, 'current')
    assert.equal(modrinthCalls.length, 1, 'Fabric API is not re-added when present')
  })

  it('replaces an older build and the other edition, leaving other mods alone', async () => {
    const root = tempInstance()
    fs.mkdirSync(path.join(root, 'mods'))
    fs.writeFileSync(path.join(root, 'mods', 'EnderPhone-Lite-Fabric-1.21.1-0.5.6.jar'), 'old lite')
    fs.writeFileSync(path.join(root, 'mods', 'sodium.jar'), 's')
    fs.writeFileSync(path.join(root, 'mods', 'fabric-api-9.jar'), 'f')
    const result = await ep.ensureInstalled(root, spec)
    assert.equal(result.action, 'installed')
    assert.deepEqual(mods(root), ['EnderPhone-Fabric-1.21.1-0.5.8.jar', 'fabric-api-9.jar', 'sodium.jar'])
  })

  it('leaves EnderPhone alone when the player turned it off', async () => {
    const root = tempInstance()
    fs.mkdirSync(path.join(root, 'mods'))
    fs.writeFileSync(path.join(root, 'mods', 'EnderPhone-Fabric-1.21.1-0.5.7.jar.disabled'), 'off')
    const result = await ep.ensureInstalled(root, spec)
    assert.equal(result.action, 'skipped')
    assert.deepEqual(mods(root), ['EnderPhone-Fabric-1.21.1-0.5.7.jar.disabled'])
  })

  it('refuses a corrupted download and keeps the old jar', async () => {
    const good = release('EnderPhone-Fabric-1.21.1-0.5.9.jar', 'real')
    feed.releases = [{ ...good, sha1: 'deadbeef'.repeat(5) }]
    await ep.listReleases({ fresh: true })
    const root = tempInstance()
    fs.mkdirSync(path.join(root, 'mods'))
    fs.writeFileSync(path.join(root, 'mods', 'EnderPhone-Fabric-1.21.1-0.5.8.jar'), 'old')
    await assert.rejects(ep.ensureInstalled(root, spec), /checksum/i)
    assert.deepEqual(mods(root), ['EnderPhone-Fabric-1.21.1-0.5.8.jar'], 'no .part left and the old jar survives')
  })

  it('says so when there is no build for the instance', async () => {
    const root = tempInstance()
    const result = await ep.ensureInstalled(root, { minecraftVersion: '1.19.2', loader: 'fabric', edition: 'full' })
    assert.equal(result.action, 'unsupported')
  })

  it('reports status: installed, latest and whether an update is waiting', async () => {
    feed.releases = [release('EnderPhone-Fabric-1.21.1-0.6.0.jar', 'newer')]
    await ep.listReleases({ fresh: true })
    const root = tempInstance()
    fs.mkdirSync(path.join(root, 'mods'))
    fs.writeFileSync(path.join(root, 'mods', 'EnderPhone-Fabric-1.21.1-0.5.8.jar'), 'old')
    const st = await ep.status(root, spec)
    assert.equal(st.installed.version, '0.5.8')
    assert.equal(st.latest.version, '0.6.0')
    assert.equal(st.updateAvailable, true)
  })

  it('removes every EnderPhone jar and nothing else', async () => {
    const root = tempInstance()
    fs.mkdirSync(path.join(root, 'mods'))
    fs.writeFileSync(path.join(root, 'mods', 'EnderPhone-Fabric-1.21.1-0.5.8.jar'), 'a')
    fs.writeFileSync(path.join(root, 'mods', 'EnderPhone-Lite-Fabric-1.21.1-0.5.7.jar.disabled'), 'b')
    fs.writeFileSync(path.join(root, 'mods', 'sodium.jar'), 's')
    await ep.removeFromInstance(root)
    assert.deepEqual(mods(root), ['sodium.jar'])
  })
})
