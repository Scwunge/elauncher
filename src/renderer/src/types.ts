/**
 * Shapes shared between the renderer and the main process, mirroring what src/preload/index.js
 * exposes on `window.api` and what src/main's IPC handlers actually return. Kept in one file
 * because both sides need to agree on them and there's no build step that would check that for us.
 */

export type ModpackSource = 'custom' | 'modrinth'
export type Loader = 'vanilla' | 'forge' | 'fabric' | 'neoforge' | 'quilt'
export type ContentKind = 'mods' | 'resourcepacks' | 'shaderpacks' | 'datapacks'
export type Edition = 'full' | 'lite'

/** `{ok: true, data}` or `{ok: false, error}` - every EnderNet/EnderPhone call comes back like this. */
export type Result<T> = { ok: true; data: T } | { ok: false; error: string; code?: string }

export interface ModpackGroup {
  id: string
  name: string
}

export interface LaunchOverride {
  minMemoryMb?: number
  maxMemoryMb?: number
  /** Raw space-separated JVM flags, e.g. "-Dfoo=bar -XX:+UseG1GC". */
  jvmArgs?: string
}

export interface ModpackSummary {
  id: string
  name: string
  summary: string
  minecraftVersion: string
  loader: Loader
  loaderVersion?: string
  iconUrl?: string
  version: string
  source: ModpackSource
  /** Present when EnderPhone is switched on for this instance. */
  enderphone?: { edition: Edition; autoUpdate: boolean }
}

export interface InstallTarget {
  id: string
  name: string
  iconUrl?: string
  minecraftVersion: string
  loader: Loader
  loaderVersion?: string
  editable: boolean
}

export interface CreateModpackInput {
  name: string
  minecraftVersion: string
  loader: Loader
  loaderVersion?: string
  iconDataUrl?: string
}

export interface CreateEnderPhoneInput extends CreateModpackInput {
  edition: Edition
  extras: ('sodium' | 'iris')[]
}

export interface ContentFile {
  name: string
  sizeBytes: number
  enabled: boolean
}

export interface WorldInfo {
  folder: string
  lastPlayed: number
  sizeBytes: number
  iconDataUrl?: string
}

export interface LogTail {
  exists: boolean
  truncated: boolean
  modifiedAt?: number
  text: string
}

export interface JavaCandidate {
  path: string
  majorVersion: number
  label: string
}

/** Full launcher theming - every value optional, since an unset key just falls back to index.css's
 *  own :root default. `colors` keys are CSS variable names without the leading `--`. */
export interface Theme {
  preset?: string
  colors?: Record<string, string>
  backgroundImage?: string
  backgroundOverlay?: number
  backgroundFit?: 'cover' | 'contain' | 'repeat'
}

export interface Settings {
  gameDirectory: string
  minMemoryMb: number
  maxMemoryMb: number
  selectedModpackId?: string
  javaPath?: string
  theme?: Theme
  whileRunning?: 'minimize' | 'hide' | 'keep'
  defaultEdition?: Edition
  appearOnline?: boolean
  chatNotifications?: boolean
}

export interface Profile {
  id: string
  name: string
  skinUrl?: string
  skinModel?: 'classic' | 'slim'
}

export type AuthStatus =
  | { status: 'signed-in'; profile: Profile }
  | { status: 'signed-out' }
  | { status: 'error'; message: string }

export type ProgressPhase =
  | 'checking'
  | 'downloading-files'
  | 'preparing-java'
  | 'installing-minecraft'
  | 'installing-loader'
  | 'launching'
  | 'done'
  | 'error'

export interface ProgressEvent {
  phase: ProgressPhase
  message: string
  fraction?: number
  bytesTransferred?: number
  totalBytes?: number
  bytesPerSecond?: number
}

export type QuickPlay = { type: 'multiplayer'; address: string; label?: string } | { type: 'singleplayer'; world: string }

export interface JavaProgressEvent {
  phase: 'preparing-java' | 'done' | 'error'
  message: string
  fraction?: number
}

export interface ModrinthProgressEvent {
  phase: 'checking' | 'downloading-files' | 'done' | 'error'
  message: string
  fraction?: number
}

export interface ModrinthHit {
  project_id: string
  project_type: string
  slug: string
  title: string
  description: string
  icon_url: string | null
  downloads: number
  follows?: number
  author: string
  latest_version: string | null
  categories?: string[]
}

export interface ModrinthSearchResult {
  hits: ModrinthHit[]
  offset: number
  limit: number
  total_hits: number
}

export interface ModrinthVersionFile {
  filename: string
  primary: boolean
  size: number
  hashes: { sha1: string; sha512?: string }
  url: string
}

export interface ModrinthVersion {
  id: string
  project_id: string
  name: string
  version_number: string
  game_versions: string[]
  loaders: string[]
  version_type: string
  date_published: string
  files: ModrinthVersionFile[]
}

export type ProjectType = 'modpack' | 'mod' | 'shader' | 'resourcepack' | 'datapack'

export interface UpdaterStatus {
  status: 'checking' | 'up-to-date' | 'downloading' | 'ready' | 'error'
  version?: string
  percent?: number
  message?: string
}

/* ------------------------------------------------------------------------------ EnderPhone */

export interface EnderPhonePref {
  enabled: boolean
  edition: Edition
  autoUpdate: boolean
}

export interface EnderPhoneStatus {
  supported: boolean
  installed: { file: string; edition: Edition; version: string; enabled: boolean } | null
  latest: { file: string; version: string; size?: number } | null
  updateAvailable: boolean
  pref: EnderPhonePref
}

export interface EnderPhoneTarget {
  minecraft: string
  loaders: ('fabric' | 'neoforge')[]
}

export interface EnderPhoneRelease {
  file: string
  edition: Edition
  loader: 'fabric' | 'neoforge'
  minecraft: string
  version: string
  size?: number
  sha1?: string
  publishedAt?: number
  latest: boolean
}

/* ------------------------------------------------------------------------------ EnderNet */

export interface EnderNetSession {
  connected: boolean
  uuid?: string
  name?: string
  kind?: 'official' | 'cracked'
  needs?: string[]
}

export type ConnectResult =
  | { status: 'connected'; uuid: string; name: string; kind: string; needs: string[] }
  | { status: 'password-required' | 'wrong-password' | 'error'; message: string }

export interface NetworkStatus {
  at: number
  api: { up: boolean; uptimeSeconds: number }
  relays: { id: string; region: string; up: boolean }[]
  online: number
  calls: number
  proximity: number
  players: { total: number; today: number; week: number }
  downloads: { total: number }
}

export interface Friend {
  uuid: string
  name: string
  since?: number
  online: boolean
  avatar?: string
}

export interface FriendsList {
  friends: Friend[]
  incoming: Friend[]
  outgoing: Friend[]
}

export interface Notification {
  id: number
  kind: string
  actorUuid: string
  actorName: string
  photoUrl?: string
  createdAt: number
  read: boolean
}

export interface RadioNow {
  station: { id: string; name: string }
  playing: { id: string; title: string; artist: string; durationMs: number } | null
  positionMs: number
  next: { title: string; artist: string } | null
}

export interface EndportalServer {
  slug: string
  name: string
  host: string
  summary: string
  tags: string[]
  versions: string
  country?: string
  banner: string | null
  featured: boolean
  online: boolean
  players: number | null
  maxPlayers: number | null
  motd?: string
  votes: number
  rating: number | null
  ratingCount: number
}

export interface EndportalList {
  servers: EndportalServer[]
  categories: { tag: string; count: number }[]
  total: number
}

export interface CapeInfo {
  cape: string | null
  canCustomise: boolean
  tier: string
  maxBytes: number
  maxSide: number
  maxFrames: number
}

export interface SiteEntry {
  slug: string
  name: string
  tagline: string
  category: string
  icon: string
  url: string
  official: boolean
  featured: boolean
}

/* ------------------------------------------------------------------------------ EnderChat */

export interface ChatMember {
  uuid: string
  name: string
  online: boolean
}

export interface Conversation {
  id: number
  kind: 'dm' | 'group'
  name: string
  members: ChatMember[]
  unread: number
  lastBody: string | null
  lastPhotoId: string | null
  lastAt: number
  ownerUuid: string | null
  /** Set for a group the server owns (EnderCloud): no leave, rename or add. */
  system: string | null
}

export interface ChatMessage {
  id: number
  conversationId: number
  fromUuid: string
  toUuid?: string | null
  body: string
  photoId?: string
  photoUrl?: string
  photoKind?: 'photo' | 'clip'
  createdAt: number
}

export type ChatEvent =
  | { type: 'message'; message: ChatMessage }
  | { type: 'conversation'; conversation: Conversation }
  | { type: string; [key: string]: unknown }

export type RealtimeState = 'off' | 'connecting' | 'live' | 'retrying' | 'signed-out'

/* ------------------------------------------------------------------------------ the bridge */

export interface LauncherApi {
  auth: {
    restore: () => Promise<AuthStatus>
    signIn: () => Promise<AuthStatus>
    signOut: () => Promise<void>
  }
  account: {
    changeSkin: (
      pngBase64: string,
      variant: 'classic' | 'slim',
    ) => Promise<{ ok: true; skinUrl: string; model: 'classic' | 'slim' } | { ok: false; error: string }>
  }
  settings: {
    get: () => Promise<Settings>
    update: (patch: Partial<Settings>) => Promise<Settings>
    chooseGameDirectory: () => Promise<string | undefined>
  }
  modpacks: {
    list: () => Promise<ModpackSummary[]>
    installTargets: () => Promise<InstallTarget[]>
    create: (input: CreateModpackInput) => Promise<{ ok: true; id: string } | { ok: false; error: string }>
    createEnderPhone: (
      input: CreateEnderPhoneInput,
    ) => Promise<{ ok: true; id: string; notes: string[] } | { ok: false; error: string }>
    update: (id: string, patch: Partial<CreateModpackInput>) => Promise<{ ok: boolean; error?: string }>
    remove: (id: string, deleteFiles: boolean) => Promise<{ ok: boolean; error?: string }>
    listContent: (id: string, kind: ContentKind) => Promise<ContentFile[]>
    removeContent: (id: string, kind: ContentKind, filename: string) => Promise<{ ok: boolean; error?: string }>
    toggleContent: (id: string, kind: ContentKind, filename: string, enabled: boolean) => Promise<{ ok: boolean; error?: string }>
    openFolder: (id: string, sub?: string) => Promise<void>
    listWorlds: (id: string) => Promise<WorldInfo[]>
    deleteWorld: (id: string, folder: string) => Promise<{ ok: boolean; error?: string }>
    readLog: (id: string) => Promise<LogTail>
    lastPlayed: () => Promise<Record<string, number>>
  }
  enderphone: {
    targets: () => Promise<Result<EnderPhoneTarget[]>>
    releases: () => Promise<Result<EnderPhoneRelease[]>>
    prefs: () => Promise<Result<Record<string, EnderPhonePref>>>
    status: (id: string) => Promise<Result<EnderPhoneStatus>>
    configure: (id: string, patch: Partial<EnderPhonePref>) => Promise<Result<{ action?: string; message: string }>>
  }
  endernet: {
    session: () => Promise<EnderNetSession>
    connect: (password?: string) => Promise<ConnectResult>
    disconnect: () => Promise<void>
    status: () => Promise<Result<NetworkStatus>>
    servers: (query?: { q?: string; tag?: string; sort?: string }) => Promise<Result<EndportalList>>
    sites: () => Promise<Result<{ sites: SiteEntry[] }>>
    account: () => Promise<Result<Record<string, unknown>>>
    friends: () => Promise<Result<FriendsList>>
    notifications: () => Promise<Result<{ unread: number; notifications: Notification[] }>>
    unread: () => Promise<Result<{ total: number }>>
    radio: () => Promise<Result<RadioNow>>
    follow: (uuid: string) => Promise<Result<unknown>>
    decline: (uuid: string) => Promise<Result<unknown>>
    searchPlayers: (q: string) => Promise<Result<{ players: { uuid: string; name: string; online: boolean }[] }>>
    cape: () => Promise<Result<CapeInfo>>
    setCape: (base64: string) => Promise<Result<{ cape: string }>>
    clearCape: () => Promise<Result<unknown>>
    pageUrl: (page: string) => Promise<Result<string>>
  }
  chat: {
    live: (on: boolean) => Promise<RealtimeState>
    state: () => Promise<RealtimeState>
    conversations: () => Promise<Result<Conversation[]>>
    onEvent: (cb: (event: ChatEvent) => void) => () => void
    onState: (cb: (state: RealtimeState) => void) => () => void
    onOpen: (cb: (req: { conversationId: number }) => void) => () => void
  }
  setup: {
    onProgress: (cb: (event: ProgressEvent) => void) => () => void
  }
  java: {
    list: () => Promise<JavaCandidate[]>
    getOverride: (modpackId: string) => Promise<string | undefined>
    setOverride: (modpackId: string, javaPath: string) => Promise<{ ok: boolean; error?: string }>
    clearOverride: (modpackId: string) => Promise<void>
    chooseFile: () => Promise<string | undefined>
    downloadVersion: (modpackId: string, majorVersion: number) => Promise<{ ok: true; path: string } | { ok: false; error: string }>
    onProgress: (cb: (event: JavaProgressEvent) => void) => () => void
  }
  groups: {
    list: () => Promise<ModpackGroup[]>
    create: (name: string) => Promise<ModpackGroup>
    rename: (id: string, name: string) => Promise<void>
    remove: (id: string) => Promise<void>
    assignments: () => Promise<Record<string, string>>
    assign: (modpackId: string, groupId: string | undefined) => Promise<void>
  }
  launchOverrides: {
    get: (modpackId: string) => Promise<LaunchOverride>
    set: (modpackId: string, patch: Partial<LaunchOverride>) => Promise<void>
  }
  modrinth: {
    search: (query: string, projectType: ProjectType, offset?: number) => Promise<ModrinthSearchResult>
    listVersions: (projectId: string, filter?: { loader?: Loader; minecraftVersion?: string }) => Promise<ModrinthVersion[]>
    installModpack: (
      hit: ModrinthHit,
      version: ModrinthVersion,
      withEnderPhone?: boolean,
    ) => Promise<{ ok: true; id: string } | { ok: false; error: string }>
    installContent: (
      targetInstanceId: string,
      kind: 'mod' | 'shader' | 'resourcepack' | 'datapack',
      file: ModrinthVersionFile,
    ) => Promise<{ ok: true } | { ok: false; error: string }>
    onProgress: (cb: (event: ModrinthProgressEvent) => void) => () => void
  }
  play: {
    start: (modpackId: string, options?: { quickPlay?: QuickPlay }) => Promise<{ ok: boolean; error?: string }>
    onProgress: (cb: (event: ProgressEvent) => void) => () => void
    onGameExited: (cb: () => void) => () => void
  }
  console: {
    getBuffer: () => Promise<{ lines: string[]; hasInstance: boolean }>
    onLines: (cb: (lines: string[]) => void) => () => void
    openCrashReports: () => Promise<void>
    openLogsFolder: () => Promise<void>
  }
  updater: {
    onReady: (cb: () => void) => () => void
    onStatus: (cb: (status: UpdaterStatus) => void) => () => void
    check: () => Promise<void>
    install: () => Promise<void>
  }
  app: {
    getVersion: () => Promise<string>
    getApiBase: () => Promise<string>
  }
  shell: {
    openExternal: (url: string) => Promise<void>
  }
}

declare global {
  interface Window {
    api: LauncherApi
  }
}
