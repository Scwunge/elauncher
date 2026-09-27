/**
 * The live socket (src/main/enderchat.js) against a real local WebSocket server: the bearer token
 * goes in the handshake, text events come through, binary media is dropped, a dropped connection
 * comes back, and a refused token ends in 'signed-out' instead of a reconnect loop.
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { WebSocketServer } from 'ws'
import { createRealtime, realtimeUrl } from '../src/main/enderchat.js'

let server
let wss
let base
const accepted = new Set(['good-token'])
const sockets = []
const seenAuth = []

before(async () => {
  server = http.createServer()
  wss = new WebSocketServer({ noServer: true })
  server.on('upgrade', (req, socket, head) => {
    const auth = req.headers.authorization ?? ''
    seenAuth.push(auth)
    if (!accepted.has(auth.replace(/^Bearer /, ''))) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => sockets.push(ws))
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`
})
after(() => {
  wss.close()
  server.close()
})

function waitFor(pred, ms = 3000) {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const tick = () => {
      if (pred()) return resolve()
      if (Date.now() - start > ms) return reject(new Error('timed out'))
      setTimeout(tick, 10)
    }
    tick()
  })
}

describe('realtime socket', () => {
  it('builds the socket URL from the API base', () => {
    assert.equal(realtimeUrl('https://api.enderphone.cloud'), 'wss://api.enderphone.cloud/v1/ws')
    assert.equal(realtimeUrl('http://127.0.0.1:8799/'), 'ws://127.0.0.1:8799/v1/ws')
  })

  it('connects with the token, passes text events on and drops binary frames', async () => {
    const events = []
    const states = []
    const rt = createRealtime({
      url: realtimeUrl(base),
      getToken: async () => 'good-token',
      onEvent: (e) => events.push(e),
      onState: (s) => states.push(s),
    })
    rt.start()
    await waitFor(() => rt.state === 'live')
    assert.equal(seenAuth.at(-1), 'Bearer good-token')
    const ws = sockets.at(-1)
    ws.send(Buffer.from([1, 2, 3, 4]), { binary: true })
    ws.send('not json')
    ws.send(JSON.stringify({ type: 'message', message: { id: 1, body: 'hi' } }))
    await waitFor(() => events.length === 1)
    assert.deepEqual(events, [{ type: 'message', message: { id: 1, body: 'hi' } }])
    rt.stop()
    assert.equal(rt.state, 'off')
    assert.deepEqual(states.slice(0, 2), ['connecting', 'live'])
  })

  it('comes back after the server drops it', async () => {
    let tokens = 0
    const rt = createRealtime({
      url: realtimeUrl(base),
      getToken: async () => {
        tokens += 1
        return 'good-token'
      },
      onEvent: () => {},
      backoff: [20],
    })
    rt.start()
    await waitFor(() => rt.state === 'live')
    sockets.at(-1).terminate()
    await waitFor(() => rt.state === 'retrying' || rt.state === 'connecting')
    await waitFor(() => rt.state === 'live')
    assert.equal(tokens, 2, 'asks for a token again on reconnect')
    rt.stop()
  })

  it('drops a refused token, retries with a fresh one, and gives up after two refusals', async () => {
    let rejected = 0
    let calls = 0
    const rt = createRealtime({
      url: realtimeUrl(base),
      getToken: async () => {
        calls += 1
        return 'stale-token'
      },
      onTokenRejected: () => {
        rejected += 1
      },
      onEvent: () => {},
      backoff: [10],
    })
    rt.start()
    await waitFor(() => rt.state === 'signed-out')
    assert.equal(rejected, 2)
    assert.equal(calls, 2)
  })

  it('stays signed out when there is no session to get', async () => {
    const rt = createRealtime({
      url: realtimeUrl(base),
      getToken: async () => {
        throw Object.assign(new Error('Enter your EnderPhone password.'), { code: 'password-required' })
      },
      onEvent: () => {},
    })
    rt.start()
    await waitFor(() => rt.state === 'signed-out')
  })
})
