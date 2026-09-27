/** EnderChat's pure logic (src/renderer/src/chat-model.ts), run straight from TypeScript. */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { applyMessage, findDmWith, mergeMessages, parseClip, sortConversations, threadItems } from '../src/renderer/src/chat-model.ts'

const ME = 'me-uuid'
const convo = (id, extra = {}) => ({
  id,
  kind: 'dm',
  name: `c${id}`,
  members: [
    { uuid: ME, name: 'Me', online: true },
    { uuid: `peer-${id}`, name: `Peer${id}`, online: false },
  ],
  unread: 0,
  lastBody: null,
  lastPhotoId: null,
  lastAt: id * 1000,
  ownerUuid: null,
  system: null,
  ...extra,
})
const msg = (id, conversationId, fromUuid, createdAt, body = `m${id}`) => ({ id, conversationId, fromUuid, body, createdAt })

describe('conversation list', () => {
  it('pins EnderCloud, then newest first', () => {
    const list = sortConversations([convo(1), convo(3), convo(2, { kind: 'group', system: 'endercloud', lastAt: 0 })])
    assert.deepEqual(list.map((c) => c.id), [2, 3, 1])
  })

  it('a message from someone else bumps the chat and counts unread', () => {
    const { list, known } = applyMessage([convo(1), convo(2)], msg(10, 1, 'peer-1', 9000, 'yo'), { me: ME })
    assert.equal(known, true)
    assert.equal(list[0].id, 1)
    assert.equal(list[0].unread, 1)
    assert.equal(list[0].lastBody, 'yo')
  })

  it('does not count your own message, or one in the chat you are looking at', () => {
    assert.equal(applyMessage([convo(1)], msg(10, 1, ME, 9000), { me: ME }).list[0].unread, 0)
    assert.equal(applyMessage([convo(1)], msg(11, 1, 'peer-1', 9000), { me: ME, openId: 1, visible: true }).list[0].unread, 0)
    assert.equal(applyMessage([convo(1)], msg(12, 1, 'peer-1', 9000), { me: ME, openId: 1, visible: false }).list[0].unread, 1)
  })

  it('reports a message for a conversation it does not have', () => {
    const before = [convo(1)]
    const { list, known } = applyMessage(before, msg(10, 99, 'x', 1), { me: ME })
    assert.equal(known, false)
    assert.equal(list, before)
  })

  it('finds your DM with someone', () => {
    const list = [convo(1), convo(2, { kind: 'group', members: [{ uuid: 'peer-2', name: 'P', online: false }] })]
    assert.equal(findDmWith(list, 'peer-1', ME)?.id, 1)
    assert.equal(findDmWith(list, 'peer-2', ME), undefined, 'a group is not a DM')
  })
})

describe('merging messages', () => {
  it('de-duplicates by id and keeps time order', () => {
    const merged = mergeMessages([msg(2, 1, 'a', 200), msg(1, 1, 'a', 100)], [msg(2, 1, 'a', 200), msg(3, 1, 'b', 300)])
    assert.deepEqual(merged.map((m) => m.id), [1, 2, 3])
  })

  it('swaps a pending message for the confirmed one, by key', () => {
    const pending = { ...msg(-1, 1, ME, 500, 'hello'), pending: true, localKey: 'local-1' }
    const merged = mergeMessages([msg(1, 1, 'a', 100), pending], [{ ...msg(7, 1, ME, 501, 'hello'), localKey: 'local-1' }])
    assert.deepEqual(merged.map((m) => [m.id, !!m.pending]), [[1, false], [7, false]])
  })

  it('also when the live socket delivers the confirmed copy first', () => {
    const pending = { ...msg(-1, 1, ME, 500, 'hello'), pending: true, localKey: 'local-1' }
    const merged = mergeMessages([pending], [msg(7, 1, ME, 501, 'hello')])
    assert.deepEqual(merged.map((m) => m.id), [7])
  })

  it('keeps a failed message at the end so it can be retried', () => {
    const failed = { ...msg(-2, 1, ME, 50, 'oops'), failed: true, localKey: 'local-2' }
    const merged = mergeMessages([failed], [msg(1, 1, 'a', 100)])
    assert.deepEqual(merged.map((m) => m.id), [1, -2])
  })
})

describe('thread layout', () => {
  it('puts a day separator between days and groups runs by sender', () => {
    const day1 = new Date(2026, 8, 20, 12, 0).getTime()
    const day2 = new Date(2026, 8, 21, 12, 0).getTime()
    const items = threadItems(
      [msg(1, 1, 'a', day1), msg(2, 1, 'a', day1 + 60_000), msg(3, 1, 'b', day1 + 120_000), msg(4, 1, 'b', day1 + 20 * 60_000), msg(5, 1, 'b', day2)],
      day2 + 1000,
    )
    assert.deepEqual(
      items.map((i) => (i.kind === 'day' ? i.label : `${i.message.id}${i.head ? '*' : ''}`)),
      [items[0].label, '1*', '2', '3*', '4*', 'Today', '5*'],
    )
  })
})

describe('clips', () => {
  function clipBytes(frames) {
    const parts = frames.map((f) => f.jpeg.length + 8).reduce((a, b) => a + b, 0)
    const buf = new ArrayBuffer(16 + parts)
    const v = new DataView(buf)
    v.setUint32(0, 0x43505631)
    v.setUint16(4, 320)
    v.setUint16(6, 180)
    v.setUint8(8, 10)
    v.setUint8(9, 0)
    v.setUint16(10, frames.length)
    let off = 16
    for (const f of frames) {
      v.setUint32(off, f.jpeg.length)
      v.setUint32(off + 4, f.ts)
      new Uint8Array(buf, off + 8, f.jpeg.length).set(f.jpeg)
      off += 8 + f.jpeg.length
    }
    return buf
  }

  it('reads the phone clip container', () => {
    const clip = parseClip(clipBytes([{ ts: 0, jpeg: [1, 2, 3] }, { ts: 100, jpeg: [4, 5] }]))
    assert.equal(clip.width, 320)
    assert.equal(clip.frames.length, 2)
    assert.deepEqual(clip.frames.map((f) => [f.ts, f.length]), [[0, 3], [100, 2]])
  })

  it('refuses anything else', () => {
    assert.throws(() => parseClip(new Uint8Array([137, 80, 78, 71, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]).buffer), /not-a-clip/)
  })
})
