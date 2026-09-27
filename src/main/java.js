import * as electron from 'electron'
import * as installer from '@xmcl/installer'
import * as tar from 'tar'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import stream from 'node:stream'
import streamp from 'node:stream/promises'
import yauzl from 'yauzl'

function bundledJreDir() {
  if (process.platform !== "win32" || process.arch !== "x64") return void 0;
  return electron.app.isPackaged ? path.join(process.resourcesPath, "jre-win-x64") : path.join(electron.app.getAppPath(), "resources", "jre-win-x64");
}
function temurinPlatform() {
  const os = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "mac" : "linux";
  const arch = process.arch === "arm64" ? "aarch64" : process.arch === "x64" ? "x64" : process.arch;
  return { os, arch };
}
function jreRuntimeRoot() {
  return path.join(electron.app.getPath("userData"), "runtimes");
}
function javaExecutableName() {
  return process.platform === "win32" ? "java.exe" : "java";
}
async function findJavaExecutable(dir, depth) {
  if (depth < 0 || !fs.existsSync(dir)) return void 0;
  const direct = path.join(dir, "bin", javaExecutableName());
  if (fs.existsSync(direct)) return direct;
  const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const found = await findJavaExecutable(path.join(dir, entry.name), depth - 1);
    if (found) return found;
  }
  return void 0;
}
async function findJavaUnder(root, majorVersion) {
  const destDir = path.join(root, `jre-${majorVersion}`);
  return findJavaExecutable(destDir, 4);
}
export async function downloadTemurinJre(majorVersion, onProgress) {
  const { os, arch } = temurinPlatform();
  const root = jreRuntimeRoot();
  const destDir = path.join(root, `jre-${majorVersion}`);
  await fsp.mkdir(root, { recursive: true });
  await fsp.rm(destDir, { recursive: true, force: true });
  onProgress({
    phase: "preparing-java",
    message: `Downloading a Java ${majorVersion} runtime (${os}/${arch})...`
  });
  const url = `https://api.adoptium.net/v3/binary/latest/${majorVersion}/ga/${os}/${arch}/jre/hotspot/normal/eclipse`;
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) {
    throw new Error(
      `Could not download a Java ${majorVersion} runtime automatically (${res.status}). Please install Java ${majorVersion}+ yourself from https://adoptium.net and set its path in Settings.`
    );
  }
  await fsp.mkdir(destDir, { recursive: true });
  if (os === "windows") {
    const archivePath = path.join(root, `jre-${majorVersion}.zip`);
    await streamp.pipeline(stream.Readable.fromWeb(res.body), fs.createWriteStream(archivePath));
    await new Promise((resolve, reject) => {
      yauzl.open(archivePath, { lazyEntries: true }, (err, zip) => {
        if (err || !zip) return reject(err);
        zip.readEntry();
        zip.on("entry", (entry) => {
          const outPath = path.join(destDir, entry.fileName);
          if (entry.fileName.endsWith("/")) {
            fsp.mkdir(outPath, { recursive: true }).then(() => zip.readEntry());
            return;
          }
          zip.openReadStream(entry, (err2, readStream) => {
            if (err2 || !readStream) return reject(err2);
            fsp.mkdir(path.join(outPath, ".."), { recursive: true }).then(() => {
              const out = fs.createWriteStream(outPath);
              readStream.pipe(out);
              out.on("finish", () => zip.readEntry());
            });
          });
        });
        zip.on("end", () => resolve());
        zip.on("error", reject);
      });
    });
    await fsp.rm(archivePath, { force: true });
  } else {
    await streamp.pipeline(stream.Readable.fromWeb(res.body), tar.extract({ cwd: destDir, strip: 0 }));
  }
  const javaPath = await findJavaUnder(root, majorVersion);
  if (!javaPath) {
    throw new Error(
      `Downloaded a Java ${majorVersion} runtime but could not locate the java executable inside it.`
    );
  }
  if (process.platform !== "win32") {
    const { chmod } = await import("fs/promises");
    await chmod(javaPath, 493).catch(() => void 0);
  }
  return javaPath;
}
export async function ensureJava(requiredMajor, configuredJavaPath, onProgress, overridePath) {
  onProgress({ phase: "preparing-java", message: "Looking for a compatible Java runtime..." });
  if (overridePath) {
    const info = await installer.resolveJava(overridePath);
    if (info && info.majorVersion >= requiredMajor) return overridePath;
    onProgress({
      phase: "preparing-java",
      message: `The Java you picked for this modpack doesn't meet the required version (Java ${requiredMajor}+) - looking for another one...`
    });
  }
  const bundledDir = bundledJreDir();
  if (bundledDir) {
    const bundled = await findJavaExecutable(bundledDir, 2);
    if (bundled) {
      const info = await installer.resolveJava(bundled);
      if (info && info.majorVersion >= requiredMajor) return bundled;
    }
  }
  if (configuredJavaPath) {
    const info = await installer.resolveJava(configuredJavaPath);
    if (info && info.majorVersion >= requiredMajor) return configuredJavaPath;
  }
  const alreadyDownloaded = await findJavaUnder(jreRuntimeRoot(), requiredMajor);
  if (alreadyDownloaded) return alreadyDownloaded;
  const locations = await installer.getPotentialJavaLocations();
  const found = await installer.scanLocalJava(locations);
  const match = found.find((j) => j.majorVersion >= requiredMajor);
  if (match) return match.path;
  return downloadTemurinJre(requiredMajor, onProgress);
}
export async function listJavaCandidates() {
  const results = [];
  const seen = /* @__PURE__ */ new Set();
  async function addCandidate(path2, label) {
    if (seen.has(path2)) return;
    const info = await installer.resolveJava(path2).catch(() => void 0);
    if (!info) return;
    seen.add(path2);
    results.push({ path: path2, majorVersion: info.majorVersion, label: `${label} - Java ${info.majorVersion}` });
  }
  const bundledDir = bundledJreDir();
  if (bundledDir) {
    const bundled = await findJavaExecutable(bundledDir, 2);
    if (bundled) await addCandidate(bundled, "Bundled with the launcher");
  }
  const root = jreRuntimeRoot();
  const downloadedDirs = await fsp.readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of downloadedDirs) {
    if (!entry.isDirectory() || !entry.name.startsWith("jre-")) continue;
    const found = await findJavaExecutable(path.join(root, entry.name), 4);
    if (found) await addCandidate(found, "Downloaded by this launcher");
  }
  const locations = await installer.getPotentialJavaLocations();
  const systemFound = await installer.scanLocalJava(locations);
  for (const j of systemFound) {
    await addCandidate(j.path, "Found on your system");
  }
  return results;
}
