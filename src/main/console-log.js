import fsp from 'node:fs/promises'
import path from 'node:path'

const MAX_LINES = 5e3;
let buffer = [];
let currentInstanceRoot;
export function resetConsole(instanceRoot) {
  buffer = [];
  currentInstanceRoot = instanceRoot;
}
export function getConsoleBuffer() {
  return buffer;
}
export function getConsoleInstanceRoot() {
  return currentInstanceRoot;
}
function pushLines(lines, win) {
  if (lines.length === 0) return;
  buffer.push(...lines);
  if (buffer.length > MAX_LINES) buffer.splice(0, buffer.length - MAX_LINES);
  win.webContents.send("console:lines", lines);
}
export function appendConsoleChunk(chunk, win) {
  pushLines(
    chunk.split(/\r?\n/).filter((l) => l.length > 0),
    win
  );
}
function appendConsoleNote(note, win) {
  pushLines([`[E-Launcher] ${note}`], win);
}
export async function reportLatestCrash(instanceRoot, win) {
  const dir = path.join(instanceRoot, "crash-reports");
  let names;
  try {
    names = (await fsp.readdir(dir)).filter((n) => n.endsWith(".txt"));
  } catch {
    appendConsoleNote(
      "The game exited with an error, but no crash report was found in crash-reports/.",
      win
    );
    return;
  }
  if (names.length === 0) {
    appendConsoleNote("The game exited with an error, but no crash report was found.", win);
    return;
  }
  let newest;
  for (const name of names) {
    const info = await fsp.stat(path.join(dir, name)).catch(() => void 0);
    if (info && (!newest || info.mtimeMs > newest.mtimeMs)) newest = { name, mtimeMs: info.mtimeMs };
  }
  if (!newest) return;
  const text = await fsp.readFile(path.join(dir, newest.name), "utf-8").catch(() => void 0);
  appendConsoleNote(`Crash report saved: crash-reports/${newest.name}`, win);
  if (text) pushLines(["----- " + newest.name + " -----", ...text.split(/\r?\n/)], win);
}
