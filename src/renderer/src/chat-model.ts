/**
 * EnderChat's pure logic: ordering the conversation list, folding a live message into it, merging
 * message lists without duplicates, and grouping a thread into days and runs for display. No React
 * and no window.api here, so it's tested on its own (test/chat-model.test.mjs).
 */
import type { ChatMessage, Conversation } from './types'

/** A message as the UI holds it: a sent one shows at once, before the API has answered. */
export type UiMessage = ChatMessage & { pending?: boolean; failed?: boolean; localKey?: string }

/** The server-owned everyone-group (EnderCloud) first, then newest activity. */
export function sortConversations(list: Conversation[]): Conversation[] {
  return [...list].sort((a, b) => Number(!!b.system) - Number(!!a.system) || (b.lastAt ?? 0) - (a.lastAt ?? 0) || b.id - a.id)
}

/** The other person in a DM (or you, in a note to yourself). */
export function dmPeer(c: Conversation, me: string | undefined) {
  return c.members.find((m) => m.uuid !== me) ?? c.members[0]
}

export function findDmWith(list: Conversation[], uuid: string, me: string | undefined): Conversation | undefined {
  return list.find((c) => c.kind !== 'group' && dmPeer(c, me)?.uuid === uuid)
}

/**
 * A live (or just-sent) message folded into the list: the conversation's preview and time move
 * forward, and it counts as unread unless it's ours or that conversation is open in front of us.
 * Returns the same array when the message belongs to a conversation we don't have yet - the
 * caller reloads the list for that.
 */
export function applyMessage(
  list: Conversation[],
  message: ChatMessage,
  opts: { me?: string; openId?: number; visible?: boolean },
): { list: Conversation[]; known: boolean } {
  const idx = list.findIndex((c) => c.id === message.conversationId)
  if (idx < 0) return { list, known: false }
  const c = list[idx]!
  const mine = message.fromUuid === opts.me
  const seen = opts.visible && opts.openId === c.id
  const updated: Conversation = {
    ...c,
    lastBody: message.body || null,
    lastPhotoId: message.photoId ?? null,
    lastAt: Math.max(c.lastAt ?? 0, message.createdAt),
    unread: mine || seen ? c.unread : c.unread + 1,
  }
  const next = [...list]
  next[idx] = updated
  return { list: sortConversations(next), known: true }
}

/**
 * Merges messages by id, keeping order by time. A pending message (sent here, not yet confirmed)
 * is replaced by the real one when it lands - matched by its `localKey`, or, when the live socket
 * delivers the confirmed copy first, by same sender and body.
 */
export function mergeMessages(existing: UiMessage[], incoming: UiMessage[]): UiMessage[] {
  const byId = new Map<number, UiMessage>()
  const pending: UiMessage[] = []
  for (const m of existing) {
    if (m.pending || m.failed) pending.push(m)
    else byId.set(m.id, m)
  }
  for (const m of incoming) {
    if (m.pending || m.failed) {
      if (!pending.some((p) => p.localKey === m.localKey)) pending.push(m)
      continue
    }
    byId.set(m.id, m)
    const twin = pending.findIndex((p) => (m.localKey && p.localKey === m.localKey) || (p.pending && p.fromUuid === m.fromUuid && p.body === m.body && !p.photoId === !m.photoId))
    if (twin >= 0) pending.splice(twin, 1)
  }
  const confirmed = [...byId.values()].sort((a, b) => a.createdAt - b.createdAt || a.id - b.id)
  return [...confirmed, ...pending]
}

export function previewText(c: Conversation): string {
  if (!c.lastBody && !c.lastPhotoId) return c.kind === 'group' ? `${c.members.length} members` : 'Say hi'
  return (c.lastBody || 'Photo').replace(/\s+/g, ' ').slice(0, 80)
}

export function sameDay(a: number, b: number): boolean {
  const x = new Date(a)
  const y = new Date(b)
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate()
}

export function dayLabel(ts: number, now = Date.now()): string {
  if (sameDay(ts, now)) return 'Today'
  if (sameDay(ts, now - 86_400_000)) return 'Yesterday'
  return new Date(ts).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
}

export function shortTime(ts: number, now = Date.now()): string {
  if (sameDay(ts, now)) return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (now - ts < 6 * 86_400_000) return new Date(ts).toLocaleDateString(undefined, { weekday: 'short' })
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export type ThreadItem =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'message'; key: string; message: UiMessage; head: boolean }

/** Day separators, and `head` on the first message of each run by one sender within 5 minutes. */
export function threadItems(messages: UiMessage[], now = Date.now()): ThreadItem[] {
  const out: ThreadItem[] = []
  let prev: UiMessage | undefined
  for (const m of messages) {
    if (!prev || !sameDay(prev.createdAt, m.createdAt)) {
      out.push({ kind: 'day', key: `d${m.createdAt}`, label: dayLabel(m.createdAt, now) })
      prev = undefined
    }
    const head = !prev || prev.fromUuid !== m.fromUuid || m.createdAt - prev.createdAt > 5 * 60_000
    out.push({ kind: 'message', key: m.localKey ?? String(m.id), message: m, head })
    prev = m
  }
  return out
}

/** A stable, readable colour per player name in groups (the EnderChat page's palette). */
export function nameColour(uuid: string): string {
  const palette = ['#E2C6FF', '#9EF0DC', '#FFD98A', '#FFB3C9', '#B7D0FF', '#DBDE9E', '#C9B6FF']
  let h = 0
  for (const ch of uuid) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return palette[h % palette.length]!
}

/**
 * The phone's clip container (core's ClipContainer.java): "CPV1", u16 w, u16 h, u8 fps, u8 flags,
 * u16 frames, u32 durationMs, then per frame u32 length + u32 timestamp + JPEG.
 */
export function parseClip(buf: ArrayBuffer): { width: number; height: number; fps: number; frames: { ts: number; start: number; length: number }[] } {
  const v = new DataView(buf)
  if (buf.byteLength < 16 || v.getUint32(0) !== 0x43505631 || v.getUint8(9) !== 0) throw new Error('not-a-clip')
  const clip = { width: v.getUint16(4), height: v.getUint16(6), fps: v.getUint8(8), frames: [] as { ts: number; start: number; length: number }[] }
  const n = v.getUint16(10)
  let off = 16
  for (let i = 0; i < n && off + 8 <= buf.byteLength; i++) {
    const len = v.getUint32(off)
    const ts = v.getUint32(off + 4)
    off += 8
    if (len > buf.byteLength - off) break
    clip.frames.push({ ts, start: off, length: len })
    off += len
  }
  if (!clip.frames.length) throw new Error('empty-clip')
  return clip
}
