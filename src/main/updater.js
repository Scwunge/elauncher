import electronUpdater from 'electron-updater'

let win = null

/** Sends a status update to Settings' "Check for Updates" UI - purely informational, the actual
 *  download/install flow is unchanged (autoDownload + the existing "updater:ready" -> install
 *  toast). Kept as one small event rather than wiring every autoUpdater event individually into
 *  its own IPC channel. */
function sendStatus(status, extra) {
  if (win && !win.isDestroyed()) {
    win.webContents.send('updater:status', { status, ...extra })
  }
}

export function initAutoUpdater(mainWindow) {
  win = mainWindow
  const { autoUpdater } = electronUpdater
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => sendStatus('checking'))
  autoUpdater.on('update-available', (info) => sendStatus('downloading', { version: info.version }))
  autoUpdater.on('update-not-available', (info) => sendStatus('up-to-date', { version: info.version }))
  autoUpdater.on('download-progress', (p) => sendStatus('downloading', { percent: p.percent }))
  autoUpdater.on('update-downloaded', (info) => {
    sendStatus('ready', { version: info.version })
    mainWindow.webContents.send('updater:ready')
  })
  autoUpdater.on('error', (err) => {
    console.error('[updater]', err)
    sendStatus('error', { message: err.message })
  })

  // Silent check on launch - unchanged from before, just now also reports status if the panel
  // happens to be open.
  autoUpdater.checkForUpdatesAndNotify().catch((err) => {
    console.error('[updater] check failed', err)
  })
}

/** "Check for Updates" button in Settings - same autoUpdater instance/config as the launch-time
 *  check, just triggered on demand. */
export async function checkForUpdatesManually() {
  try {
    await electronUpdater.autoUpdater.checkForUpdates()
  } catch (err) {
    console.error('[updater] manual check failed', err)
    sendStatus('error', { message: err.message })
  }
}

export function quitAndInstallUpdate() {
  electronUpdater.autoUpdater.quitAndInstall()
}
