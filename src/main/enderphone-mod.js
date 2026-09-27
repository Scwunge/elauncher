/**
 * EnderPhone inside an instance: which jar fits it, putting that jar in `mods/`, and keeping it
 * current. This is the part that makes E-Launcher more than a launcher with a purple coat of paint -
 * a player switches EnderPhone on for an instance once and never downloads a jar by hand again.
 *
 * Where the jars come from: the API's release feed (GET /v1/launcher/releases), which is a listing
 * of enderphone.cloud/downloads/ with a sha1 per file. If the feed can't be reached (offline, or an
 * API that predates it) the last good copy is used; with no copy at all, the website's own rule is
 * the fallback - the fixed file name for a known version, checked with a HEAD request, which is
 * exactly how the site's download buttons decide whether a build exists.
 *
 * How an installed EnderPhone is recognised: by name. Every release follows one pattern
 * (EnderPhone[-Lite]-<Loader>-<mc>-<version>.jar), so the jar in `mods/` says which edition and
 * version it is without opening it. A jar the player turned off (`.disabled`, from the Content tab)
 * is left alone by auto-update - that was their choice.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import stream from 'node:stream'
import streamp from 'node:stream/promises'
import { api } from './enderphone-api.js'
import { installLatestModrinthProject } from './modrinth.js'
import { withRetries } from './retry.js'
import { getReleaseCache, setReleaseCache } from './store.js'

/** Used only when the feed has never been reachable - see the header. Bump with each release. */
export const KNOWN_VERSION = '0.5.8'
const DOWNLOAD_BASE = 'https://enderphone.cloud/downloads/'
const LOADER_NAMES = { fabric: 'Fabric', neoforge: 'NeoForge' }

const JAR_RE = /^EnderPhone(?:-(Lite))?-(Fabric|NeoForge)-(\d+(?:\.\d+){1,2})-(\d+\.\d+\.\d+)\.jar(\.disabled)?$/

/** @returns {{edition, loader, minecraft, version, enabled} | null} */
export function parseJarName(name) {
  const m = JAR_RE.exec(name)
  if (!m) return null
  return {
    edition: m[1] ? 'lite' : 'full',
    loader: m[2] === 'Fabric' ? 'fabric' : 'neoforge',
    minecraft: m[3],
    version: m[4],
    enabled: !m[5],
  }
}

export function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number)
  const pb = String(b).split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

/** Quilt loads Fabric mods, so a Quilt instance takes the Fabric build. */
export function jarLoaderFor(loader) {
  if (loader === 'fabric' || loader === 'quilt') return 'fabric'
  if (loader === 'neoforge') return 'neoforge'
  return null
}

export function fileNameFor(edition, loader, minecraft, version) {
  return `EnderPhone${edition === 'lite' ? '-Lite' : ''}-${LOADER_NAMES[loader]}-${minecraft}-${version}.jar`
}

/* ------------------------------------------------------------------------------ the feed */

let feedPromise
let feedAt = 0
const FEED_TTL_MS = 5 * 60 * 1000

/** Client releases only (the server addon is not something a launcher installs). */
export async function listReleases({ fresh = false } = {}) {
  if (!fresh && feedPromise && Date.now() - feedAt < FEED_TTL_MS) return feedPromise
  feedAt = Date.now()
  feedPromise = api
    .releases()
    .then(({ releases }) => {
      const client = releases.filter((r) => r.edition === 'full' || r.edition === 'lite')
      setReleaseCache(client)
      return client
    })
    .catch(() => getReleaseCache())
  return feedPromise
}

async function probeKnownVersion(edition, loader, minecraft) {
  const file = fileNameFor(edition, loader, minecraft, KNOWN_VERSION)
  try {
    const res = await fetch(DOWNLOAD_BASE + file, { method: 'HEAD' })
    if (!res.ok || (res.headers.get('content-type') || '').includes('text/html')) return null
    return { file, edition, loader, minecraft, version: KNOWN_VERSION, url: DOWNLOAD_BASE + file, latest: true }
  } catch {
    return null
  }
}

/** The newest release for an instance, or null when EnderPhone isn't built for it. */
export async function resolveRelease({ minecraftVersion, loader, edition }) {
  const jarLoader = jarLoaderFor(loader)
  if (!jarLoader) return null
  const releases = await listReleases()
  const match = releases
    .filter((r) => r.edition === edition && r.loader === jarLoader && r.minecraft === minecraftVersion)
    .sort((a, b) => compareVersions(b.version, a.version))[0]
  if (match) return match
  if (releases.length > 0) return null // the feed answered and there's no build: that's the truth
  return probeKnownVersion(edition, jarLoader, minecraftVersion)
}

/** Every Minecraft version EnderPhone has a build for, per loader - drives the New Instance wizard. */
export async function supportedTargets() {
  const releases = await listReleases()
  const out = {}
  for (const r of releases) {
    out[r.minecraft] ??= new Set()
    out[r.minecraft].add(r.loader)
  }
  if (Object.keys(out).length === 0) {
    // Same list the website's picker shows (site/app.js LOADERS_FOR) - only used with no feed at all.
    for (const mc of ['1.21.1', '26.1.2', '26.2', '26.3']) out[mc] = new Set(['fabric', 'neoforge'])
  }
  return Object.entries(out)
    .map(([minecraft, loaders]) => ({ minecraft, loaders: [...loaders].sort() }))
    .sort((a, b) => compareVersions(b.minecraft, a.minecraft))
}

/* ------------------------------------------------------------------------------ in an instance */

function modsDir(instanceRoot) {
  return path.join(instanceRoot, 'mods')
}

/** Every EnderPhone jar in the instance (normally one). */
export async function installedJars(instanceRoot) {
  const names = await fsp.readdir(modsDir(instanceRoot)).catch(() => [])
  return names.map((name) => ({ name, ...parseJarName(name) })).filter((j) => j.edition)
}

/** What the UI shows for an instance: installed build (if any) and the newest one available. */
export async function status(instanceRoot, spec) {
  const jars = await installedJars(instanceRoot)
  const installed = jars.sort((a, b) => compareVersions(b.version, a.version))[0]
  const edition = spec.edition ?? installed?.edition ?? 'full'
  const release = await resolveRelease({ minecraftVersion: spec.minecraftVersion, loader: spec.loader, edition })
  return {
    supported: !!release,
    installed: installed
      ? { file: installed.name, edition: installed.edition, version: installed.version, enabled: installed.enabled }
      : null,
    latest: release ? { file: release.file, version: release.version, size: release.size } : null,
    updateAvailable: !!(release && installed && installed.enabled && installed.name !== release.file),
  }
}

async function sha1Of(file) {
  const hash = crypto.createHash('sha1')
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

async function downloadRelease(release, destination, onProgress) {
  const res = await fetch(release.url, { redirect: 'follow', headers: { 'User-Agent': 'E-Launcher/0.1' } })
  if (!res.ok || !res.body) throw new Error(`Could not download ${release.file} (${res.status}).`)
  const total = release.size || Number(res.headers.get('content-length')) || 0
  let done = 0
  let lastEmit = 0
  const source = stream.Readable.fromWeb(res.body)
  source.on('data', (chunk) => {
    done += chunk.length
    const now = Date.now()
    if (now - lastEmit < 200 && done < total) return
    lastEmit = now
    onProgress({
      phase: 'downloading-files',
      message: `Downloading EnderPhone ${release.version}`,
      fraction: total ? Math.min(done / total, 1) : undefined,
      bytesTransferred: done,
      totalBytes: total || undefined,
    })
  })
  const part = `${destination}.part`
  try {
    await streamp.pipeline(source, fs.createWriteStream(part))
    if (release.sha1) {
      const actual = await sha1Of(part)
      if (actual !== release.sha1) throw new Error(`EnderPhone download was corrupted (checksum mismatch on ${release.file}).`)
    }
    await fsp.rename(part, destination)
  } catch (err) {
    await fsp.rm(part, { force: true })
    throw err
  }
}

async function ensureFabricApi(instanceRoot, minecraftVersion, onProgress) {
  const names = await fsp.readdir(modsDir(instanceRoot)).catch(() => [])
  if (names.some((n) => /^fabric-api[-_]/i.test(n))) return
  onProgress({ phase: 'downloading-files', message: 'Adding Fabric API (EnderPhone needs it on Fabric)...' })
  const installed = await installLatestModrinthProject('fabric-api', instanceRoot, { loader: 'fabric', minecraftVersion })
  if (!installed) {
    onProgress({ phase: 'downloading-files', message: `No Fabric API build for ${minecraftVersion} yet - add it by hand if the game asks.` })
  }
}

/**
 * Makes the instance's EnderPhone match `spec` ({minecraftVersion, loader, edition}): installs it
 * when missing, replaces an older build or the other edition, and adds Fabric API on Fabric/Quilt.
 * Leaves a jar the player turned off alone. Returns what happened, for the progress line.
 */
export async function ensureInstalled(instanceRoot, spec, onProgress = () => {}) {
  onProgress({ phase: 'checking', message: 'Checking EnderPhone...' })
  const release = await resolveRelease(spec)
  if (!release) {
    return { action: 'unsupported', message: `EnderPhone has no ${spec.loader} build for Minecraft ${spec.minecraftVersion} yet.` }
  }
  const jars = await installedJars(instanceRoot)
  if (jars.some((j) => !j.enabled) && !jars.some((j) => j.enabled)) {
    return { action: 'skipped', message: 'EnderPhone is turned off in this instance.' }
  }
  await fsp.mkdir(modsDir(instanceRoot), { recursive: true })
  const current = jars.find((j) => j.name === release.file)
  if (!current) {
    await withRetries(() => downloadRelease(release, path.join(modsDir(instanceRoot), release.file), onProgress), {
      attempts: 3,
      delayMs: 1000,
    })
  }
  // Only after the new jar is safely in place: two EnderPhone jars would crash the game on a
  // duplicate mod id, and none at all is worse than an old one.
  for (const j of jars) {
    if (j.name !== release.file) await fsp.rm(path.join(modsDir(instanceRoot), j.name), { force: true })
  }
  if (jarLoaderFor(spec.loader) === 'fabric') await ensureFabricApi(instanceRoot, spec.minecraftVersion, onProgress)
  return current
    ? { action: 'current', message: `EnderPhone ${release.version} is up to date.` }
    : { action: 'installed', message: `EnderPhone ${release.version} installed.`, version: release.version }
}

export async function removeFromInstance(instanceRoot) {
  for (const j of await installedJars(instanceRoot)) {
    await fsp.rm(path.join(modsDir(instanceRoot), j.name), { force: true })
  }
}
