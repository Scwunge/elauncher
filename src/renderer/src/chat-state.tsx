/**
 * EnderChat around the page: the chat itself is the EnderChat page in its tab (EnderChatTab), and
 * this is what the launcher adds to it - the unread badge on the nav rail, the live socket that
 * drives desktop notifications, and "open this chat" requests from a friend in the sidebar or a
 * clicked notification, which the tab hands to the page.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { applyMessage, sortConversations, totalUnread } from './chat-model'
import { useEnderNet } from './state'
import type { ChatMessage, Conversation, RealtimeState } from './types'

/** What the page should open next. `seq` makes a repeat of the same request still count. */
export type OpenRequest = { seq: number } & ({ conversationId: number } | { uuid: string })

interface ChatState {
  conversations: Conversation[]
  totalUnread: number
  realtime: RealtimeState
  request?: OpenRequest
  openConversation: (id: number) => void
  openDirect: (uuid: string) => void
  /** The chat tab says when it's on screen: the page is marking things read, so poll the badge. */
  setVisible: (visible: boolean) => void
}

const ChatContext = createContext<ChatState | null>(null)

export function ChatProvider({ children }: { children: ReactNode }) {
  const { session } = useEnderNet()
  const me = session.uuid
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [realtime, setRealtime] = useState<RealtimeState>('off')
  const [request, setRequest] = useState<OpenRequest>()
  const [visible, setVisible] = useState(false)
  const listRef = useRef(conversations)
  listRef.current = conversations
  const seq = useRef(0)

  const reload = useCallback(async () => {
    const r = await window.api.chat.conversations()
    if (r.ok) setConversations(sortConversations(r.data))
  }, [])

  // Connected to EnderNet: load the list and, if the player allows it, open the live socket.
  useEffect(() => {
    if (!session.connected) {
      void window.api.chat.live(false)
      setConversations([])
      return
    }
    void reload()
    window.api.settings.get().then((s) => window.api.chat.live(s.appearOnline !== false).then(setRealtime))
  }, [session.connected, reload])

  useEffect(() => window.api.chat.onState(setRealtime), [])

  useEffect(
    () =>
      window.api.chat.onEvent((event) => {
        if (event.type === 'message') {
          const { list, known } = applyMessage(listRef.current, (event as { message: ChatMessage }).message, me)
          if (known) setConversations(list)
          else void reload()
        } else if (event.type === 'conversation') {
          void reload()
        }
      }),
    [me, reload],
  )

  // While the page is on screen it's reading (and marking read) as you go, so keep the count fresh;
  // with no live socket, keep it roughly fresh in the background too.
  useEffect(() => {
    if (!session.connected) return
    if (!visible && realtime === 'live') return
    const id = setInterval(() => document.visibilityState === 'visible' && reload(), visible ? 5_000 : 30_000)
    return () => clearInterval(id)
  }, [session.connected, visible, realtime, reload])

  // Leaving the chat tab: pick up whatever was read there.
  const wasVisible = useRef(false)
  useEffect(() => {
    if (wasVisible.current && !visible) void reload()
    wasVisible.current = visible
  }, [visible, reload])

  const openConversation = useCallback((conversationId: number) => setRequest({ seq: ++seq.current, conversationId }), [])
  const openDirect = useCallback((uuid: string) => setRequest({ seq: ++seq.current, uuid }), [])

  useEffect(() => window.api.chat.onOpen(({ conversationId }) => openConversation(conversationId)), [openConversation])

  const value = useMemo<ChatState>(
    () => ({ conversations, totalUnread: totalUnread(conversations), realtime, request, openConversation, openDirect, setVisible }),
    [conversations, realtime, request, openConversation, openDirect],
  )
  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>
}

export function useChat(): ChatState {
  const ctx = useContext(ChatContext)
  if (!ctx) throw new Error('useChat outside ChatProvider')
  return ctx
}
