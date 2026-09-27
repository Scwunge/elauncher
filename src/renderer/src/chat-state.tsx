/**
 * EnderChat's state, app-wide so the nav badge and the sidebar see unread counts while you're on
 * another page: the conversation list, loaded threads, which one is open, and sending.
 *
 * Live updates come from the main process's socket (chat:event). When that socket is off - the
 * player turned "appear online" off, or it's reconnecting - this polls instead: the list every 20s,
 * the open thread every 5s while the chat page is on screen.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { applyMessage, findDmWith, mergeMessages, sortConversations, type UiMessage } from './chat-model'
import { useEnderNet } from './state'
import type { ChatMessage, ChatTarget, Conversation, RealtimeState, Result } from './types'

/** What the chat pane shows: a conversation, or a new DM that doesn't exist until its first message. */
export type OpenChat = { conversationId: number } | { uuid: string; name: string }

interface ChatState {
  ready: boolean
  error?: string
  conversations: Conversation[]
  totalUnread: number
  realtime: RealtimeState
  open?: OpenChat
  openConversation?: Conversation
  messages: UiMessage[] | undefined
  setOpen: (open: OpenChat | undefined) => void
  /** Opens your DM with someone, or a fresh one if you haven't talked yet. */
  openDirect: (uuid: string, name: string) => void
  /** The chat page tells us when it's on screen, so arriving messages there don't count as unread. */
  setVisible: (visible: boolean) => void
  /** Resolves to an error message when sending failed. */
  send: (text: string) => Promise<string | undefined>
  sendImage: (base64Png: string, caption: string) => Promise<string | undefined>
  sendScreenshot: (path: string, caption: string, thumb?: string) => Promise<string | undefined>
  retry: (m: UiMessage) => Promise<void>
  reload: () => Promise<void>
  /** For group actions: runs the call, reloads the list, returns the error text if it failed. */
  act: <T>(call: () => Promise<Result<T>>) => Promise<{ ok: true; data: T } | { ok: false; error: string }>
}

const ChatContext = createContext<ChatState | null>(null)

let localSeq = 0

export function ChatProvider({ children }: { children: ReactNode }) {
  const { session } = useEnderNet()
  const me = session.uuid
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [threads, setThreads] = useState<Record<number, UiMessage[]>>({})
  const [open, setOpenState] = useState<OpenChat>()
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string>()
  const [realtime, setRealtime] = useState<RealtimeState>('off')
  const [visible, setVisible] = useState(false)

  // Refs mirror state for the event handler, which is subscribed once.
  const openRef = useRef(open)
  openRef.current = open
  const visibleRef = useRef(visible)
  visibleRef.current = visible
  const listRef = useRef(conversations)
  listRef.current = conversations

  const openId = open && 'conversationId' in open ? open.conversationId : undefined

  const reload = useCallback(async () => {
    const r = await window.api.chat.conversations()
    if (r.ok) {
      setConversations(sortConversations(r.data))
      setError(undefined)
    } else setError(r.error)
    setReady(true)
  }, [])

  const loadThread = useCallback(async (id: number) => {
    const r = await window.api.chat.messages(id)
    if (r.ok) setThreads((t) => ({ ...t, [id]: mergeMessages(t[id] ?? [], r.data) }))
  }, [])

  const markRead = useCallback((id: number) => {
    setConversations((list) => list.map((c) => (c.id === id && c.unread ? { ...c, unread: 0 } : c)))
    void window.api.chat.markRead(id)
  }, [])

  // Connect when EnderNet is; the setting decides whether that includes the live socket.
  useEffect(() => {
    if (!session.connected) {
      void window.api.chat.live(false)
      setConversations([])
      setThreads({})
      setReady(false)
      return
    }
    void reload()
    window.api.settings.get().then((s) => window.api.chat.live(s.appearOnline !== false).then(setRealtime))
  }, [session.connected, reload])

  useEffect(() => window.api.chat.onState(setRealtime), [])
  useEffect(() => window.api.chat.onOpen(({ conversationId }) => setOpenState({ conversationId })), [])

  useEffect(
    () =>
      window.api.chat.onEvent((event) => {
        if (event.type === 'message') {
          const message = (event as { message: ChatMessage }).message
          const cur = openRef.current
          const openNow = cur && 'conversationId' in cur ? cur.conversationId : undefined
          const { list, known } = applyMessage(listRef.current, message, { me, openId: openNow, visible: visibleRef.current })
          if (known) setConversations(list)
          else void reload()
          setThreads((t) => (t[message.conversationId] ? { ...t, [message.conversationId]: mergeMessages(t[message.conversationId]!, [message]) } : t))
          if (openNow === message.conversationId && visibleRef.current && message.fromUuid !== me) {
            void window.api.chat.markRead(message.conversationId)
          }
        } else if (event.type === 'conversation') {
          void reload()
        }
      }),
    [me, reload],
  )

  // Opening a conversation: load its thread and clear its unread.
  useEffect(() => {
    if (openId === undefined) return
    void loadThread(openId)
    if (visible) markRead(openId)
  }, [openId, visible, loadThread, markRead])

  // Polling fallback while the socket isn't live.
  useEffect(() => {
    if (!session.connected || realtime === 'live') return
    const list = setInterval(() => document.visibilityState === 'visible' && reload(), 20_000)
    const thread = setInterval(() => {
      if (openId !== undefined && visibleRef.current && document.visibilityState === 'visible') void loadThread(openId)
    }, 5_000)
    return () => {
      clearInterval(list)
      clearInterval(thread)
    }
  }, [session.connected, realtime, openId, reload, loadThread])

  const setOpen = useCallback((next: OpenChat | undefined) => setOpenState(next), [])

  const openDirect = useCallback(
    (uuid: string, name: string) => {
      const dm = findDmWith(listRef.current, uuid, me)
      setOpenState(dm ? { conversationId: dm.id } : { uuid, name })
    },
    [me],
  )

  /** Shows a message straight away, sends it, then swaps in the real one (or marks it failed). */
  const deliver = useCallback(
    async (target: OpenChat, draft: { body: string; photoUrl?: string; photo?: boolean }, run: (t: ChatTarget) => Promise<Result<ChatMessage>>) => {
      const localKey = `local-${++localSeq}`
      const convId = 'conversationId' in target ? target.conversationId : undefined
      const temp: UiMessage = {
        id: -localSeq,
        conversationId: convId ?? -1,
        fromUuid: me ?? '',
        body: draft.body,
        photoUrl: draft.photoUrl,
        photoId: draft.photo || draft.photoUrl ? 'pending' : undefined,
        createdAt: Date.now(),
        pending: true,
        localKey,
      }
      if (convId !== undefined) setThreads((t) => ({ ...t, [convId]: mergeMessages(t[convId] ?? [], [temp]) }))
      const r = await run('conversationId' in target ? { conversationId: target.conversationId } : { uuid: target.uuid })
      if (!r.ok) {
        if (convId !== undefined) {
          setThreads((t) => ({ ...t, [convId]: (t[convId] ?? []).map((m) => (m.localKey === localKey ? { ...m, pending: false, failed: true } : m)) }))
        }
        return r.error
      }
      const real = { ...r.data, localKey }
      setThreads((t) => ({ ...t, [real.conversationId]: mergeMessages(t[real.conversationId] ?? [], [real]) }))
      const { list, known } = applyMessage(listRef.current, real, { me })
      if (known) setConversations(list)
      else {
        // A first message to someone made the DM: pick it up and switch the pane over to it.
        await reload()
        setOpenState({ conversationId: real.conversationId })
      }
      return undefined
    },
    [me, reload],
  )

  const send = useCallback(
    async (text: string) => {
      const target = openRef.current
      const body = text.trim()
      if (!target || !body) return undefined
      return deliver(target, { body }, (t) => window.api.chat.send(t, body))
    },
    [deliver],
  )

  const sendImage = useCallback(
    async (base64: string, caption: string) => {
      const target = openRef.current
      if (!target) return 'Open a conversation first.'
      return deliver(target, { body: caption, photoUrl: `data:image/png;base64,${base64}`, photo: true }, (t) => window.api.chat.sendImage(t, base64, caption))
    },
    [deliver],
  )

  const sendScreenshot = useCallback(
    async (path: string, caption: string, thumb?: string) => {
      const target = openRef.current
      if (!target) return 'Open a conversation first.'
      return deliver(target, { body: caption, photoUrl: thumb, photo: true }, (t) => window.api.chat.sendScreenshot(t, path, caption))
    },
    [deliver],
  )

  const retry = useCallback(
    async (m: UiMessage) => {
      if (!m.failed || m.photoId) return
      setThreads((t) => ({ ...t, [m.conversationId]: (t[m.conversationId] ?? []).filter((x) => x.localKey !== m.localKey) }))
      await send(m.body)
    },
    [send],
  )

  const act = useCallback(
    async <T,>(call: () => Promise<Result<T>>) => {
      const r = await call()
      await reload()
      return r.ok ? { ok: true as const, data: r.data } : { ok: false as const, error: r.error }
    },
    [reload],
  )

  const value = useMemo<ChatState>(() => {
    const openConversation = openId !== undefined ? conversations.find((c) => c.id === openId) : undefined
    return {
      ready,
      error,
      conversations,
      totalUnread: conversations.reduce((n, c) => n + (c.unread || 0), 0),
      realtime,
      open,
      openConversation,
      messages: openId !== undefined ? threads[openId] : open ? [] : undefined,
      setOpen,
      openDirect,
      setVisible,
      send,
      sendImage,
      sendScreenshot,
      retry,
      reload,
      act,
    }
  }, [ready, error, conversations, realtime, open, openId, threads, setOpen, openDirect, send, sendImage, sendScreenshot, retry, reload, act])

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>
}

export function useChat(): ChatState {
  const ctx = useContext(ChatContext)
  if (!ctx) throw new Error('useChat outside ChatProvider')
  return ctx
}
