import { useEffect, useMemo, useState } from 'react'
import { LOADER_LABEL, timeAgo, useLaunch } from '../state'
import type { InstallTarget, ModpackGroup, ModpackSummary } from '../types'
import ContextMenu from './ContextMenu'
import GroupAssignDialog from './GroupAssignDialog'
import Icon from './Icon'
import InstanceDetailPage from './InstanceDetailPage'
import InstanceIcon from './InstanceIcon'
import JavaSettings from './JavaSettings'
import LaunchSettings from './LaunchSettings'
import ModpackEditor from './ModpackEditor'
import NewEnderPhoneInstance from './NewEnderPhoneInstance'

interface Props {
  openId?: string
  onOpenId: (id: string | undefined) => void
}

type Named = { id: string; name: string }

export default function LibraryTab({ openId, onOpenId }: Props) {
  const { modpacks, reloadModpacks, selectedId, select, lastPlayed, launchingId, play } = useLaunch()
  const [editing, setEditing] = useState<InstallTarget | 'new'>()
  const [creatingEp, setCreatingEp] = useState(false)
  const [javaFor, setJavaFor] = useState<Named>()
  const [launchSettingsFor, setLaunchSettingsFor] = useState<Named>()
  const [groupAssignFor, setGroupAssignFor] = useState<Named>()
  const [groups, setGroups] = useState<ModpackGroup[]>([])
  const [groupAssignments, setGroupAssignments] = useState<Record<string, string>>({})
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; pack: ModpackSummary }>()
  const [sortBy, setSortBy] = useState<'recent' | 'name'>('recent')
  const [groupFilter, setGroupFilter] = useState<string>()
  const [search, setSearch] = useState('')
  const [epOnly, setEpOnly] = useState(false)

  function reloadGroups() {
    window.api.groups.list().then(setGroups)
    window.api.groups.assignments().then(setGroupAssignments)
  }
  useEffect(reloadGroups, [])

  function targetFor(pack: ModpackSummary): InstallTarget {
    return {
      id: pack.id,
      name: pack.name,
      iconUrl: pack.iconUrl,
      minecraftVersion: pack.minecraftVersion,
      loader: pack.loader,
      loaderVersion: pack.loaderVersion,
      editable: true,
    }
  }

  const visible = useMemo(() => {
    let list = modpacks
    if (groupFilter === '__ungrouped__') list = list.filter((p) => !groupAssignments[p.id])
    else if (groupFilter) list = list.filter((p) => groupAssignments[p.id] === groupFilter)
    if (epOnly) list = list.filter((p) => p.enderphone)
    const q = search.trim().toLowerCase()
    if (q) list = list.filter((p) => p.name.toLowerCase().includes(q) || p.minecraftVersion.includes(q))
    return [...list].sort((a, b) =>
      sortBy === 'name' ? a.name.localeCompare(b.name) : (lastPlayed[b.id] ?? 0) - (lastPlayed[a.id] ?? 0),
    )
  }, [modpacks, groupFilter, groupAssignments, epOnly, search, sortBy, lastPlayed])

  const dialogs = (
    <>
      {contextMenu &&
        (() => {
          const pack = contextMenu.pack
          const items = [
            { label: 'Play', onClick: () => play(pack.id) },
            { label: 'Open', onClick: () => onOpenId(pack.id) },
            { label: 'Open folder', onClick: () => window.api.modpacks.openFolder(pack.id) },
            { label: 'Edit', onClick: () => setEditing(targetFor(pack)), separatorBefore: true },
            { label: 'Java settings', onClick: () => setJavaFor(pack) },
            { label: 'Launch settings', onClick: () => setLaunchSettingsFor(pack) },
            { label: 'Move to group', onClick: () => setGroupAssignFor(pack) },
          ]
          return <ContextMenu x={contextMenu.x} y={contextMenu.y} items={items} onClose={() => setContextMenu(undefined)} />
        })()}
      {editing && (
        <ModpackEditor
          target={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            void reloadModpacks()
            if (editing !== 'new' && !modpacks.some((m) => m.id === editing.id)) onOpenId(undefined)
          }}
          onDeleted={() => onOpenId(undefined)}
        />
      )}
      {creatingEp && <NewEnderPhoneInstance onClose={() => setCreatingEp(false)} onCreated={(id) => onOpenId(id)} />}
      {javaFor && <JavaSettings modpackId={javaFor.id} modpackName={javaFor.name} onClose={() => setJavaFor(undefined)} />}
      {launchSettingsFor && (
        <LaunchSettings modpackId={launchSettingsFor.id} modpackName={launchSettingsFor.name} onClose={() => setLaunchSettingsFor(undefined)} />
      )}
      {groupAssignFor && (
        <GroupAssignDialog
          modpackId={groupAssignFor.id}
          modpackName={groupAssignFor.name}
          currentGroupId={groupAssignments[groupAssignFor.id]}
          onChanged={reloadGroups}
          onClose={() => setGroupAssignFor(undefined)}
        />
      )}
    </>
  )

  const viewing = modpacks.find((m) => m.id === openId)
  if (viewing) {
    return (
      <>
        <InstanceDetailPage
          modpack={viewing}
          onBack={() => onOpenId(undefined)}
          onEdit={() => setEditing(targetFor(viewing))}
          onOpenLaunchSettings={() => setLaunchSettingsFor(viewing)}
          onOpenMoreMenu={(e) => {
            e.preventDefault()
            setContextMenu({ x: e.clientX, y: e.clientY, pack: viewing })
          }}
        />
        {dialogs}
      </>
    )
  }

  return (
    <div className="library">
      <div className="section-header">
        <div>
          <h2 className="section-title">Library</h2>
          <p className="section-sub">
            {modpacks.length} instance{modpacks.length === 1 ? '' : 's'} · {modpacks.filter((m) => m.enderphone).length} with EnderPhone
          </p>
        </div>
        <div className="row-gap">
          <button className="secondary-button" onClick={() => setEditing('new')}>
            <Icon name="plus" size={16} /> Blank instance
          </button>
          <button className="primary-button" onClick={() => setCreatingEp(true)}>
            <Icon name="phone" size={16} /> New EnderPhone instance
          </button>
        </div>
      </div>

      {modpacks.length > 0 && (
        <div className="library-controls">
          <div className="search-box">
            <Icon name="search" size={16} />
            <input type="text" placeholder="Search instances…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <button className={`filter-chip${epOnly ? ' active' : ''}`} onClick={() => setEpOnly((v) => !v)}>
            <Icon name="phone" size={14} /> EnderPhone
          </button>
          <select className="select-control" value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)}>
            <option value="recent">Last played</option>
            <option value="name">Name (A-Z)</option>
          </select>
          {groups.length > 0 && (
            <select className="select-control" value={groupFilter ?? ''} onChange={(e) => setGroupFilter(e.target.value || undefined)}>
              <option value="">All groups</option>
              <option value="__ungrouped__">Ungrouped</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {modpacks.length === 0 ? (
        <div className="empty-state big">
          <div className="empty-state-icon">
            <Icon name="phone" size={40} />
          </div>
          <h3>No instances yet</h3>
          <p>An instance is one Minecraft setup: a version, a loader and its mods. Start with one that has EnderPhone in it.</p>
          <button className="primary-button" onClick={() => setCreatingEp(true)}>
            New EnderPhone instance
          </button>
        </div>
      ) : visible.length === 0 ? (
        <div className="empty-state">
          <h3>Nothing matches</h3>
          <p>Try a different search or filter.</p>
        </div>
      ) : (
        <div className="instance-grid">
          {visible.map((pack) => (
            <div
              key={pack.id}
              className={`instance-card${pack.id === selectedId ? ' selected' : ''}${launchingId === pack.id ? ' launching' : ''}`}
              onClick={() => {
                select(pack.id)
                onOpenId(pack.id)
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                setContextMenu({ x: e.clientX, y: e.clientY, pack })
              }}
            >
              <div className="instance-card-top">
                <InstanceIcon pack={pack} size={56} />
                <button
                  className="instance-card-play"
                  title="Play"
                  disabled={!!launchingId}
                  onClick={(e) => {
                    e.stopPropagation()
                    void play(pack.id)
                  }}
                >
                  <Icon name="play" size={18} />
                </button>
              </div>
              <div className="instance-card-name">{pack.name}</div>
              <div className="instance-card-meta">
                <span>{LOADER_LABEL[pack.loader]}</span>
                <span>{pack.minecraftVersion}</span>
              </div>
              <div className="instance-card-foot">
                {pack.enderphone ? (
                  <span className="ep-badge">
                    <Icon name="phone" size={12} /> {pack.enderphone.edition === 'lite' ? 'Lite' : 'EnderPhone'}
                  </span>
                ) : (
                  <span className="muted-chip">No EnderPhone</span>
                )}
                <span className="instance-card-played">{lastPlayed[pack.id] ? timeAgo(lastPlayed[pack.id]!) : 'Never played'}</span>
              </div>
            </div>
          ))}
        </div>
      )}
      {dialogs}
    </div>
  )
}
