/**
 * Instances: a folder under the game directory plus a small record (name, Minecraft version,
 * loader) in electron-store. Everything a player owns is one of these - made here, installed from a
 * Modrinth modpack, or made by the New EnderPhone Instance wizard.
 *
 * (Kept under its old name, modpacks.js, and "modpack" in the store keys, so a player's data from the
 * launcher this was built from keeps meaning the same thing.)
 */
import crypto from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { addCustomModpack, getCustomModpack, getCustomModpacks, getSettings, removeCustomModpack, updateCustomModpack } from './store.js'

const CONTENT_KIND_FOLDER = {
  mods: "mods",
  resourcepacks: "resourcepacks",
  shaderpacks: "shaderpacks",
  datapacks: "datapacks"
};
export function instanceDir(modpackId) {
  return path.join(getSettings().gameDirectory, modpackId);
}
function slugify(name) {
  const base = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return base || "instance";
}
function pickModpackId(name) {
  const slug = slugify(name);
  const taken = new Set(getCustomModpacks().map((r) => r.id));
  if (!taken.has(slug)) return slug;
  return `${slug}-${crypto.randomUUID().slice(0, 6)}`;
}
export async function createModpack(input) {
  const id = pickModpackId(input.name);
  const root = instanceDir(id);
  await fsp.mkdir(root, { recursive: true });
  const record = {
    id,
    name: input.name,
    iconUrl: input.iconDataUrl,
    minecraftVersion: input.minecraftVersion,
    loader: input.loader,
    loaderVersion: input.loaderVersion,
    createdAt: Date.now()
  };
  addCustomModpack(record);
  return record;
}
export async function updateModpack(id, patch) {
  if (!getCustomModpack(id)) throw new Error(`No instance with id "${id}".`);
  const { iconDataUrl, ...rest } = patch;
  updateCustomModpack(id, iconDataUrl !== undefined ? { ...rest, iconUrl: iconDataUrl } : rest);
  const updated = getCustomModpack(id);
  if (!updated) throw new Error(`Instance "${id}" disappeared while updating it.`);
  return updated;
}
export async function deleteModpack(id, deleteFiles) {
  if (!getCustomModpack(id)) throw new Error(`No instance with id "${id}".`);
  removeCustomModpack(id);
  if (deleteFiles) {
    await fsp.rm(instanceDir(id), { recursive: true, force: true });
  }
}
const DISABLED_SUFFIX = ".disabled";

/** `foo.jar.disabled` on disk is the source of truth for "this mod is turned off" (the same
 *  convention MultiMC/Prism use - loaders only scan files literally ending in `.jar`, so a
 *  renamed file is silently skipped, no loader-side config needed). */
export async function listInstalledContent(modpackId, kind) {
  const folder = path.join(instanceDir(modpackId), CONTENT_KIND_FOLDER[kind]);
  let names;
  try {
    names = await fsp.readdir(folder);
  } catch {
    return [];
  }
  const files = [];
  for (const name of names) {
    if (name.startsWith(".") || name.endsWith(".part")) continue;
    try {
      const info = await fsp.stat(path.join(folder, name));
      if (!info.isFile()) continue;
      const disabled = name.endsWith(DISABLED_SUFFIX);
      const canonicalName = disabled ? name.slice(0, -DISABLED_SUFFIX.length) : name;
      files.push({ name: canonicalName, sizeBytes: info.size, enabled: !disabled });
    } catch {
    }
  }
  return files.sort((a, b) => a.name.localeCompare(b.name));
}
export function assertSafeFilename(filename) {
  if (filename.includes("/") || filename.includes("\\") || filename === ".." || filename === ".") {
    throw new Error(`Invalid file name: ${filename}`);
  }
}
export async function removeInstalledContent(modpackId, kind, filename) {
  assertSafeFilename(filename);
  const folder = path.join(instanceDir(modpackId), CONTENT_KIND_FOLDER[kind]);
  await fsp.rm(path.join(folder, filename), { force: true });
  await fsp.rm(path.join(folder, `${filename}${DISABLED_SUFFIX}`), { force: true });
}
/** Renames `filename` to/from its `.disabled` form. */
export async function toggleInstalledContent(modpackId, kind, filename, enabled) {
  assertSafeFilename(filename);
  const folder = path.join(instanceDir(modpackId), CONTENT_KIND_FOLDER[kind]);
  const enabledPath = path.join(folder, filename);
  const disabledPath = path.join(folder, `${filename}${DISABLED_SUFFIX}`);
  try {
    if (enabled) await fsp.rename(disabledPath, enabledPath);
    else await fsp.rename(enabledPath, disabledPath);
  } catch (err) {
    if (err.code !== "ENOENT") throw err; // already in the requested state - not an error
  }
}

/* ------------------------------------------------------------------------------ worlds + logs */

async function folderSize(dir, depth = 0) {
  if (depth > 6) return 0;
  let total = 0;
  for (const entry of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += await folderSize(full, depth + 1);
    else total += (await fsp.stat(full).catch(() => ({ size: 0 }))).size;
  }
  return total;
}

/** Singleplayer worlds in `saves/`, newest first, with the world's own icon when it has one. */
export async function listWorlds(modpackId) {
  const saves = path.join(instanceDir(modpackId), "saves");
  const entries = await fsp.readdir(saves, { withFileTypes: true }).catch(() => []);
  const worlds = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(saves, entry.name);
    const level = await fsp.stat(path.join(dir, "level.dat")).catch(() => null);
    if (!level) continue;
    const icon = await fsp.readFile(path.join(dir, "icon.png")).catch(() => null);
    worlds.push({
      folder: entry.name,
      lastPlayed: level.mtimeMs,
      sizeBytes: await folderSize(dir),
      iconDataUrl: icon ? `data:image/png;base64,${icon.toString("base64")}` : undefined
    });
  }
  return worlds.sort((a, b) => b.lastPlayed - a.lastPlayed);
}

export async function deleteWorld(modpackId, folder) {
  assertSafeFilename(folder);
  await fsp.rm(path.join(instanceDir(modpackId), "saves", folder), { recursive: true, force: true });
}

/** The tail of `logs/latest.log` - enough to read an error, not a 50MB modded log in one IPC hop. */
export async function readLatestLog(modpackId, maxBytes = 256 * 1024) {
  const file = path.join(instanceDir(modpackId), "logs", "latest.log");
  let handle;
  try {
    handle = await fsp.open(file, "r");
    const { size, mtimeMs } = await handle.stat();
    const start = Math.max(0, size - maxBytes);
    const buf = Buffer.alloc(size - start);
    await handle.read(buf, 0, buf.length, start);
    return { exists: true, truncated: start > 0, modifiedAt: mtimeMs, text: buf.toString("utf-8") };
  } catch {
    return { exists: false, truncated: false, text: "" };
  } finally {
    await handle?.close();
  }
}
