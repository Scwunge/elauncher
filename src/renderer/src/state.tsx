/**
 * App-wide state that several pages need at once:
 *
 *  - Launch: the instance list, which one is selected, and the one game launch in flight. Lifted
 *    out of the Library page because Home, Servers (join straight into a server) and an instance's
 *    Worlds tab all start a launch too, and the dock at the bottom shows its progress everywhere.
 *  - EnderNet: whether the launcher holds an EnderPhone session, plus the friends list and network
 *    status the sidebar and Home both show. Polled gently, and only while the window is visible.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type {
  ConnectResult,
  EnderNetSession,
  FriendsList,
  ModpackSummary,
  NetworkStatus,
  ProgressEvent,
  QuickPlay,
} from './types'

/* ------------------------------------------------------------------------------ launch */

interface LaunchState {
  modpacks: ModpackSummary[]
  reloadModpacks: () => Promise<void>
  selectedId?: string
  select: (id: string) => void
  lastPlayed: Record<string, number>
  launchingId?: string
  progress?: ProgressEvent
  error?: string
  clearError: () => void
  play: (id: string, quickPlay?: QuickPlay) => Promise<void>
}

const LaunchContext = createContext<LaunchState | null>(null)

export function LaunchProvider({ children }: { children: ReactNode }) {
  const [modpacks, setModpacks] = useState<ModpackSummary[]>([])
  const [selectedId, setSelectedId] = useState<string>()
  const [lastPlayed, setLastPlayed] = useState<Record<string, number>>({})
  const [launchingId, setLaunchingId] = useState<string>()
  const [progress, setProgress] = useState<ProgressEvent>()
  const [error, setError] = useState<string>()

  const reloadModpacks = useCallback(async () => {
    const list = await window.api.modpacks.list()
    setModpacks(list)
    setSelectedId((prev) => (prev && list.some((m) => m.id === prev) ? prev : list[0]?.id))
  }, [])

  useEffect(() => {
    void reloadModpacks()
    window.api.modpacks.lastPlayed().then(setLastPlayed)
    window.api.settings.get().then((s) => s.selectedModpackId && setSelectedId(s.selectedModpackId))
  }, [reloadModpacks])

  useEffect(() => window.api.play.onProgress(setProgress), [])
  useEffect(
    () =>
      window.api.play.onGameExited(() => {
        setLaunchingId(undefined)
        setProgress(undefined)
      }),
    [],
  )

  const select = useCallback((id: string) => {
    setSelectedId(id)
    void window.api.settings.update({ selectedModpackId: id })
  }, [])

  const play = useCallback(
    async (id: string, quickPlay?: QuickPlay) => {
      select(id)
      setLaunchingId(id)
      setError(undefined)
      setProgress({ phase: 'checking', message: 'Getting ready...' })
      const result = await window.api.play.start(id, quickPlay ? { quickPlay } : undefined)
      if (!result.ok) {
        setLaunchingId(undefined)
        setProgress(undefined)
        setError(result.error ?? 'Something went wrong.')
        return
      }
      setLastPlayed((prev) => ({ ...prev, [id]: Date.now() }))
      // On success the launch stays "in flight" until the game exits (play:gameExited).
    },
    [select],
  )

  const value = useMemo<LaunchState>(
    () => ({
      modpacks,
      reloadModpacks,
      selectedId,
      select,
      lastPlayed,
      launchingId,
      progress,
      error,
      clearError: () => setError(undefined),
      play,
    }),
    [modpacks, reloadModpacks, selectedId, select, lastPlayed, launchingId, progress, error, play],
  )
  return <LaunchContext.Provider value={value}>{children}</LaunchContext.Provider>
}

export function useLaunch(): LaunchState {
  const ctx = useContext(LaunchContext)
  if (!ctx) throw new Error('useLaunch outside LaunchProvider')
  return ctx
}

/* ------------------------------------------------------------------------------ EnderNet */

interface EnderNetState {
  session: EnderNetSession
  /** Runs the handshake. Resolves to the raw result so a password dialog can react to it. */
  connect: (password?: string) => Promise<ConnectResult>
  disconnect: () => Promise<void>
  /** Opens the connect dialog (password prompt included) - for any "Sign in to EnderNet" button. */
  requestConnect: () => void
  dialogOpen: boolean
  closeDialog: () => void
  network?: NetworkStatus
  networkDown: boolean
  friends?: FriendsList
  reloadFriends: () => Promise<void>
  unreadNotifications: number
}

const EnderNetContext = createContext<EnderNetState | null>(null)

/** setInterval that pauses while the window is hidden, and fires once on becoming visible. */
function useVisiblePoll(fn: () => void, ms: number, enabled = true) {
  const saved = useRef(fn)
  saved.current = fn
  useEffect(() => {
    if (!enabled) return
    saved.current()
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') saved.current()
    }, ms)
    const onVisible = () => document.visibilityState === 'visible' && saved.current()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [ms, enabled])
}

export function EnderNetProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<EnderNetSession>({ connected: false })
  const [dialogOpen, setDialogOpen] = useState(false)
  const [network, setNetwork] = useState<NetworkStatus>()
  const [networkDown, setNetworkDown] = useState(false)
  const [friends, setFriends] = useState<FriendsList>()
  const [unreadNotifications, setUnread] = useState(0)

  const refreshSession = useCallback(async () => setSession(await window.api.endernet.session()), [])

  // On start: if we don't hold a session, try the silent handshake once. An account with a
  // password just stays signed out until the player chooses to connect.
  useEffect(() => {
    ;(async () => {
      const current = await window.api.endernet.session()
      if (current.connected) return setSession(current)
      const result = await window.api.endernet.connect()
      if (result.status === 'connected') await refreshSession()
    })()
  }, [refreshSession])

  const connect = useCallback(
    async (password?: string) => {
      const result = await window.api.endernet.connect(password)
      if (result.status === 'connected') await refreshSession()
      return result
    },
    [refreshSession],
  )

  const disconnect = useCallback(async () => {
    await window.api.endernet.disconnect()
    setFriends(undefined)
    setUnread(0)
    await refreshSession()
  }, [refreshSession])

  useVisiblePoll(async () => {
    const r = await window.api.endernet.status()
    if (r.ok) {
      setNetwork(r.data)
      setNetworkDown(false)
    } else setNetworkDown(true)
  }, 30_000)

  const reloadFriends = useCallback(async () => {
    const r = await window.api.endernet.friends()
    if (r.ok) setFriends(r.data)
  }, [])

  useVisiblePoll(
    async () => {
      await reloadFriends()
      const n = await window.api.endernet.notifications()
      if (n.ok) setUnread(n.data.unread)
    },
    45_000,
    session.connected,
  )

  const value = useMemo<EnderNetState>(
    () => ({
      session,
      connect,
      disconnect,
      requestConnect: () => setDialogOpen(true),
      dialogOpen,
      closeDialog: () => setDialogOpen(false),
      network,
      networkDown,
      friends,
      reloadFriends,
      unreadNotifications,
    }),
    [session, connect, disconnect, dialogOpen, network, networkDown, friends, reloadFriends, unreadNotifications],
  )
  return <EnderNetContext.Provider value={value}>{children}</EnderNetContext.Provider>
}

export function useEnderNet(): EnderNetState {
  const ctx = useContext(EnderNetContext)
  if (!ctx) throw new Error('useEnderNet outside EnderNetProvider')
  return ctx
}

/* ------------------------------------------------------------------------------ helpers */

export const LOADER_LABEL: Record<string, string> = {
  vanilla: 'Vanilla',
  fabric: 'Fabric',
  forge: 'Forge',
  neoforge: 'NeoForge',
  quilt: 'Quilt',
}

export function timeAgo(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000)
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.round(h / 24)
  if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`
  return new Date(ms).toLocaleDateString()
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}
