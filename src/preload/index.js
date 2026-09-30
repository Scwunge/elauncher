import * as electron from 'electron'

const invoke = (channel, ...args) => electron.ipcRenderer.invoke(channel, ...args)
const listen = (channel) => (cb) => {
  const listener = (_e, event) => cb(event)
  electron.ipcRenderer.on(channel, listener)
  return () => electron.ipcRenderer.removeListener(channel, listener)
}

const api = {
  auth: {
    restore: () => invoke("auth:restore"),
    signIn: () => invoke("auth:signIn"),
    signOut: () => invoke("auth:signOut")
  },
  account: {
    /** `pngBase64` is the raw file bytes, base64-encoded (no `data:` prefix). */
    changeSkin: (pngBase64, variant) => invoke("account:changeSkin", pngBase64, variant),
    /** The official capes on the Minecraft account; `setCape(null)` wears none. */
    capes: () => invoke("account:capes"),
    setCape: (capeId) => invoke("account:setCape", capeId),
    capeTexture: (texture) => invoke("account:capeTexture", texture)
  },
  settings: {
    get: () => invoke("settings:get"),
    update: (patch) => invoke("settings:update", patch),
    chooseGameDirectory: () => invoke("settings:chooseGameDirectory")
  },
  modpacks: {
    list: () => invoke("modpacks:list"),
    installTargets: () => invoke("modpacks:installTargets"),
    create: (input) => invoke("modpacks:create", input),
    createEnderPhone: (input) => invoke("modpacks:createEnderPhone", input),
    update: (id, patch) => invoke("modpacks:update", id, patch),
    remove: (id, deleteFiles) => invoke("modpacks:delete", id, deleteFiles),
    listContent: (id, kind) => invoke("modpacks:listContent", id, kind),
    removeContent: (id, kind, filename) => invoke("modpacks:removeContent", id, kind, filename),
    toggleContent: (id, kind, filename, enabled) => invoke("modpacks:toggleContent", id, kind, filename, enabled),
    openFolder: (id, sub) => invoke("modpacks:openFolder", id, sub),
    listWorlds: (id) => invoke("modpacks:listWorlds", id),
    deleteWorld: (id, folder) => invoke("modpacks:deleteWorld", id, folder),
    readLog: (id) => invoke("modpacks:readLog", id),
    lastPlayed: () => invoke("modpacks:lastPlayed")
  },
  /** EnderPhone the mod, inside an instance. */
  enderphone: {
    targets: () => invoke("enderphone:targets"),
    releases: () => invoke("enderphone:releases"),
    prefs: () => invoke("enderphone:prefs"),
    status: (id) => invoke("enderphone:status", id),
    configure: (id, patch) => invoke("enderphone:configure", id, patch)
  },
  /** EnderNet: the EnderPhone API and its pages. */
  endernet: {
    session: () => invoke("endernet:session"),
    connect: (password) => invoke("endernet:connect", password),
    disconnect: () => invoke("endernet:disconnect"),
    status: () => invoke("endernet:status"),
    servers: (query) => invoke("endernet:servers", query),
    sites: () => invoke("endernet:sites"),
    account: () => invoke("endernet:account"),
    friends: () => invoke("endernet:friends"),
    notifications: () => invoke("endernet:notifications"),
    unread: () => invoke("endernet:unread"),
    radio: () => invoke("endernet:radio"),
    follow: (uuid) => invoke("endernet:follow", uuid),
    decline: (uuid) => invoke("endernet:decline", uuid),
    searchPlayers: (q) => invoke("endernet:searchPlayers", q),
    cape: () => invoke("endernet:cape"),
    setCape: (base64) => invoke("endernet:setCape", base64),
    clearCape: () => invoke("endernet:clearCape"),
    capeImage: (url) => invoke("endernet:capeImage", url),
    pageUrl: (page) => invoke("endernet:pageUrl", page)
  },
  /** EnderChat around the page: the live socket, the conversation list, notification clicks. */
  chat: {
    live: (on) => invoke("chat:live", on),
    state: () => invoke("chat:state"),
    conversations: () => invoke("chat:conversations"),
    onEvent: listen("chat:event"),
    onState: listen("chat:state"),
    onOpen: listen("chat:open")
  },
  setup: {
    onProgress: listen("setup:progress")
  },
  java: {
    list: () => invoke("java:list"),
    getOverride: (modpackId) => invoke("java:getOverride", modpackId),
    setOverride: (modpackId, javaPath) => invoke("java:setOverride", modpackId, javaPath),
    clearOverride: (modpackId) => invoke("java:clearOverride", modpackId),
    chooseFile: () => invoke("java:chooseFile"),
    downloadVersion: (modpackId, majorVersion) => invoke("java:downloadVersion", modpackId, majorVersion),
    onProgress: listen("java:progress")
  },
  groups: {
    list: () => invoke("groups:list"),
    create: (name) => invoke("groups:create", name),
    rename: (id, name) => invoke("groups:rename", id, name),
    remove: (id) => invoke("groups:delete", id),
    assignments: () => invoke("groups:assignments"),
    assign: (modpackId, groupId) => invoke("groups:assign", modpackId, groupId)
  },
  launchOverrides: {
    get: (modpackId) => invoke("launchOverrides:get", modpackId),
    set: (modpackId, patch) => invoke("launchOverrides:set", modpackId, patch)
  },
  modrinth: {
    search: (query, projectType, offset = 0) => invoke("modrinth:search", query, projectType, offset),
    listVersions: (projectId, filter) => invoke("modrinth:listVersions", projectId, filter),
    installModpack: (hit, version, withEnderPhone) => invoke("modrinth:installModpack", hit, version, withEnderPhone),
    installContent: (targetInstanceId, kind, file) => invoke("modrinth:installContent", targetInstanceId, kind, file),
    onProgress: listen("modrinth:progress")
  },
  play: {
    start: (modpackId, options) => invoke("play:start", modpackId, options),
    onProgress: listen("play:progress"),
    onGameExited: listen("play:gameExited")
  },
  console: {
    getBuffer: () => invoke("console:getBuffer"),
    onLines: listen("console:lines"),
    openCrashReports: () => invoke("console:openCrashReports"),
    openLogsFolder: () => invoke("console:openLogsFolder")
  },
  updater: {
    onReady: listen("updater:ready"),
    onStatus: listen("updater:status"),
    check: () => invoke("updater:check"),
    install: () => invoke("updater:install")
  },
  app: {
    getVersion: () => invoke("app:getVersion"),
    getApiBase: () => invoke("app:getApiBase")
  },
  shell: {
    openExternal: (url) => invoke("shell:openExternal", url)
  }
};
electron.contextBridge.exposeInMainWorld("api", api);
