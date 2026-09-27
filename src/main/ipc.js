import * as electron from 'electron'
import * as installer from '@xmcl/installer'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { getCachedSession, signIn, signOut, trySilentSignIn, updateCachedSkinUrl } from './auth.js'
import { registerChatHandlers, stopChat } from './chat-ipc.js'
import { appendConsoleChunk, getConsoleBuffer, getConsoleInstanceRoot, reportLatestCrash, resetConsole } from './console-log.js'
import { API_BASE, api, appPageUrl, connect as connectEnderNet, disconnect as disconnectEnderNet, sessionSummary } from './enderphone-api.js'
import * as enderphone from './enderphone-mod.js'
import { downloadTemurinJre, ensureJava, listJavaCandidates } from './java.js'
import { ensureMinecraftInstalled, launchGame } from './minecraft.js'
import { createModpack, deleteModpack, deleteWorld, instanceDir, listInstalledContent, listWorlds, readLatestLog, removeInstalledContent, toggleInstalledContent, updateModpack } from './modpacks.js'
import { installLatestModrinthProject, installModrinthContent, installModrinthModpack, listModrinthVersions, searchModrinth } from './modrinth.js'
import { fetchActiveSkinUrl, uploadSkin } from './skins.js'
import { addCustomModpack, clearJavaOverride, createGroup, deleteGroup, getAllInstanceEnderPhone, getCustomModpack, getCustomModpacks, getGroupAssignments, getGroups, getInstanceEnderPhone, getJavaOverride, getLastPlayed, getLaunchOverride, getSettings, recordLastPlayed, renameGroup, setInstanceEnderPhone, setJavaOverride, setLaunchOverride, setModpackGroup, updateCustomModpack, updateSettings } from './store.js'
import { checkForUpdatesManually, quitAndInstallUpdate } from './updater.js'

function send(win, channel, event) {
  if (!win.isDestroyed()) win.webContents.send(channel, event);
}

/** Wraps a handler so the renderer always gets `{ok: true, data}` or `{ok: false, error, code?}` -
 *  EnderNet calls fail for ordinary reasons (offline, not signed in) and none of that should
 *  surface as an uncaught IPC rejection. */
function handle(channel, fn) {
  electron.ipcMain.handle(channel, async (...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (err) {
      return { ok: false, error: err.message ?? String(err), code: err.code };
    }
  });
}

function toSummary(record) {
  const ep = getInstanceEnderPhone(record.id);
  return {
    id: record.id,
    name: record.name,
    summary: record.modrinthProjectId ? "Installed from Modrinth" : record.enderphonePreset ? "EnderPhone instance" : "Your instance",
    minecraftVersion: record.minecraftVersion,
    loader: record.loader,
    loaderVersion: record.loaderVersion,
    iconUrl: record.iconUrl,
    version: record.modrinthVersionId ?? "custom",
    source: record.modrinthProjectId ? "modrinth" : "custom",
    enderphone: ep?.enabled ? { edition: ep.edition, autoUpdate: ep.autoUpdate } : undefined
  };
}

const EXTRA_PROJECTS = {
  sodium: { slug: "sodium", label: "Sodium" },
  iris: { slug: "iris", label: "Iris Shaders" }
};

let gameRunning = false;

export function registerIpcHandlers(mainWindow) {
  const progress = (channel) => (event) => send(mainWindow, channel, event);
  registerChatHandlers(mainWindow, { handle, isGameRunning: () => gameRunning });

  /* ---------------------------------------------------------------- Minecraft account */

  electron.ipcMain.handle("auth:restore", async () => {
    const session = await trySilentSignIn();
    return session ? { status: "signed-in", profile: session.profile } : { status: "signed-out" };
  });
  electron.ipcMain.handle("auth:signIn", async () => {
    try {
      const session = await signIn();
      return { status: "signed-in", profile: session.profile };
    } catch (err) {
      return { status: "error", message: err.message ?? String(err) };
    }
  });
  electron.ipcMain.handle("auth:signOut", async () => {
    signOut();
    stopChat();
    disconnectEnderNet();
  });
  electron.ipcMain.handle("account:changeSkin", async (_e, pngBase64, variant) => {
    try {
      const session = getCachedSession() ?? await trySilentSignIn();
      if (!session) return { ok: false, error: "Sign in first." };
      const data = Buffer.from(pngBase64, "base64");
      await uploadSkin(session.accessToken, data, variant);
      const skinUrl = await fetchActiveSkinUrl(session.accessToken);
      const model = variant === "slim" ? "slim" : "classic";
      updateCachedSkinUrl(skinUrl, model);
      return { ok: true, skinUrl, model };
    } catch (err) {
      return { ok: false, error: err.message ?? String(err) };
    }
  });

  /* ---------------------------------------------------------------- settings */

  electron.ipcMain.handle("settings:get", () => getSettings());
  electron.ipcMain.handle("settings:update", (_e, patch) => updateSettings(patch));
  electron.ipcMain.handle("settings:chooseGameDirectory", async () => {
    const result = await electron.dialog.showOpenDialog(mainWindow, { properties: ["openDirectory"] });
    if (result.canceled || result.filePaths.length === 0) return void 0;
    updateSettings({ gameDirectory: result.filePaths[0] });
    return result.filePaths[0];
  });

  /* ---------------------------------------------------------------- instances */

  electron.ipcMain.handle("modpacks:list", () => getCustomModpacks().map(toSummary));
  electron.ipcMain.handle("modpacks:lastPlayed", () => getLastPlayed());
  electron.ipcMain.handle("modpacks:installTargets", () =>
    getCustomModpacks().map((p) => ({
      id: p.id,
      name: p.name,
      iconUrl: p.iconUrl,
      minecraftVersion: p.minecraftVersion,
      loader: p.loader,
      loaderVersion: p.loaderVersion,
      editable: true
    }))
  );
  electron.ipcMain.handle("modpacks:create", async (_e, input) => {
    try {
      const record = await createModpack(input);
      return { ok: true, id: record.id };
    } catch (err) {
      return { ok: false, error: err.message ?? String(err) };
    }
  });
  /**
   * The New EnderPhone Instance wizard: an instance with EnderPhone switched on, plus whatever
   * extras were ticked, all downloaded now so the first Play is just the game install.
   */
  electron.ipcMain.handle("modpacks:createEnderPhone", async (_e, input) => {
    const report = progress("setup:progress");
    try {
      const record = await createModpack(input);
      setInstanceEnderPhone(record.id, { enabled: true, edition: input.edition, autoUpdate: true });
      updateCustomModpack(record.id, { enderphonePreset: true });
      const root = instanceDir(record.id);
      const result = await enderphone.ensureInstalled(root, { ...input, edition: input.edition }, report);
      const notes = [result.message];
      for (const key of input.extras ?? []) {
        const extra = EXTRA_PROJECTS[key];
        if (!extra) continue;
        report({ phase: "downloading-files", message: `Adding ${extra.label}...` });
        const loader = input.loader === "quilt" ? "fabric" : input.loader;
        const file = await installLatestModrinthProject(extra.slug, root, { loader, minecraftVersion: input.minecraftVersion }).catch(() => null);
        notes.push(file ? `${extra.label} added.` : `${extra.label} has no build for this version yet - skipped.`);
      }
      report({ phase: "done", message: notes.join(" ") });
      return { ok: true, id: record.id, notes };
    } catch (err) {
      const message = err.message ?? String(err);
      report({ phase: "error", message });
      return { ok: false, error: message };
    }
  });
  electron.ipcMain.handle("modpacks:update", async (_e, id, patch) => {
    try {
      await updateModpack(id, patch);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message ?? String(err) };
    }
  });
  electron.ipcMain.handle("modpacks:delete", async (_e, id, deleteFiles) => {
    try {
      await deleteModpack(id, deleteFiles);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message ?? String(err) };
    }
  });
  electron.ipcMain.handle("modpacks:listContent", (_e, modpackId, kind) => listInstalledContent(modpackId, kind));
  electron.ipcMain.handle("modpacks:removeContent", async (_e, modpackId, kind, filename) => {
    try {
      await removeInstalledContent(modpackId, kind, filename);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message ?? String(err) };
    }
  });
  electron.ipcMain.handle("modpacks:toggleContent", async (_e, modpackId, kind, filename, enabled) => {
    try {
      await toggleInstalledContent(modpackId, kind, filename, enabled);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message ?? String(err) };
    }
  });
  electron.ipcMain.handle("modpacks:openFolder", async (_e, modpackId, sub) => {
    const root = instanceDir(modpackId);
    const target = typeof sub === "string" && /^[a-z-]{1,20}$/.test(sub) ? path.join(root, sub) : root;
    await mkdir(target, { recursive: true });
    await electron.shell.openPath(target);
  });
  electron.ipcMain.handle("modpacks:listWorlds", (_e, modpackId) => listWorlds(modpackId));
  electron.ipcMain.handle("modpacks:deleteWorld", async (_e, modpackId, folder) => {
    try {
      await deleteWorld(modpackId, folder);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message ?? String(err) };
    }
  });
  electron.ipcMain.handle("modpacks:readLog", (_e, modpackId) => readLatestLog(modpackId));

  /* ---------------------------------------------------------------- EnderPhone in an instance */

  handle("enderphone:targets", () => enderphone.supportedTargets());
  handle("enderphone:releases", () => enderphone.listReleases({ fresh: true }));
  handle("enderphone:prefs", () => getAllInstanceEnderPhone());
  handle("enderphone:status", async (_e, modpackId) => {
    const record = getCustomModpack(modpackId);
    if (!record) throw new Error("No such instance.");
    const pref = getInstanceEnderPhone(modpackId);
    const st = await enderphone.status(instanceDir(modpackId), { ...record, edition: pref?.edition });
    return { ...st, pref: pref ?? { enabled: false, edition: getSettings().defaultEdition ?? "full", autoUpdate: true } };
  });
  /** Turning EnderPhone on installs it right away; off removes it. Edition changes swap the jar. */
  handle("enderphone:configure", async (_e, modpackId, patch) => {
    const record = getCustomModpack(modpackId);
    if (!record) throw new Error("No such instance.");
    const pref = setInstanceEnderPhone(modpackId, patch);
    const root = instanceDir(modpackId);
    const report = progress("setup:progress");
    if (!pref.enabled) {
      await enderphone.removeFromInstance(root);
      report({ phase: "done", message: "EnderPhone removed from this instance." });
      return { message: "EnderPhone removed." };
    }
    const result = await enderphone.ensureInstalled(root, { ...record, edition: pref.edition }, report);
    report({ phase: result.action === "unsupported" ? "error" : "done", message: result.message });
    return result;
  });

  /* ---------------------------------------------------------------- EnderNet (the API) */

  electron.ipcMain.handle("endernet:session", () => sessionSummary());
  electron.ipcMain.handle("endernet:connect", (_e, password) => connectEnderNet(password));
  electron.ipcMain.handle("endernet:disconnect", () => {
    stopChat();
    disconnectEnderNet();
  });
  handle("endernet:status", () => api.status());
  handle("endernet:servers", (_e, query) => api.servers(query));
  handle("endernet:sites", () => api.sites());
  handle("endernet:account", () => api.account());
  handle("endernet:friends", () => api.friends());
  handle("endernet:notifications", () => api.notifications());
  handle("endernet:unread", () => api.unread());
  handle("endernet:radio", () => api.radio());
  handle("endernet:follow", (_e, uuid) => api.follow(uuid));
  handle("endernet:decline", (_e, uuid) => api.decline(uuid));
  handle("endernet:searchPlayers", (_e, q) => api.searchPlayers(q));
  handle("endernet:cape", () => api.cape());
  handle("endernet:setCape", (_e, base64) => api.setCape(Buffer.from(base64, "base64")));
  handle("endernet:clearCape", () => api.clearCape());
  handle("endernet:capeImage", (_e, url) => api.capeImage(url));
  handle("endernet:pageUrl", (_e, page) => appPageUrl(page));
  electron.ipcMain.handle("app:getApiBase", () => API_BASE);

  /* ---------------------------------------------------------------- Java */

  electron.ipcMain.handle("java:list", () => listJavaCandidates());
  electron.ipcMain.handle("java:getOverride", (_e, modpackId) => getJavaOverride(modpackId));
  electron.ipcMain.handle("java:setOverride", async (_e, modpackId, javaPath) => {
    const info = await installer.resolveJava(javaPath).catch(() => void 0);
    if (!info) {
      return { ok: false, error: `That doesn't look like a working Java install: ${javaPath}` };
    }
    setJavaOverride(modpackId, javaPath);
    return { ok: true };
  });
  electron.ipcMain.handle("java:clearOverride", (_e, modpackId) => clearJavaOverride(modpackId));
  electron.ipcMain.handle("java:chooseFile", async () => {
    const result = await electron.dialog.showOpenDialog(mainWindow, {
      properties: ["openFile"],
      filters: process.platform === "win32" ? [{ name: "Java executable", extensions: ["exe"] }] : void 0
    });
    if (result.canceled || result.filePaths.length === 0) return void 0;
    return result.filePaths[0];
  });
  electron.ipcMain.handle("java:downloadVersion", async (_e, modpackId, majorVersion) => {
    const report = progress("java:progress");
    try {
      const javaPath = await downloadTemurinJre(majorVersion, report);
      setJavaOverride(modpackId, javaPath);
      report({ phase: "done", message: `Java ${majorVersion} installed.` });
      return { ok: true, path: javaPath };
    } catch (err) {
      const message = err.message ?? String(err);
      report({ phase: "error", message });
      return { ok: false, error: message };
    }
  });

  /* ---------------------------------------------------------------- groups + overrides */

  electron.ipcMain.handle("groups:list", () => getGroups());
  electron.ipcMain.handle("groups:create", (_e, name) => createGroup(name));
  electron.ipcMain.handle("groups:rename", (_e, id, name) => renameGroup(id, name));
  electron.ipcMain.handle("groups:delete", (_e, id) => deleteGroup(id));
  electron.ipcMain.handle("groups:assignments", () => getGroupAssignments());
  electron.ipcMain.handle("groups:assign", (_e, modpackId, groupId) => setModpackGroup(modpackId, groupId));
  electron.ipcMain.handle("launchOverrides:get", (_e, modpackId) => getLaunchOverride(modpackId));
  electron.ipcMain.handle("launchOverrides:set", (_e, modpackId, patch) => setLaunchOverride(modpackId, patch));

  /* ---------------------------------------------------------------- Modrinth */

  electron.ipcMain.handle("modrinth:search", (_e, query, projectType, offset) => searchModrinth(query, projectType, offset));
  electron.ipcMain.handle("modrinth:listVersions", (_e, projectId, filter) => listModrinthVersions(projectId, filter));
  electron.ipcMain.handle("modrinth:installModpack", async (_e, hit, version, withEnderPhone) => {
    const report = progress("modrinth:progress");
    try {
      const id = `modrinth-${hit.slug}`;
      const root = instanceDir(id);
      report({ phase: "checking", message: `Installing ${hit.title}...` });
      const installed = await installModrinthModpack(version, root, report);
      addCustomModpack({
        id,
        name: hit.title,
        iconUrl: hit.icon_url,
        minecraftVersion: installed.minecraftVersion,
        loader: installed.loader,
        loaderVersion: installed.loaderVersion,
        modrinthProjectId: hit.project_id,
        modrinthVersionId: version.id,
        createdAt: Date.now()
      });
      let note = "";
      if (withEnderPhone) {
        const pref = setInstanceEnderPhone(id, { enabled: true, autoUpdate: true });
        const result = await enderphone.ensureInstalled(root, { ...installed, edition: pref.edition }, report);
        // No build for this pack's version: leave EnderPhone off rather than retry on every Play.
        if (result.action === "unsupported") setInstanceEnderPhone(id, { enabled: false });
        note = ` ${result.message}`;
      }
      report({ phase: "done", message: `${hit.title} installed.${note}` });
      return { ok: true, id };
    } catch (err) {
      const message = err.message ?? String(err);
      report({ phase: "error", message });
      return { ok: false, error: message };
    }
  });
  electron.ipcMain.handle("modrinth:installContent", async (_e, targetInstanceId, kind, file) => {
    const report = progress("modrinth:progress");
    try {
      report({ phase: "downloading-files", message: `Downloading ${file.filename}...` });
      await installModrinthContent(file, instanceDir(targetInstanceId), kind);
      report({ phase: "done", message: `Installed ${file.filename}.` });
      return { ok: true };
    } catch (err) {
      const message = err.message ?? String(err);
      report({ phase: "error", message });
      return { ok: false, error: message };
    }
  });

  /* ---------------------------------------------------------------- app */

  electron.ipcMain.handle("shell:openExternal", async (_e, url) => {
    // Only web links - a renderer bug must not be able to open arbitrary local files or protocols.
    if (typeof url === "string" && /^https?:\/\//.test(url)) await electron.shell.openExternal(url);
  });
  electron.ipcMain.handle("updater:install", () => quitAndInstallUpdate());
  electron.ipcMain.handle("updater:check", () => checkForUpdatesManually());
  electron.ipcMain.handle("app:getVersion", () => electron.app.getVersion());
  electron.ipcMain.handle("console:getBuffer", () => ({
    lines: getConsoleBuffer(),
    hasInstance: !!getConsoleInstanceRoot()
  }));
  electron.ipcMain.handle("console:openCrashReports", async () => {
    const root = getConsoleInstanceRoot();
    if (root) await electron.shell.openPath(path.join(root, "crash-reports"));
  });
  electron.ipcMain.handle("console:openLogsFolder", async () => {
    const root = getConsoleInstanceRoot();
    if (root) await electron.shell.openPath(path.join(root, "logs"));
  });

  /* ---------------------------------------------------------------- play */

  electron.ipcMain.handle("play:start", async (_e, modpackId, options = {}) => {
    if (gameRunning) {
      return { ok: false, error: "The game is already running." };
    }
    gameRunning = true;
    const report = progress("play:progress");
    try {
      const settings = getSettings();
      report({ phase: "checking", message: "Signing you in..." });
      const session = await trySilentSignIn() ?? await signIn();
      const root = instanceDir(modpackId);
      const record = getCustomModpack(modpackId);
      if (!record) throw new Error(`Unknown instance "${modpackId}".`);

      // EnderPhone first, so a broken download never costs a full game install before failing.
      // Never blocks Play: no build for this version, or EnderNet unreachable, just says so.
      const ep = getInstanceEnderPhone(modpackId);
      if (ep?.enabled) {
        const installedAlready = (await enderphone.installedJars(root)).length > 0;
        if (ep.autoUpdate || !installedAlready) {
          const result = await enderphone.ensureInstalled(root, { ...record, edition: ep.edition }, report).catch((err) => ({
            action: "error",
            message: `Couldn't update EnderPhone (${err.message}) - launching with what's installed.`
          }));
          report({ phase: "checking", message: result.message });
        }
      }

      const javaOverride = getJavaOverride(modpackId);
      const resolvedVersion = await ensureMinecraftInstalled(
        record,
        root,
        (requiredJavaMajor) => ensureJava(requiredJavaMajor, settings.javaPath, report, javaOverride),
        report
      );
      const javaPath = await ensureJava(resolvedVersion.javaVersion.majorVersion, settings.javaPath, report, javaOverride);
      report({ phase: "launching", message: options.quickPlay ? "Launching straight in..." : "Launching Minecraft..." });
      resetConsole(root);
      const launchOverride = getLaunchOverride(modpackId);
      const child = await launchGame({
        session,
        resolvedVersion,
        minecraftVersion: record.minecraftVersion,
        instanceRoot: root,
        javaPath,
        minMemoryMb: launchOverride.minMemoryMb ?? settings.minMemoryMb,
        maxMemoryMb: launchOverride.maxMemoryMb ?? settings.maxMemoryMb,
        extraJvmArgs: launchOverride.jvmArgs ? launchOverride.jvmArgs.split(/\s+/).filter(Boolean) : undefined,
        quickPlay: options.quickPlay
      });
      recordLastPlayed(modpackId);
      child.stdout?.on("data", (chunk) => appendConsoleChunk(chunk.toString("utf-8"), mainWindow));
      child.stderr?.on("data", (chunk) => appendConsoleChunk(chunk.toString("utf-8"), mainWindow));
      const whileRunning = settings.whileRunning ?? "minimize";
      if (whileRunning === "minimize") mainWindow.minimize();
      else if (whileRunning === "hide") mainWindow.hide();
      child.on("exit", (code) => {
        gameRunning = false;
        if (mainWindow.isDestroyed()) return;
        if (whileRunning === "hide") mainWindow.show();
        else if (whileRunning === "minimize") mainWindow.restore();
        send(mainWindow, "play:gameExited", undefined);
        if (code) void reportLatestCrash(root, mainWindow);
      });
      child.on("error", (err) => {
        gameRunning = false;
        send(mainWindow, "play:progress", { phase: "error", message: err.message });
      });
      report({ phase: "done", message: "Have fun!" });
      return { ok: true };
    } catch (err) {
      gameRunning = false;
      const message = err.message ?? String(err);
      report({ phase: "error", message });
      return { ok: false, error: message };
    }
  });
}
