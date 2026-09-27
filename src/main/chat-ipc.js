/**
 * EnderChat in the main process. The chat itself is the EnderChat page in its tab; what lives here
 * is what the launcher adds around it: the live socket (enderchat.js), desktop notifications for
 * messages that arrive while the launcher isn't in front, and the conversation list for the badge.
 *
 * Notifications stay quiet while Minecraft is running - the phone in-game is already telling the
 * player, and two pings for one message is how people learn to turn notifications off.
 */
import * as electron from 'electron'
import { API_BASE, api, disconnect as disconnectEnderNet, sessionSummary, token } from './enderphone-api.js'
import { createRealtime, realtimeUrl } from './enderchat.js'
import { getSettings } from './store.js'

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

  /** Turned on when EnderNet is connected and "appear online" is on. */
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
}
