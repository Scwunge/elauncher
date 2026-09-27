/**
 * EnderChat's live connection: the API's realtime socket (`/v1/ws`), the same one the phone opens
 * in-game. The API pushes `{type: 'message'}` to every socket a player holds, so with this open a
 * message sent from the phone, the EnderChat page or another player shows up in the launcher the
 * moment it's sent - and one sent from the launcher shows up in the game.
 *
 * Holding this socket also shows the player as online to their friends, exactly as the phone does.
 * That's why it's a setting ("Appear online while E-Launcher is open"): with it off, the chat tab
 * still works, it just polls instead.
 *
 * Text frames only. Binary frames on this socket are call and proximity-voice media, which the
 * launcher never takes part in, so they're dropped on arrival.
 *
 * Written against injectable parts (token source, WebSocket class, timers) so the tests can drive
 * it against a real local server without Electron.
 */
import WebSocket from 'ws'

const PING_EVERY_MS = 25_000
const PONG_WAIT_MS = 10_000
const BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 20_000, 30_000]

/** http(s)://host -> ws(s)://host/v1/ws */
export function realtimeUrl(apiBase) {
  return `${apiBase.replace(/^http/, 'ws').replace(/\/+$/, '')}/v1/ws`
}

/**
 * @param {object} o
 * @param {string} o.url
 * @param {() => Promise<string>} o.getToken   throws an error with `.code` when there's no session
 * @param {() => void} [o.onTokenRejected]     the socket refused our token: drop it so the next
 *                                             getToken() runs a fresh handshake
 * @param {(event: object) => void} o.onEvent
 * @param {(state: string) => void} [o.onState] 'off' | 'connecting' | 'live' | 'retrying' | 'signed-out'
 */
export function createRealtime({ url, getToken, onTokenRejected, onEvent, onState = () => {}, WebSocketImpl = WebSocket, backoff = BACKOFF_MS }) {
  let ws
  let running = false
  let state = 'off'
  let attempt = 0
  let rejectedInARow = 0
  let retryTimer
  let pingTimer
  let pongTimer

  function setState(next) {
    if (next === state) return
    state = next
    onState(next)
  }

  function clearTimers() {
    clearTimeout(retryTimer)
    clearInterval(pingTimer)
    clearTimeout(pongTimer)
    retryTimer = pingTimer = pongTimer = undefined
  }

  function scheduleRetry() {
    if (!running) return
    clearTimers()
    const base = backoff[Math.min(attempt, backoff.length - 1)]
    attempt += 1
    setState('retrying')
    // A little jitter, so every launcher doesn't reconnect in the same second after an API restart.
    retryTimer = setTimeout(connect, base + Math.floor(Math.random() * base * 0.2))
  }

  async function connect() {
    if (!running) return
    setState('connecting')
    let token
    try {
      token = await getToken()
    } catch (err) {
      if (err?.code && err.code !== 'error') {
        // No session we can get without the player (not signed in, or a password is needed).
        running = false
        setState('signed-out')
        return
      }
      scheduleRetry()
      return
    }
    if (!running) return

    const socket = new WebSocketImpl(url, { headers: { authorization: `Bearer ${token}` } })
    ws = socket

    socket.on('open', () => {
      if (ws !== socket) return
      attempt = 0
      rejectedInARow = 0
      setState('live')
      pingTimer = setInterval(() => {
        clearTimeout(pongTimer)
        pongTimer = setTimeout(() => socket.terminate(), PONG_WAIT_MS)
        try {
          socket.ping()
        } catch {
          socket.terminate()
        }
      }, PING_EVERY_MS)
    })
    socket.on('pong', () => clearTimeout(pongTimer))
    socket.on('message', (data, isBinary) => {
      if (isBinary) return
      let event
      try {
        event = JSON.parse(data.toString('utf8'))
      } catch {
        return
      }
      if (event && typeof event.type === 'string') onEvent(event)
    })
    // The API answers a bad token with a plain 401 instead of upgrading.
    socket.on('unexpected-response', (_req, res) => {
      if (res.statusCode === 401) {
        rejectedInARow += 1
        onTokenRejected?.()
      }
      socket.terminate()
    })
    socket.on('error', () => {
      // 'close' follows and decides what happens next.
    })
    socket.on('close', (code) => {
      if (ws !== socket) return
      ws = undefined
      clearTimers()
      if (!running) {
        setState('off')
        return
      }
      // 4001: the account behind this uuid stopped existing (merged into another). Don't hammer.
      if (code === 4001 || rejectedInARow >= 2) {
        running = false
        setState('signed-out')
        return
      }
      scheduleRetry()
    })
  }

  return {
    start() {
      if (running) return
      running = true
      attempt = 0
      rejectedInARow = 0
      void connect()
    },
    stop() {
      running = false
      clearTimers()
      if (ws) {
        const socket = ws
        ws = undefined
        socket.removeAllListeners('message')
        try {
          socket.close(1000, 'bye')
        } catch {
          socket.terminate()
        }
      }
      setState('off')
    },
    /** After sleep or a network change: skip the backoff wait and try now. */
    wake() {
      if (!running) return
      if (state === 'retrying') {
        clearTimers()
        attempt = 0
        void connect()
      } else if (state === 'live' && ws) {
        // A socket that slept through a network change looks open but isn't; the ping finds out.
        try {
          ws.ping()
        } catch {
          ws.terminate()
        }
      }
    },
    get state() {
      return state
    },
  }
}
