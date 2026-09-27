import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import stream from 'node:stream'
import streamp from 'node:stream/promises'
import yauzl from 'yauzl'
import { withRetries } from './retry.js'

// Modrinth's own API, directly. Modrinth asks every client to send an identifying User-Agent.
const MODRINTH_API = "https://api.modrinth.com/v2";
const USER_AGENT = "EnderPhone/E-Launcher/0.1 (+https://enderphone.cloud)";
async function modrinthFetch(path2) {
  const res = await fetch(`${MODRINTH_API}${path2}`, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) {
    throw new Error(`Modrinth request failed (${res.status} ${res.statusText}): ${path2}`);
  }
  return await res.json();
}
const PROJECT_TYPE_FACET = {
  modpack: "project_type:modpack",
  mod: "project_type:mod",
  shader: "project_type:shader",
  resourcepack: "project_type:resourcepack",
  datapack: "project_type:datapack"
};
export async function searchModrinth(query, projectType, offset = 0) {
  const facets = encodeURIComponent(JSON.stringify([[PROJECT_TYPE_FACET[projectType]]]));
  const q = encodeURIComponent(query);
  return modrinthFetch(
    `/search?query=${q}&facets=${facets}&limit=20&offset=${offset}&index=relevance`
  );
}
export async function listModrinthVersions(projectId, filter) {
  const params = new URLSearchParams();
  if (filter?.loader && filter.loader !== "vanilla") {
    params.set("loaders", JSON.stringify([filter.loader]));
  }
  if (filter?.minecraftVersion) {
    params.set("game_versions", JSON.stringify([filter.minecraftVersion]));
  }
  const qs = params.toString();
  return modrinthFetch(
    `/project/${encodeURIComponent(projectId)}/version${qs ? `?${qs}` : ""}`
  );
}
async function sha1OfFile(path2) {
  const hash = crypto.createHash("sha1");
  for await (const chunk of fs.createReadStream(path2)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}
async function downloadFileOnce(url, destination, expectedSha1) {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok || !res.body) {
    throw new Error(`Download failed (${res.status} ${res.statusText}): ${url}`);
  }
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  await streamp.pipeline(stream.Readable.fromWeb(res.body), fs.createWriteStream(destination));
  if (expectedSha1) {
    const actual = await sha1OfFile(destination);
    if (actual !== expectedSha1) {
      await fsp.rm(destination, { force: true });
      throw new Error(`Checksum mismatch downloading ${url} (expected ${expectedSha1}, got ${actual}).`);
    }
  }
}
function downloadFile(url, destination, expectedSha1) {
  return withRetries(() => downloadFileOnce(url, destination, expectedSha1), { attempts: 3, delayMs: 1e3 });
}
const CONTENT_FOLDER = {
  mod: "mods",
  shader: "shaderpacks",
  resourcepack: "resourcepacks",
  datapack: "datapacks"
};
export async function installModrinthContent(file, instanceRoot, kind) {
  const dest = path.join(instanceRoot, CONTENT_FOLDER[kind], file.filename);
  await downloadFile(file.url, dest, file.hashes.sha1);
}
/**
 * The newest release-channel build of a Modrinth project that fits the instance, dropped into
 * mods/. Used for what EnderPhone instances come with (Fabric API, and the optional Sodium/Iris).
 * Returns the installed file name, or null when the project has no build for this version/loader.
 */
export async function installLatestModrinthProject(slug, instanceRoot, filter) {
  const versions = await listModrinthVersions(slug, filter);
  const chosen = versions.find((v) => v.version_type === "release") ?? versions[0];
  const file = chosen?.files.find((f) => f.primary) ?? chosen?.files[0];
  if (!file) return null;
  await installModrinthContent(file, instanceRoot, "mod");
  return file.filename;
}
function readZipEntryBuffer(zipPath, entryName) {
  return new Promise((resolvePromise, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err);
      let found;
      zip.readEntry();
      zip.on("entry", (entry) => {
        if (entry.fileName !== entryName) return zip.readEntry();
        zip.openReadStream(entry, (err2, stream2) => {
          if (err2 || !stream2) return reject(err2);
          const chunks = [];
          stream2.on("data", (chunk) => chunks.push(chunk));
          stream2.on("end", () => {
            found = Buffer.concat(chunks);
            zip.readEntry();
          });
          stream2.on("error", reject);
        });
      });
      zip.on("end", () => resolvePromise(found));
      zip.on("error", reject);
    });
  });
}
async function readMrpackIndex(mrpackPath) {
  const buf = await readZipEntryBuffer(mrpackPath, "modrinth.index.json");
  if (!buf) throw new Error("That file is not a valid .mrpack (missing modrinth.index.json).");
  return JSON.parse(buf.toString("utf-8"));
}
function extractOverrides(mrpackPath, instanceRoot) {
  const prefixes = ["overrides/", "client-overrides/"];
  return new Promise((resolvePromise, reject) => {
    yauzl.open(mrpackPath, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err);
      zip.readEntry();
      zip.on("entry", (entry) => {
        const prefix = prefixes.find((p) => entry.fileName.startsWith(p));
        if (!prefix) return zip.readEntry();
        const relPath = entry.fileName.slice(prefix.length);
        if (!relPath) return zip.readEntry();
        const outPath = path.resolve(instanceRoot, relPath);
        const rel = path.relative(instanceRoot, outPath);
        if (rel.startsWith("..") || rel === "") {
          return reject(new Error(`Modpack override escapes the instance directory: ${entry.fileName}`));
        }
        if (entry.fileName.endsWith("/")) {
          fsp.mkdir(outPath, { recursive: true }).then(() => zip.readEntry(), reject);
          return;
        }
        zip.openReadStream(entry, (err2, readStream) => {
          if (err2 || !readStream) return reject(err2);
          fsp.mkdir(path.dirname(outPath), { recursive: true }).then(() => {
            const out = fs.createWriteStream(outPath);
            readStream.pipe(out);
            out.on("finish", () => zip.readEntry());
            out.on("error", reject);
          }).catch(reject);
        });
      });
      zip.on("end", () => resolvePromise());
      zip.on("error", reject);
    });
  });
}
const LOADER_DEPENDENCY_KEYS = [
  { key: "neoforge", loader: "neoforge" },
  { key: "forge", loader: "forge" },
  { key: "fabric-loader", loader: "fabric" },
  { key: "quilt-loader", loader: "quilt" }
];
export async function installModrinthModpack(version, instanceRoot, onProgress) {
  const primary = version.files.find((f) => f.primary) ?? version.files[0];
  if (!primary) throw new Error("This Modrinth version has no downloadable files.");
  await fsp.mkdir(instanceRoot, { recursive: true });
  const mrpackPath = path.join(instanceRoot, ".modrinth-download.mrpack");
  onProgress({ phase: "downloading-files", message: `Downloading ${primary.filename}...` });
  await downloadFile(primary.url, mrpackPath, primary.hashes.sha1);
  const index = await readMrpackIndex(mrpackPath);
  const files = index.files.filter((f) => f.env?.client !== "unsupported" && f.downloads.length > 0);
  let done = 0;
  for (const file of files) {
    const url = file.downloads[0];
    const dest = path.resolve(instanceRoot, file.path);
    const rel = path.relative(instanceRoot, dest);
    if (rel.startsWith("..") || rel === "") {
      throw new Error(`Modpack file entry escapes the instance directory: ${file.path}`);
    }
    await downloadFile(url, dest, file.hashes?.sha1);
    done++;
    onProgress({
      phase: "downloading-files",
      message: `Downloading mods (${done}/${files.length})...`,
      fraction: files.length ? done / files.length : void 0
    });
  }
  onProgress({ phase: "downloading-files", message: "Applying pack overrides..." });
  await extractOverrides(mrpackPath, instanceRoot);
  await fsp.rm(mrpackPath, { force: true });
  const mcVersion = index.dependencies.minecraft;
  if (!mcVersion) {
    throw new Error("This .mrpack does not declare a Minecraft version (dependencies.minecraft).");
  }
  const match = LOADER_DEPENDENCY_KEYS.find((d) => index.dependencies[d.key]);
  return {
    minecraftVersion: mcVersion,
    loader: match?.loader ?? "vanilla",
    loaderVersion: match ? index.dependencies[match.key] : void 0
  };
}
