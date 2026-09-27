/**
 * EnderChat in the main process: the IPC the chat tab calls, the live socket (enderchat.js), and
 * desktop notifications for messages that arrive while the launcher isn't in front.
 *
 * Notifications stay quiet while Minecraft is running - the phone in-game is already telling the
 * player, and two pings for one message is how people learn to turn notifications off.
 */
import * as electron from 'electron'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { API_BASE, api, disconnect as disconnectEnderNet, sessionSummary, token } from './enderphone-api.js'
import { createRealtime, realtimeUrl } from './enderchat.js'
import { instanceDir } from './modpacks.js'
import { getCustomModpacks, getSettings } from './store.js'

const MAX_PHOTO_BYTES = 8 * 1024 * 1024 // the API's own limit (MAX_PHOTO_BYTES in server.mjs)
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

let realtime
/** conversation id -> { name, kind, members: Map<uuid, name> }, for naming a notification. */
const known = new Map()

function remember(conversations) {
  for (const c of conversations) {
    known.set(c.id, { name: c.name, kind: c.kind, members: new Map(c.members.map((m) => [m.uuid, m.name])) })
  }
}

export function stopChat() {
  realtime?.stop()
}

/** Where a message goes: an existing conversation, or a person you have no DM with yet. */
async function sendTo(target, body, photoId) {
  if (target?.conversationId) return api.send(target.conversationId, body, photoId)
  if (target?.uuid) return api.sendDirect(target.uuid, body, photoId)
  throw new Error('Nowhere to send that.')
}

async function uploadPng(buf) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('Only PNG images can be sent.')
  if (buf.length > MAX_PHOTO_BYTES) throw new Error(`That image is ${(buf.length / 1e6).toFixed(1)}MB - the limit is 8MB.`)
  return api.uploadChatPhoto(buf)
}

/** The newest screenshots across every instance, with small thumbnails, for the chat's picker. */
async function recentScreenshots(limit = 18) {
  const found = []
  for (const pack of getCustomModpacks()) {
    const dir = path.join(instanceDir(pack.id), 'screenshots')
    const names = await fsp.readdir(dir).catch(() => [])
    for (const name of names) {
      if (!name.toLowerCase().endsWith('.png')) continue
      const file = path.join(dir, name)
      const info = await fsp.stat(file).catch(() => null)
      if (info?.isFile()) found.push({ path: file, name, instance: pack.name, takenAt: info.mtimeMs, size: info.size })
    }
  }
  found.sort((a, b) => b.takenAt - a.takenAt)
  return found.slice(0, limit).map((s) => ({
    ...s,
    thumb: electron.nativeImage.createFromPath(s.path).resize({ width: 320, quality: 'good' }).toDataURL(),
  }))
}

/** Only a PNG inside some instance's screenshots folder may be sent from disk by path. */
function assertScreenshotPath(file) {
  const resolved = path.resolve(String(file))
  const ok = getCustomModpacks().some((pack) => {
    const dir = path.join(instanceDir(pack.id), 'screenshots') + path.sep
    return resolved.startsWith(dir)
  })
  if (!ok || !resolved.toLowerCase().endsWith('.png')) throw new Error('That file is not one of your screenshots.')
  return resolved
}

/**
 * @param {electron.BrowserWindow} win
 * @param {{ handle: Function, isGameRunning: () => boolean }} deps
 */
export function registerChatHandlers(win, { handle, isGameRunning }) {
  const send = (channel, payload) => {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }

  function notify(message) {
    const settings = getSettings()
    if (settings.chatNotifications === false || isGameRunning()) return
    if (win.isFocused() || !electron.Notification.isSupported()) return
    const me = sessionSummary().uuid
    if (message.fromUuid === me) return
    const convo = known.get(message.conversationId)
    const sender = convo?.members.get(message.fromUuid) ?? 'Someone'
    const title = !convo || convo.kind !== 'group' ? sender : `${sender} in ${convo.name}`
    const body = message.body || (message.photoKind === 'clip' ? 'Sent a clip' : message.photoId ? 'Sent a photo' : '')
    const n = new electron.Notification({ title, body: body.slice(0, 180), silent: false })
    n.on('click', () => {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
      send('chat:open', { conversationId: message.conversationId })
    })
    n.show()
    win.flashFrame(true)
  }

  function onEvent(event) {
    send('chat:event', event)
    if (event.type === 'message' && event.message) {
      if (!known.has(event.message.conversationId)) {
        // A conversation we haven't listed yet (someone just added us): learn its name first.
        api.conversations().then(({ conversations }) => remember(conversations)).catch(() => {}).finally(() => notify(event.message))
      } else notify(event.message)
    } else if (event.type === 'conversation' && event.conversation) {
      remember([event.conversation])
    }
  }

  realtime = createRealtime({
    url: realtimeUrl(API_BASE),
    getToken: token,
    // Drop the token so the next getToken() runs a fresh handshake.
    onTokenRejected: () => disconnectEnderNet(),
    onEvent,
    onState: (state) => send('chat:state', state),
  })

  win.on('focus', () => win.flashFrame(false))
  electron.powerMonitor.on('resume', () => realtime.wake())
  electron.powerMonitor.on('unlock-screen', () => realtime.wake())

  /** The chat tab turns the live socket on when EnderNet is connected and "appear online" is on. */
  electron.ipcMain.handle('chat:live', (_e, on) => {
    if (on && getSettings().appearOnline !== false) realtime.start()
    else realtime.stop()
    return realtime.state
  })
  electron.ipcMain.handle('chat:state', () => realtime.state)

  handle('chat:conversations', async () => {
    const { conversations } = await api.conversations()
    remember(conversations)
    return conversations
  })
  handle('chat:messages', async (_e, id) => (await api.messages(id)).messages)
  handle('chat:send', (_e, target, body) => sendTo(target, String(body ?? '').slice(0, 1000)))
  handle('chat:sendImage', async (_e, target, base64, caption) => {
    const photo = await uploadPng(Buffer.from(String(base64), 'base64'))
    return sendTo(target, String(caption ?? '').slice(0, 1000), photo.id)
  })
  handle('chat:sendScreenshot', async (_e, target, file, caption) => {
    const photo = await uploadPng(await fsp.readFile(assertScreenshotPath(file)))
    return sendTo(target, String(caption ?? '').slice(0, 1000), photo.id)
  })
  handle('chat:screenshots', () => recentScreenshots())
  handle('chat:markRead', (_e, id) => api.markRead(id))
  handle('chat:createGroup', (_e, name, members) => api.createGroup(name, members))
  handle('chat:addMember', (_e, id, username) => api.addMember(id, username))
  handle('chat:removeMember', (_e, id, uuid) => api.removeMember(id, uuid))
  handle('chat:rename', (_e, id, name) => api.rename(id, name))
  handle('chat:leave', (_e, id) => api.leave(id))
  handle('chat:block', (_e, uuid) => api.block(uuid))
  handle('chat:report', (_e, uuid, reason) => api.report(uuid, reason))
}
