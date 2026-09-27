import { useEffect, useMemo, useState, type MouseEvent } from 'react'
import { LOADER_LABEL, formatBytes, timeAgo, useLaunch } from '../state'
import type { ContentFile, ContentKind, EnderPhoneStatus, LogTail, ModpackSummary, ProgressEvent, WorldInfo } from '../types'
import Icon from './Icon'
import InstanceIcon from './InstanceIcon'

interface Props {
  modpack: ModpackSummary
  onBack: () => void
  onEdit: () => void
  onOpenLaunchSettings: () => void
  onOpenMoreMenu: (e: MouseEvent) => void
}

type SubTab = 'enderphone' | 'content' | 'worlds' | 'logs'

const SUBTABS: { id: SubTab; label: string; icon: string }[] = [
  { id: 'enderphone', label: 'EnderPhone', icon: 'phone' },
  { id: 'content', label: 'Content', icon: 'cube' },
  { id: 'worlds', label: 'Worlds', icon: 'world' },
  { id: 'logs', label: 'Logs', icon: 'log' },
]

export default function InstanceDetailPage({ modpack, onBack, onEdit, onOpenLaunchSettings, onOpenMoreMenu }: Props) {
  const { launchingId, play } = useLaunch()
  const [subTab, setSubTab] = useState<SubTab>('enderphone')

  return (
    <div className="instance-page">
      <button className="back-link" onClick={onBack}>
        <Icon name="back" size={16} /> Library
      </button>

      <div className="instance-header">
        <InstanceIcon pack={modpack} size={72} />
        <div className="instance-header-info">
          <h2>{modpack.name}</h2>
          <div className="instance-header-meta">
            <span>{LOADER_LABEL[modpack.loader]}</span>
            <span>{modpack.minecraftVersion}</span>
            {modpack.source === 'modrinth' && <span>Modrinth pack</span>}
            {modpack.enderphone && (
              <span className="ep-badge">
                <Icon name="phone" size={12} /> {modpack.enderphone.edition === 'lite' ? 'EnderPhone Lite' : 'EnderPhone'}
              </span>
            )}
          </div>
        </div>
        <button className="play-button" disabled={!!launchingId} onClick={() => play(modpack.id)}>
          <Icon name="play" size={18} /> {launchingId === modpack.id ? 'Starting…' : 'Play'}
        </button>
        <button className="icon-button" title="Edit" onClick={onEdit}>
          <Icon name="gear" size={17} />
        </button>
        <button className="icon-button" title="Launch settings" onClick={onOpenLaunchSettings}>
          <Icon name="terminal" size={17} />
        </button>
        <button className="icon-button" title="More" onClick={onOpenMoreMenu}>
          <Icon name="more" size={17} />
        </button>
      </div>

      <div className="instance-subtabs">
        {SUBTABS.map((t) => (
          <button key={t.id} className={`tab-pill${subTab === t.id ? ' active' : ''}`} onClick={() => setSubTab(t.id)}>
            <Icon name={t.icon} size={15} /> {t.label}
          </button>
        ))}
      </div>

      {subTab === 'enderphone' ? (
        <EnderPhonePanel modpack={modpack} />
      ) : subTab === 'content' ? (
        <ContentPanel modpack={modpack} />
      ) : subTab === 'worlds' ? (
        <WorldsPanel modpack={modpack} />
      ) : (
        <LogsPanel modpack={modpack} />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------------------ EnderPhone */

function EnderPhonePanel({ modpack }: { modpack: ModpackSummary }) {
  const { reloadModpacks } = useLaunch()
  const [status, setStatus] = useState<EnderPhoneStatus>()
  const [loadError, setLoadError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<ProgressEvent>()
  const [message, setMessage] = useState<{ text: string; bad?: boolean }>()

  async function load() {
    const r = await window.api.enderphone.status(modpack.id)
    if (r.ok) {
      setStatus(r.data)
      setLoadError(undefined)
    } else setLoadError(r.error)
  }
  useEffect(() => {
    setStatus(undefined)
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modpack.id])
  useEffect(() => window.api.setup.onProgress(setProgress), [])

  async function configure(patch: Parameters<typeof window.api.enderphone.configure>[1]) {
    setBusy(true)
    setMessage(undefined)
    setProgress(undefined)
    const r = await window.api.enderphone.configure(modpack.id, patch)
    setBusy(false)
    setProgress(undefined)
    if (r.ok) setMessage({ text: r.data.message, bad: r.data.action === 'unsupported' })
    else setMessage({ text: r.error, bad: true })
    await Promise.all([load(), reloadModpacks()])
  }

  const loaderOk = ['fabric', 'quilt', 'neoforge'].includes(modpack.loader)

  if (loadError) return <p className="error-text">{loadError}</p>
  if (!status) return <p className="field-hint">Checking EnderPhone…</p>

  const { pref, installed, latest } = status
  return (
    <div className="ep-panel">
      <div className={`ep-hero${pref.enabled ? ' on' : ''}`}>
        <div className="ep-hero-icon">
          <Icon name="phone" size={30} />
        </div>
        <div className="ep-hero-text">
          <h3>EnderPhone in this instance</h3>
          <p>
            {!loaderOk
              ? `EnderPhone needs Fabric, Quilt or NeoForge - this instance is ${LOADER_LABEL[modpack.loader]}.`
              : !status.supported
                ? `There's no EnderPhone build for ${LOADER_LABEL[modpack.loader]} ${modpack.minecraftVersion} yet.`
                : pref.enabled
                  ? 'Installed and managed by E-Launcher. Maps, messaging, calls, proximity voice and the rest, in one mod.'
                  : 'Switch it on and E-Launcher puts the right EnderPhone jar in this instance and keeps it current.'}
          </p>
        </div>
        <label className="toggle-switch big" title={pref.enabled ? 'Remove EnderPhone' : 'Add EnderPhone'}>
          <input
            type="checkbox"
            checked={pref.enabled}
            disabled={busy || (!pref.enabled && (!loaderOk || !status.supported))}
            onChange={(e) => configure({ enabled: e.target.checked })}
          />
          <span className="slider" />
        </label>
      </div>

      {(busy || message) && (
        <p className={`ep-message${message?.bad ? ' bad' : ''}`}>{busy ? progress?.message ?? 'Working…' : message?.text}</p>
      )}

      <div className="ep-grid">
        <div className="ep-card">
          <h4>Edition</h4>
          <div className="seg-row">
            {(['full', 'lite'] as const).map((ed) => (
              <button
                key={ed}
                className={`seg${pref.edition === ed ? ' active' : ''}`}
                disabled={busy}
                onClick={() => pref.edition !== ed && configure({ edition: ed })}
              >
                {ed === 'full' ? 'EnderPhone' : 'Lite'}
              </button>
            ))}
          </div>
          <p className="field-hint">
            {pref.edition === 'full'
              ? 'Everything, including the web browser with MCEF built in.'
              : 'Every app except the browser - smaller. Same mod id, so your data carries over either way.'}
          </p>
        </div>

        <div className="ep-card">
          <h4>Version</h4>
          <div className="ep-version-row">
            <div>
              <span className="ep-k">Installed</span>
              <span className="ep-v">{installed ? `${installed.version}${installed.enabled ? '' : ' (turned off)'}` : 'Not installed'}</span>
            </div>
            <div>
              <span className="ep-k">Latest</span>
              <span className="ep-v">{latest ? latest.version : '—'}</span>
            </div>
          </div>
          {pref.enabled && (!installed || status.updateAvailable) && latest && (
            <button className="primary-button" disabled={busy} onClick={() => configure({})}>
              <Icon name="download" size={16} /> {installed ? `Update to ${latest.version}` : 'Install now'}
            </button>
          )}
          {pref.enabled && installed && !status.updateAvailable && installed.enabled && (
            <p className="field-hint good-text">
              <Icon name="check" size={14} /> Up to date
            </p>
          )}
        </div>

        <div className="ep-card">
          <h4>Updates</h4>
          <label className="check-row">
            <input
              type="checkbox"
              checked={pref.autoUpdate}
              disabled={busy}
              onChange={(e) => configure({ autoUpdate: e.target.checked })}
            />
            Update EnderPhone automatically when I press Play
          </label>
          <p className="field-hint">
            On Fabric, E-Launcher also adds Fabric API if it's missing. To turn EnderPhone off for a while without removing it, switch it off in the Content tab.
          </p>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------------------ content */

const CONTENT_KINDS: { kind: ContentKind; label: string }[] = [
  { kind: 'mods', label: 'Mods' },
  { kind: 'resourcepacks', label: 'Resource packs' },
  { kind: 'shaderpacks', label: 'Shader packs' },
  { kind: 'datapacks', label: 'Data packs' },
]

type Row = ContentFile & { kind: ContentKind }
type SortKey = 'name' | 'size'

function ContentPanel({ modpack }: { modpack: ModpackSummary }) {
  const [rows, setRows] = useState<Row[]>()
  const [busy, setBusy] = useState<string>()
  const [search, setSearch] = useState('')
  const [kindFilter, setKindFilter] = useState<ContentKind | 'all'>('all')
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDesc, setSortDesc] = useState(false)

  useEffect(() => {
    setRows(undefined)
    Promise.all(
      CONTENT_KINDS.map(({ kind }) => window.api.modpacks.listContent(modpack.id, kind).then((files) => files.map((f) => ({ ...f, kind })))),
    ).then((lists) => setRows(lists.flat()))
  }, [modpack.id])

  const visible = useMemo(() => {
    if (!rows) return undefined
    let list = rows
    if (kindFilter !== 'all') list = list.filter((r) => r.kind === kindFilter)
    const q = search.trim().toLowerCase()
    if (q) list = list.filter((r) => r.name.toLowerCase().includes(q))
    return [...list].sort((a, b) => {
      const diff = sortKey === 'name' ? a.name.localeCompare(b.name) : a.sizeBytes - b.sizeBytes
      return sortDesc ? -diff : diff
    })
  }, [rows, kindFilter, search, sortKey, sortDesc])

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDesc((v) => !v)
    else {
      setSortKey(key)
      setSortDesc(false)
    }
  }

  async function toggle(row: Row, enabled: boolean) {
    setBusy(row.name)
    const result = await window.api.modpacks.toggleContent(modpack.id, row.kind, row.name, enabled)
    if (result.ok) setRows((prev) => prev?.map((r) => (r.name === row.name && r.kind === row.kind ? { ...r, enabled } : r)))
    setBusy(undefined)
  }

  async function remove(row: Row) {
    if (!confirm(`Delete ${row.name}?`)) return
    await window.api.modpacks.removeContent(modpack.id, row.kind, row.name)
    setRows((prev) => prev?.filter((r) => !(r.name === row.name && r.kind === row.kind)))
  }

  return (
    <>
      <div className="content-table-controls">
        <div className="search-box">
          <Icon name="search" size={16} />
          <input type="text" placeholder={`Search ${rows?.length ?? 0} files…`} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className="select-control" value={kindFilter} onChange={(e) => setKindFilter(e.target.value as ContentKind | 'all')}>
          <option value="all">All types</option>
          {CONTENT_KINDS.map(({ kind, label }) => (
            <option key={kind} value={kind}>
              {label}
            </option>
          ))}
        </select>
        <button className="secondary-button" onClick={() => window.api.modpacks.openFolder(modpack.id)}>
          <Icon name="folder" size={16} /> Open folder
        </button>
      </div>

      {visible === undefined ? (
        <p className="field-hint">Loading…</p>
      ) : visible.length === 0 ? (
        <div className="empty-state">
          <h3>Nothing here</h3>
          <p>{rows?.length === 0 ? 'Nothing installed yet - find mods in Discover.' : 'No files match your search.'}</p>
        </div>
      ) : (
        <table className="content-table">
          <thead>
            <tr>
              <th className="sortable" onClick={() => toggleSort('name')}>
                Name {sortKey === 'name' && (sortDesc ? '▾' : '▴')}
              </th>
              <th>Type</th>
              <th className="sortable" onClick={() => toggleSort('size')}>
                Size {sortKey === 'size' && (sortDesc ? '▾' : '▴')}
              </th>
              <th />
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={`${row.kind}-${row.name}`}>
                <td className={row.enabled ? '' : 'content-file-disabled'}>
                  {row.name.startsWith('EnderPhone') && <Icon name="phone" size={13} className="inline-ep" />}
                  {row.name}
                  {!row.enabled && <span className="content-disabled-tag">off</span>}
                </td>
                <td>{CONTENT_KINDS.find((k) => k.kind === row.kind)?.label}</td>
                <td>{formatBytes(row.sizeBytes)}</td>
                <td className="content-actions">
                  <label className="toggle-switch" title={row.enabled ? 'Turn off' : 'Turn on'}>
                    <input type="checkbox" checked={row.enabled} disabled={busy === row.name} onChange={(e) => toggle(row, e.target.checked)} />
                    <span className="slider" />
                  </label>
                  <button className="icon-button small" title="Delete" onClick={() => remove(row)}>
                    <Icon name="trash" size={15} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}

/* ------------------------------------------------------------------------------ worlds */

function WorldsPanel({ modpack }: { modpack: ModpackSummary }) {
  const { launchingId, play } = useLaunch()
  const [worlds, setWorlds] = useState<WorldInfo[]>()

  useEffect(() => {
    setWorlds(undefined)
    window.api.modpacks.listWorlds(modpack.id).then(setWorlds)
  }, [modpack.id])

  async function remove(w: WorldInfo) {
    if (!confirm(`Delete the world "${w.folder}"? This can't be undone.`)) return
    await window.api.modpacks.deleteWorld(modpack.id, w.folder)
    setWorlds((prev) => prev?.filter((x) => x.folder !== w.folder))
  }

  return (
    <>
      <div className="content-table-controls">
        <p className="field-hint grow">Play drops you straight into the world (Minecraft 1.20 and newer).</p>
        <button className="secondary-button" onClick={() => window.api.modpacks.openFolder(modpack.id, 'saves')}>
          <Icon name="folder" size={16} /> Open saves folder
        </button>
      </div>
      {worlds === undefined ? (
        <p className="field-hint">Loading…</p>
      ) : worlds.length === 0 ? (
        <div className="empty-state">
          <h3>No worlds yet</h3>
          <p>Singleplayer worlds you make in this instance show up here.</p>
        </div>
      ) : (
        <div className="world-list">
          {worlds.map((w) => (
            <div className="world-row" key={w.folder}>
              {w.iconDataUrl ? <img className="world-icon" src={w.iconDataUrl} alt="" /> : <span className="world-icon placeholder"><Icon name="world" size={24} /></span>}
              <div className="world-info">
                <div className="world-name">{w.folder}</div>
                <div className="world-meta">
                  Played {timeAgo(w.lastPlayed)} · {formatBytes(w.sizeBytes)}
                </div>
              </div>
              <button className="secondary-button" disabled={!!launchingId} onClick={() => play(modpack.id, { type: 'singleplayer', world: w.folder })}>
                <Icon name="play" size={14} /> Play
              </button>
              <button className="icon-button small" title="Delete world" onClick={() => remove(w)}>
                <Icon name="trash" size={15} />
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

/* ------------------------------------------------------------------------------ logs */

function LogsPanel({ modpack }: { modpack: ModpackSummary }) {
  const [log, setLog] = useState<LogTail>()
  const [filter, setFilter] = useState('')
  const [problemsOnly, setProblemsOnly] = useState(false)

  const load = () => window.api.modpacks.readLog(modpack.id).then(setLog)
  useEffect(() => {
    setLog(undefined)
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modpack.id])

  const lines = useMemo(() => {
    if (!log?.exists) return []
    let all = log.text.split(/\r?\n/)
    if (problemsOnly) all = all.filter((l) => /\b(WARN|ERROR|FATAL|Exception)\b/.test(l))
    const q = filter.trim().toLowerCase()
    if (q) all = all.filter((l) => l.toLowerCase().includes(q))
    return all.slice(-3000)
  }, [log, filter, problemsOnly])

  return (
    <>
      <div className="content-table-controls">
        <div className="search-box">
          <Icon name="search" size={16} />
          <input type="text" placeholder="Filter lines…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        <button className={`filter-chip${problemsOnly ? ' active' : ''}`} onClick={() => setProblemsOnly((v) => !v)}>
          Warnings and errors
        </button>
        <button className="secondary-button" onClick={load}>
          <Icon name="refresh" size={16} /> Refresh
        </button>
        <button className="secondary-button" disabled={!log?.exists} onClick={() => navigator.clipboard.writeText(lines.join('\n'))}>
          Copy
        </button>
        <button className="secondary-button" onClick={() => window.api.modpacks.openFolder(modpack.id, 'logs')}>
          <Icon name="folder" size={16} />
        </button>
      </div>
      {log === undefined ? (
        <p className="field-hint">Loading…</p>
      ) : !log.exists ? (
        <div className="empty-state">
          <h3>No log yet</h3>
          <p>Play this instance once and its latest.log shows up here.</p>
        </div>
      ) : (
        <>
          <p className="field-hint">
            latest.log{log.modifiedAt ? ` · written ${timeAgo(log.modifiedAt)}` : ''}
            {log.truncated ? ' · showing the end of a long log' : ''}
          </p>
          <pre className="log-view">
            {lines.map((l, i) => (
              <div key={i} className={/\b(ERROR|FATAL)\b|Exception/.test(l) ? 'log-error' : /\bWARN\b/.test(l) ? 'log-warn' : undefined}>
                {l || ' '}
              </div>
            ))}
          </pre>
        </>
      )}
    </>
  )
}
