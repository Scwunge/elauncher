import * as electron from 'electron'
import path from 'node:path'
import { API_BASE } from './enderphone-api.js'
import { registerIpcHandlers } from './ipc.js'
import { initAutoUpdater } from './updater.js'

const isDev = !electron.app.isPackaged;

function createMainWindow() {
  const win = new electron.BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1000,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    title: "E-Launcher",
    backgroundColor: "#0D0715",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      sandbox: false,
      // The EnderNet tab embeds EnderChat, Enderbook, Endportal and the rest of the phone's web
      // pages in a <webview>, signed in with the same session the launcher already holds.
      webviewTag: true
    }
  });
  win.once("ready-to-show", () => win.show());
  if (isDev) {
    win.webContents.on("console-message", (_e, level, message, line, sourceId) => {
      console.log(`[renderer] ${message} (${sourceId}:${line})`);
    });
  }
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) electron.shell.openExternal(url);
    return { action: "deny" };
  });

  // Every <webview> is an EnderNet page and nothing else: no preload, no Node, its own partition,
  // and only the API's own origin. Decided here, in the main process, so a renderer bug can't widen it.
  const apiOrigin = new URL(API_BASE).origin;
  win.webContents.on("will-attach-webview", (event, webPreferences, params) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    params.partition = "persist:endernet";
    let origin = "";
    try {
      origin = new URL(params.src).origin;
    } catch {}
    if (origin !== apiOrigin) event.preventDefault();
  });
  win.webContents.on("did-attach-webview", (_event, contents) => {
    // Links out of an EnderNet page (a server's website, a donate page) open in the real browser -
    // payment details are never typed into a browser embedded in a game launcher.
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//.test(url)) electron.shell.openExternal(url);
      return { action: "deny" };
    });
    contents.on("will-navigate", (event, url) => {
      let origin = "";
      try {
        origin = new URL(url).origin;
      } catch {}
      if (origin !== apiOrigin) {
        event.preventDefault();
        if (/^https?:\/\//.test(url)) electron.shell.openExternal(url);
      }
    });
  });

  if (isDev && process.env["ELECTRON_RENDERER_URL"]) {
    win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
  return win;
}
electron.app.whenReady().then(() => {
  const mainWindow = createMainWindow();
  registerIpcHandlers(mainWindow);
  if (!isDev) initAutoUpdater(mainWindow);
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") electron.app.quit();
});
