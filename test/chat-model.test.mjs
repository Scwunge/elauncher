/** The launcher's EnderChat logic (src/renderer/src/chat-model.ts): list order and the unread badge. */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { applyMessage, findDmWith, sortConversations, totalUnread } from '../src/renderer/src/chat-model.ts'

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

describe('EnderChat badge and list', () => {
  it('pins EnderCloud, then newest first', () => {
    const list = sortConversations([convo(1), convo(3), convo(2, { kind: 'group', system: 'endercloud', lastAt: 0 })])
    assert.deepEqual(list.map((c) => c.id), [2, 3, 1])
  })

  it('a message from someone else bumps the chat and counts unread', () => {
    const { list, known } = applyMessage([convo(1), convo(2)], msg(10, 1, 'peer-1', 9000, 'yo'), ME)
    assert.equal(known, true)
    assert.equal(list[0].id, 1)
    assert.equal(list[0].unread, 1)
    assert.equal(list[0].lastBody, 'yo')
    assert.equal(totalUnread(list), 1)
  })

  it('does not count your own message (sent from the phone, say)', () => {
    assert.equal(applyMessage([convo(1)], msg(10, 1, ME, 9000), ME).list[0].unread, 0)
  })

  it('reports a message for a conversation it does not have, so the list gets reloaded', () => {
    const before = [convo(1)]
    const { list, known } = applyMessage(before, msg(10, 99, 'x', 1), ME)
    assert.equal(known, false)
    assert.equal(list, before)
  })

  it('finds your DM with someone, and not a group they are in', () => {
    const list = [convo(1), convo(2, { kind: 'group', members: [{ uuid: 'peer-2', name: 'P', online: false }] })]
    assert.equal(findDmWith(list, 'peer-1', ME)?.id, 1)
    assert.equal(findDmWith(list, 'peer-2', ME), undefined)
  })

  it('adds up unread across every chat', () => {
    assert.equal(totalUnread([convo(1, { unread: 3 }), convo(2, { unread: 0 }), convo(3, { unread: 9 })]), 12)
  })
})
