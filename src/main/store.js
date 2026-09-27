import * as electron from 'electron'
import Store from 'electron-store'
import path from 'node:path'
import crypto from 'node:crypto'

const defaultGameDirectory = path.join(electron.app.getPath("userData"), "instances");
const schema = {
  settings: {
    type: "object",
    properties: {
      gameDirectory: { type: "string" },
      minMemoryMb: { type: "number" },
      maxMemoryMb: { type: "number" },
      selectedModpackId: { type: "string" },
      javaPath: { type: "string" },
      // Full launcher theming - per-color-token overrides + an optional background image/GIF. See
      // ThemeTab.tsx/theme-utils.ts on the renderer side; applied via CSS custom properties, so this
      // is just an opaque object as far as the main process is concerned.
      theme: { type: "object" },
      // What the launcher window does while the game runs: "minimize" (the old behaviour), "hide"
      // (tray-less hide, back on exit) or "keep" (stay open - handy with the console).
      whileRunning: { type: "string" },
      // The edition a NEW instance gets when EnderPhone is switched on for it. Per-instance choice
      // after that lives in instanceEnderPhone below.
      defaultEdition: { type: "string" }
    },
    default: {
      gameDirectory: defaultGameDirectory,
      minMemoryMb: 2048,
      maxMemoryMb: 4096,
      whileRunning: "minimize",
      defaultEdition: "full"
    }
  },
  account: {
    type: "object"
  },
  customModpacks: {
    type: "array",
    default: []
  },
  javaOverrides: {
    type: "object",
    default: {}
  },
  // Instance organization - groups are a separate list from the instances themselves. Assignment
  // is a flat { [modpackId]: groupId } map rather than storing memberIds on the group, so removing
  // or renaming an instance never needs to touch group records at all.
  modpackGroups: {
    type: "array",
    default: [] // { id, name }
  },
  modpackGroupAssignments: {
    type: "object",
    default: {} // { [modpackId]: groupId }
  },
  // Per-instance launch overrides beyond just Java path (which javaOverrides already covers) -
  // memory and extra JVM args a specific instance needs, distinct from the global settings.
  launchOverrides: {
    type: "object",
    default: {} // { [modpackId]: { minMemoryMb?, maxMemoryMb?, jvmArgs? } }
  },
  // When each instance was last successfully launched (ms epoch) - drives the "recent" sort and the
  // Home tab's "Jump back in" card. Recorded once the game process actually spawns.
  lastPlayed: {
    type: "object",
    default: {} // { [modpackId]: number }
  },
  // Whether EnderPhone is managed in an instance, and how. See enderphone-mod.js.
  // { [modpackId]: { enabled: boolean, edition: "full"|"lite", autoUpdate: boolean } }
  instanceEnderPhone: {
    type: "object",
    default: {}
  },
  // The EnderPhone API session (see enderphone-api.js) - a bearer token the API minted after the
  // Mojang handshake, with the time we stop trusting it. Never the player's password.
  enderphoneSession: {
    type: "object"
  },
  // Last-known-good release feed, so an instance can still be checked (and launched) offline.
  releaseCache: {
    type: "array",
    default: []
  }
};
const store = new Store({ schema });
export function getSettings() {
  return store.get("settings");
}
export function updateSettings(patch) {
  const next = { ...store.get("settings"), ...patch };
  store.set("settings", next);
  return next;
}
export function getPersistedAccount() {
  return store.get("account");
}
export function setPersistedAccount(account) {
  if (account) store.set("account", account);
  else store.delete("account");
}
export function getCustomModpacks() {
  return store.get("customModpacks", []);
}
export function getCustomModpack(id) {
  return getCustomModpacks().find((r) => r.id === id);
}
export function addCustomModpack(record) {
  const next = getCustomModpacks().filter((r) => r.id !== record.id);
  next.push(record);
  store.set("customModpacks", next);
}
export function updateCustomModpack(id, patch) {
  const next = getCustomModpacks().map((r) => r.id === id ? { ...r, ...patch } : r);
  store.set("customModpacks", next);
}
export function removeCustomModpack(id) {
  store.set(
    "customModpacks",
    getCustomModpacks().filter((r) => r.id !== id)
  );
  const ep = { ...store.get("instanceEnderPhone", {}) };
  delete ep[id];
  store.set("instanceEnderPhone", ep);
}
export function getJavaOverride(modpackId) {
  return store.get("javaOverrides", {})[modpackId];
}
export function setJavaOverride(modpackId, javaPath) {
  store.set("javaOverrides", { ...store.get("javaOverrides", {}), [modpackId]: javaPath });
}
export function clearJavaOverride(modpackId) {
  const next = { ...store.get("javaOverrides", {}) };
  delete next[modpackId];
  store.set("javaOverrides", next);
}

export function getGroups() {
  return store.get("modpackGroups", []);
}
export function createGroup(name) {
  const group = { id: crypto.randomUUID(), name };
  store.set("modpackGroups", [...getGroups(), group]);
  return group;
}
export function renameGroup(id, name) {
  store.set("modpackGroups", getGroups().map((g) => g.id === id ? { ...g, name } : g));
}
export function deleteGroup(id) {
  store.set("modpackGroups", getGroups().filter((g) => g.id !== id));
  // Ungroup anything that was in it rather than leave a dangling groupId pointing nowhere.
  const assignments = { ...store.get("modpackGroupAssignments", {}) };
  for (const modpackId of Object.keys(assignments)) {
    if (assignments[modpackId] === id) delete assignments[modpackId];
  }
  store.set("modpackGroupAssignments", assignments);
}
export function getGroupAssignments() {
  return store.get("modpackGroupAssignments", {});
}
export function setModpackGroup(modpackId, groupId) {
  const next = { ...store.get("modpackGroupAssignments", {}) };
  if (groupId) next[modpackId] = groupId;
  else delete next[modpackId];
  store.set("modpackGroupAssignments", next);
}

export function getLaunchOverride(modpackId) {
  return store.get("launchOverrides", {})[modpackId] ?? {};
}
export function setLaunchOverride(modpackId, patch) {
  const next = { ...store.get("launchOverrides", {}) };
  const merged = { ...next[modpackId], ...patch };
  // Drop keys explicitly reset to undefined/null (e.g. "use global default" in the UI) instead
  // of persisting them as null forever.
  for (const k of Object.keys(merged)) if (merged[k] == null) delete merged[k];
  if (Object.keys(merged).length === 0) delete next[modpackId];
  else next[modpackId] = merged;
  store.set("launchOverrides", next);
}

export function getLastPlayed() {
  return store.get("lastPlayed", {});
}
export function recordLastPlayed(modpackId) {
  store.set("lastPlayed", { ...getLastPlayed(), [modpackId]: Date.now() });
}

export function getInstanceEnderPhone(modpackId) {
  return store.get("instanceEnderPhone", {})[modpackId];
}
export function getAllInstanceEnderPhone() {
  return store.get("instanceEnderPhone", {});
}
export function setInstanceEnderPhone(modpackId, patch) {
  const all = { ...store.get("instanceEnderPhone", {}) };
  const current = all[modpackId] ?? { enabled: false, edition: getSettings().defaultEdition ?? "full", autoUpdate: true };
  all[modpackId] = { ...current, ...patch };
  store.set("instanceEnderPhone", all);
  return all[modpackId];
}

export function getEnderPhoneSession() {
  return store.get("enderphoneSession");
}
export function setEnderPhoneSession(session) {
  if (session) store.set("enderphoneSession", session);
  else store.delete("enderphoneSession");
}

export function getReleaseCache() {
  return store.get("releaseCache", []);
}
export function setReleaseCache(releases) {
  store.set("releaseCache", releases);
}
