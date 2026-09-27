/**
 * The little bit of EnderChat logic the launcher itself needs (the chat UI is the EnderChat page):
 * ordering conversations and keeping the unread badge right as live messages arrive. No React and
 * no window.api here, so it's tested on its own (test/chat-model.test.mjs).
 */
import type { ChatMessage, Conversation } from './types'

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
 * A live message folded into the list: the conversation moves up, and it counts as unread unless
 * it's our own. Returns `known: false` for a conversation we don't have yet - the caller reloads.
 */
export function applyMessage(list: Conversation[], message: ChatMessage, me: string | undefined): { list: Conversation[]; known: boolean } {
  const idx = list.findIndex((c) => c.id === message.conversationId)
  if (idx < 0) return { list, known: false }
  const c = list[idx]!
  const next = [...list]
  next[idx] = {
    ...c,
    lastBody: message.body || null,
    lastPhotoId: message.photoId ?? null,
    lastAt: Math.max(c.lastAt ?? 0, message.createdAt),
    unread: message.fromUuid === me ? c.unread : c.unread + 1,
  }
  return { list: sortConversations(next), known: true }
}

export function totalUnread(list: Conversation[]): number {
  return list.reduce((n, c) => n + (c.unread || 0), 0)
}
