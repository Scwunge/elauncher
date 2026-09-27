import * as core from '@xmcl/core'
import * as installer from '@xmcl/installer'
import { withRetries } from './retry.js'

/** Maps a Minecraft version to NeoForge's own version-numbering convention (its own maven
 *  releases feed, not exposed by @xmcl/installer at all - no getNeoForgedVersionList exists in
 *  this library, unlike Forge/Fabric). Confirmed via NeoForge's actual maven API: "1.21.1" -> a
 *  "21.1.x" release train (drop the leading "1." from the classic MC versioning scheme). Once MC
 *  itself moved off that scheme (e.g. "26.2"), NeoForge has nothing to drop and matches directly -
 *  same rule covers both without a hardcoded cutover date. */
function neoForgeVersionPrefix(minecraftVersion) {
  return minecraftVersion.startsWith('1.') ? minecraftVersion.slice(2) : minecraftVersion
}

/** No loaderVersion specified means "just give me the latest" - matches every other launcher's
 *  actual behavior (PrismLauncher, the official Fabric/Forge/NeoForge installers) rather than
 *  forcing the user to already know an exact version string before they can press install. */
async function resolveLatestLoaderVersion(loader, minecraftVersion) {
  if (loader === 'fabric') {
    const artifacts = await installer.getFabricArtifacts()
    const stable = artifacts.loader.find((l) => l.stable)
    const chosen = stable ?? artifacts.loader[0]
    if (!chosen) throw new Error(`No Fabric loader builds found at all.`)
    return chosen.version
  }
  if (loader === 'forge') {
    const { versions } = await installer.getForgeVersionList({ minecraft: minecraftVersion })
    const latest = versions.find((v) => v.type === 'latest') ?? versions[0]
    if (!latest) throw new Error(`No Forge builds found for Minecraft ${minecraftVersion}.`)
    return latest.version
  }
  if (loader === 'neoforge') {
    const prefix = neoForgeVersionPrefix(minecraftVersion)
    const res = await fetch('https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge')
    if (!res.ok) throw new Error(`Could not reach NeoForge's version feed (HTTP ${res.status}).`)
    const { versions } = await res.json()
    const matching = versions.filter((v) => v.startsWith(`${prefix}.`) && !v.includes('-'))
    if (matching.length === 0) {
      throw new Error(`No NeoForge builds found for Minecraft ${minecraftVersion} (looked for "${prefix}.x").`)
    }
    // NeoForge version strings sort correctly as dotted numeric tuples, not lexicographically
    // ("21.1.9" must come before "21.1.10") - compare component-by-component instead of relying
    // on Array.sort()'s default string comparison, which would get that pair backwards.
    matching.sort((a, b) => {
      const pa = a.split('.').map(Number)
      const pb = b.split('.').map(Number)
      for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
        if (diff !== 0) return diff
      }
      return 0
    })
    return matching[matching.length - 1]
  }
  if (loader === 'quilt') {
    const versions = await installer.getQuiltVersionsList()
    // No stable/beta flag on Quilt's own artifact list (unlike Fabric's) - the feed is already
    // newest-first, matching Fabric's own list ordering, so the first entry is the latest build.
    if (versions.length === 0) throw new Error(`No Quilt loader builds found at all.`)
    return versions[0].version
  }
  throw new Error(`Don't know how to resolve a default loader version for "${loader}".`)
}

export async function ensureMinecraftInstalled(manifest, instanceRoot, getJavaPath, onProgress) {
  onProgress({
    phase: "installing-minecraft",
    message: `Checking Minecraft ${manifest.minecraftVersion}...`
  });
  const versionList = await installer.getVersionList();
  const versionMeta = versionList.versions.find((v) => v.id === manifest.minecraftVersion);
  if (!versionMeta) {
    throw new Error(
      `Minecraft ${manifest.minecraftVersion} was not found in Mojang's version manifest.`
    );
  }
  const vanilla = await withRetries(() => installer.install(versionMeta, instanceRoot), {
    attempts: 4,
    onRetry: (_err, attempt, attempts) => onProgress({
      phase: "installing-minecraft",
      message: `Download hiccup - retrying Minecraft ${manifest.minecraftVersion} (attempt ${attempt + 1} of ${attempts})...`
    })
  });
  if (manifest.loader === "vanilla" || !manifest.loader) {
    return vanilla;
  }
  const javaPath = await getJavaPath(vanilla.javaVersion.majorVersion);
  // Blank loaderVersion means "give me the latest" - matches how PrismLauncher/the official
  // installers behave, rather than forcing the user to already know an exact version string.
  // Previously this just threw here for every loader, which is what made "install Fabric with no
  // version picked" fail outright instead of resolving to something real.
  const loaderVersion = manifest.loaderVersion || (await resolveLatestLoaderVersion(manifest.loader, manifest.minecraftVersion));
  let finalVersionId;
  if (manifest.loader === "forge") {
    onProgress({ phase: "installing-loader", message: `Installing Forge ${loaderVersion}...` });
    const { versions } = await installer.getForgeVersionList({ minecraft: manifest.minecraftVersion });
    const forgeVersion = versions.find((v) => v.version === loaderVersion);
    if (!forgeVersion) {
      throw new Error(
        `Forge ${loaderVersion} for Minecraft ${manifest.minecraftVersion} was not found.`
      );
    }
    finalVersionId = await withRetries(() => installer.installForge(forgeVersion, instanceRoot, { java: javaPath }), {
      attempts: 3,
      onRetry: (_err, attempt, attempts) => onProgress({
        phase: "installing-loader",
        message: `Download hiccup - retrying Forge install (attempt ${attempt + 1} of ${attempts})...`
      })
    });
  } else if (manifest.loader === "fabric") {
    onProgress({ phase: "installing-loader", message: `Installing Fabric ${loaderVersion}...` });
    const loader = await installer.getFabricLoaderArtifact(manifest.minecraftVersion, loaderVersion);
    finalVersionId = await withRetries(() => installer.installFabric(loader, instanceRoot), {
      attempts: 3,
      onRetry: (_err, attempt, attempts) => onProgress({
        phase: "installing-loader",
        message: `Download hiccup - retrying Fabric install (attempt ${attempt + 1} of ${attempts})...`
      })
    });
  } else if (manifest.loader === "neoforge") {
    onProgress({ phase: "installing-loader", message: `Installing NeoForge ${loaderVersion}...` });
    finalVersionId = await withRetries(
      () => installer.installNeoForged("neoforge", loaderVersion, instanceRoot, { java: javaPath }),
      {
        attempts: 3,
        onRetry: (_err, attempt, attempts) => onProgress({
          phase: "installing-loader",
          message: `Download hiccup - retrying NeoForge install (attempt ${attempt + 1} of ${attempts})...`
        })
      }
    );
  } else if (manifest.loader === "quilt") {
    onProgress({ phase: "installing-loader", message: `Installing Quilt ${loaderVersion}...` });
    finalVersionId = await withRetries(
      () => installer.installQuiltVersion({ minecraftVersion: manifest.minecraftVersion, version: loaderVersion, minecraft: instanceRoot }),
      {
        attempts: 3,
        onRetry: (_err, attempt, attempts) => onProgress({
          phase: "installing-loader",
          message: `Download hiccup - retrying Quilt install (attempt ${attempt + 1} of ${attempts})...`
        })
      }
    );
  } else {
    throw new Error(
      `Loader "${manifest.loader}" is not wired up in this launcher yet.`
    );
  }
  onProgress({ phase: "installing-loader", message: "Finishing loader install..." });
  const resolved = await core.Version.parse(instanceRoot, finalVersionId);
  return withRetries(() => installer.installDependencies(resolved), {
    attempts: 3,
    onRetry: (_err, attempt, attempts) => onProgress({
      phase: "installing-loader",
      message: `Download hiccup - retrying remaining libraries (attempt ${attempt + 1} of ${attempts})...`
    })
  });
}
/** 1.20 replaced --server/--port with Quick Play; year-numbered releases (26.x) all have it. */
export function supportsQuickPlay(minecraftVersion) {
  const [major, minor] = String(minecraftVersion).split('.').map(Number)
  if (major > 1) return true
  return major === 1 && minor >= 20
}

/** "host" or "host:port" -> { ip, port } for the pre-1.20 --server/--port arguments. */
function splitAddress(address) {
  const m = /^\[?([^\]]+?)\]?(?::(\d+))?$/.exec(address.trim())
  return { ip: m ? m[1] : address, port: m?.[2] ? Number(m[2]) : undefined }
}

export async function launchGame(params) {
  const extraMCArgs = []
  let server
  // Straight into a server or a world: Endportal's Play button, or a world's Play in the Worlds tab.
  if (params.quickPlay?.type === 'multiplayer') {
    if (supportsQuickPlay(params.minecraftVersion)) extraMCArgs.push('--quickPlayMultiplayer', params.quickPlay.address)
    else server = splitAddress(params.quickPlay.address)
  } else if (params.quickPlay?.type === 'singleplayer' && supportsQuickPlay(params.minecraftVersion)) {
    extraMCArgs.push('--quickPlaySingleplayer', params.quickPlay.world)
  }
  return core.launch({
    gamePath: params.instanceRoot,
    javaPath: params.javaPath,
    version: params.resolvedVersion,
    gameProfile: { name: params.session.profile.name, id: params.session.profile.id },
    accessToken: params.session.accessToken,
    userType: "mojang",
    minMemory: params.minMemoryMb,
    maxMemory: params.maxMemoryMb,
    // Per-instance launch overrides (see store.js's launchOverrides) - e.g. a memory-hungry
    // instance that needs more heap than the global default, or -Dfoo=bar flags only that
    // instance needs. Empty/undefined is fine - @xmcl/core falls back to its own defaults.
    extraJVMArgs: params.extraJvmArgs,
    extraMCArgs: extraMCArgs.length ? extraMCArgs : undefined,
    server,
    launcherName: "E-Launcher",
    launcherBrand: "enderphone"
  });
}
