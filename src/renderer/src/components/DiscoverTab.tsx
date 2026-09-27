import { useEffect, useState } from 'react'
import { LOADER_LABEL, useLaunch } from '../state'
import type { InstallTarget, ModrinthHit, ModrinthVersion, ProjectType } from '../types'
import Icon from './Icon'

const PROJECT_TABS: { id: ProjectType; label: string }[] = [
  { id: 'mod', label: 'Mods' },
  { id: 'modpack', label: 'Modpacks' },
  { id: 'shader', label: 'Shaders' },
  { id: 'resourcepack', label: 'Resource packs' },
  { id: 'datapack', label: 'Data packs' },
]

function compact(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`
  return String(n)
}

/**
 * Modrinth, searched directly. Mods, shaders and packs go into an instance you pick (versions are
 * filtered to that instance's loader and Minecraft version); a modpack becomes a new instance, and
 * can get EnderPhone added to it on the way in.
 */
export default function DiscoverTab() {
  const { reloadModpacks, selectedId } = useLaunch()
  const [projectType, setProjectType] = useState<ProjectType>('mod')
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<ModrinthHit[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [selectedHit, setSelectedHit] = useState<ModrinthHit>()
  const [versions, setVersions] = useState<ModrinthVersion[]>()
  const [selectedVersionId, setSelectedVersionId] = useState<string>()
  const [targets, setTargets] = useState<InstallTarget[]>([])
  const [targetId, setTargetId] = useState<string>()
  const [installing, setInstalling] = useState(false)
  const [installMessage, setInstallMessage] = useState<string>()
  const [done, setDone] = useState<string>()
  const [withEnderPhone, setWithEnderPhone] = useState(true)

  useEffect(() => {
    window.api.modpacks.installTargets().then((list) => {
      setTargets(list)
      setTargetId((prev) => prev ?? (list.some((t) => t.id === selectedId) ? selectedId : list[0]?.id))
    })
  }, [selectedId])
  useEffect(() => window.api.modrinth.onProgress((event) => setInstallMessage(event.message)), [])

  async function search(offset = 0) {
    setLoading(true)
    setError(undefined)
    try {
      const result = await window.api.modrinth.search(query, projectType, offset)
      setHits((prev) => (offset === 0 ? result.hits : [...prev, ...result.hits]))
      setTotal(result.total_hits)
    } catch (err) {
      setError(`Couldn't reach Modrinth (${(err as Error).message}).`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void search(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectType])

  const target = targets.find((t) => t.id === targetId)

  async function loadVersions(hit: ModrinthHit, forTarget?: InstallTarget) {
    setVersions(undefined)
    setSelectedVersionId(undefined)
    const filter =
      projectType === 'modpack' || !forTarget
        ? undefined
        : {
            // Shaders and resource packs aren't tied to a mod loader on Modrinth.
            loader: projectType === 'mod' ? forTarget.loader : undefined,
            minecraftVersion: forTarget.minecraftVersion,
          }
    const list = await window.api.modrinth.listVersions(hit.project_id, filter)
    setVersions(list)
    setSelectedVersionId(list[0]?.id)
  }

  function openHit(hit: ModrinthHit) {
    setSelectedHit(hit)
    setDone(undefined)
    setError(undefined)
    void loadVersions(hit, target)
  }

  async function install() {
    const version = versions?.find((v) => v.id === selectedVersionId)
    if (!selectedHit || !version) return
    setInstalling(true)
    setError(undefined)
    try {
      if (projectType === 'modpack') {
        const result = await window.api.modrinth.installModpack(selectedHit, version, withEnderPhone)
        if (!result.ok) throw new Error(result.error)
        await reloadModpacks()
        setDone(`${selectedHit.title} is in your Library.`)
      } else {
        if (!targetId) throw new Error('Pick an instance to install this into first.')
        const file = version.files.find((f) => f.primary) ?? version.files[0]
        if (!file) throw new Error('That version has no file to download.')
        const result = await window.api.modrinth.installContent(targetId, projectType as 'mod' | 'shader' | 'resourcepack' | 'datapack', file)
        if (!result.ok) throw new Error(result.error)
        setDone(`Installed into ${target?.name}.`)
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setInstalling(false)
      setInstallMessage(undefined)
    }
  }

  return (
    <div className="discover">
      <div className="section-header">
        <div>
          <h2 className="section-title">Discover</h2>
          <p className="section-sub">Mods, packs and shaders from Modrinth.</p>
        </div>
      </div>

      <div className="modrinth-tabs">
        {PROJECT_TABS.map((t) => (
          <button key={t.id} className={`modrinth-tab${projectType === t.id ? ' active' : ''}`} onClick={() => setProjectType(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="library-controls">
        <div className="search-box grow">
          <Icon name="search" size={16} />
          <input
            type="text"
            placeholder={`Search ${PROJECT_TABS.find((t) => t.id === projectType)?.label.toLowerCase()}…`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && search(0)}
          />
        </div>
        <button className="primary-button" onClick={() => search(0)}>
          Search
        </button>
        {projectType !== 'modpack' && targets.length > 0 && (
          <label className="target-picker">
            <span>Install into</span>
            <select className="select-control" value={targetId ?? ''} onChange={(e) => setTargetId(e.target.value)}>
              {targets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({LOADER_LABEL[t.loader]} {t.minecraftVersion})
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {error && !selectedHit && <p className="error-text">{error}</p>}

      {!loading && !error && hits.length === 0 && (
        <div className="empty-state">
          <h3>No results</h3>
          <p>Nothing matched that search.</p>
        </div>
      )}

      <div className="project-list">
        {hits.map((hit) => (
          <button className="project-row" key={hit.project_id} onClick={() => openHit(hit)}>
            <div className="project-row-icon" style={{ backgroundImage: hit.icon_url ? `url(${hit.icon_url})` : undefined }} />
            <div className="project-row-info">
              <div className="project-row-title">
                {hit.title} <span className="project-row-author">by {hit.author}</span>
              </div>
              <div className="project-row-description">{hit.description}</div>
              {hit.categories && (
                <div className="project-row-tags">
                  {hit.categories.slice(0, 4).map((c) => (
                    <span key={c} className="tag-chip">
                      {c}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="project-row-stats">
              <span>
                <Icon name="download" size={14} /> {compact(hit.downloads)}
              </span>
              {hit.follows !== undefined && (
                <span>
                  <Icon name="heart" size={14} /> {compact(hit.follows)}
                </span>
              )}
            </div>
          </button>
        ))}
      </div>

      {hits.length > 0 && hits.length < total && (
        <div className="load-more">
          <button className="secondary-button" disabled={loading} onClick={() => search(hits.length)}>
            {loading ? 'Loading…' : `Show more (${(total - hits.length).toLocaleString()} left)`}
          </button>
        </div>
      )}
      {loading && hits.length === 0 && <p className="field-hint">Loading…</p>}

      {selectedHit && (
        <div className="settings-overlay" onClick={() => !installing && setSelectedHit(undefined)}>
          <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
            <div className="project-detail-head">
              <div className="project-row-icon large" style={{ backgroundImage: selectedHit.icon_url ? `url(${selectedHit.icon_url})` : undefined }} />
              <div>
                <h2>{selectedHit.title}</h2>
                <p className="field-hint">{selectedHit.description}</p>
              </div>
            </div>

            {projectType !== 'modpack' && (
              <div className="field">
                <label>Install into</label>
                <select
                  className="select-control"
                  value={targetId ?? ''}
                  onChange={(e) => {
                    setTargetId(e.target.value)
                    void loadVersions(selectedHit, targets.find((t) => t.id === e.target.value))
                  }}
                >
                  {targets.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({LOADER_LABEL[t.loader]} {t.minecraftVersion})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="field">
              <label>Version</label>
              {versions === undefined ? (
                <p className="field-hint">Loading versions…</p>
              ) : versions.length === 0 ? (
                <p className="field-hint">No versions of this fit {target ? `${LOADER_LABEL[target.loader]} ${target.minecraftVersion}` : 'that instance'}.</p>
              ) : (
                <select className="select-control" value={selectedVersionId} onChange={(e) => setSelectedVersionId(e.target.value)}>
                  {versions.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} · {v.game_versions.slice(-2).join(', ')} · {v.loaders.join(', ')}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {projectType === 'modpack' && (
              <label className="check-row">
                <input type="checkbox" checked={withEnderPhone} onChange={(e) => setWithEnderPhone(e.target.checked)} />
                Add EnderPhone to this pack (when there's a build for its version)
              </label>
            )}

            {installing && installMessage && <p className="field-hint progress-line">{installMessage}</p>}
            {done && (
              <p className="good-text">
                <Icon name="check" size={14} /> {done}
              </p>
            )}
            {error && <p className="error-text">{error}</p>}

            <div className="settings-actions">
              <button className="secondary-button" disabled={installing} onClick={() => setSelectedHit(undefined)}>
                {done ? 'Close' : 'Cancel'}
              </button>
              {!done && (
                <button className="primary-button" disabled={!selectedVersionId || installing} onClick={install}>
                  {installing ? 'Installing…' : 'Install'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
