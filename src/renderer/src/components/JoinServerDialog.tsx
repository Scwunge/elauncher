import { useMemo, useState } from 'react'
import { LOADER_LABEL, useLaunch } from '../state'
import type { EndportalServer } from '../types'
import Icon from './Icon'
import InstanceIcon from './InstanceIcon'
import NewEnderPhoneInstance from './NewEnderPhoneInstance'
import ServerBanner from './ServerBanner'

/** "1.21.1, 26.2" / "1.21.x" / "1.20-1.21" -> a loose "does this instance's version fit" check. */
function versionFits(serverVersions: string, mc: string): boolean {
  if (!serverVersions.trim()) return true
  const parts = serverVersions.split(/[,\s/]+/).filter(Boolean)
  return parts.some((p) => {
    const clean = p.replace(/\.x$/i, '')
    return mc === clean || mc.startsWith(`${clean}.`) || p.includes(mc)
  })
}

/**
 * Join an Endportal server: pick which instance to play it in (ones that fit the server's version
 * and have EnderPhone come first), then launch straight into it with Quick Play.
 */
export default function JoinServerDialog({ server, onClose }: { server: EndportalServer; onClose: () => void }) {
  const { modpacks, play, launchingId } = useLaunch()
  const [creating, setCreating] = useState(false)
  const ranked = useMemo(
    () =>
      [...modpacks]
        .map((m) => ({ m, fits: versionFits(server.versions ?? '', m.minecraftVersion) }))
        .sort((a, b) => Number(b.fits) - Number(a.fits) || Number(!!b.m.enderphone) - Number(!!a.m.enderphone)),
    [modpacks, server.versions],
  )
  const [chosen, setChosen] = useState<string | undefined>(ranked[0]?.m.id)

  function join() {
    if (!chosen) return
    void play(chosen, { type: 'multiplayer', address: server.host, label: server.name })
    onClose()
  }

  return (
    <>
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel join-panel" onClick={(e) => e.stopPropagation()}>
        <div className="join-head">
          <ServerBanner server={server} className="join-banner" />
          <div>
            <h2>{server.name}</h2>
            <p className="field-hint mono">{server.host}</p>
            {server.versions && <p className="field-hint">Versions: {server.versions}</p>}
          </div>
        </div>

        <div className="field">
          <label>Play it in</label>
          {ranked.length === 0 ? (
            <p className="field-hint">You don't have an instance yet.</p>
          ) : (
            <div className="instance-pick-list">
              {ranked.map(({ m, fits }) => (
                <button key={m.id} className={`instance-pick${chosen === m.id ? ' active' : ''}`} onClick={() => setChosen(m.id)}>
                  <InstanceIcon pack={m} size={34} />
                  <span className="instance-pick-name">{m.name}</span>
                  <span className="instance-pick-meta">
                    {LOADER_LABEL[m.loader]} {m.minecraftVersion}
                  </span>
                  {m.enderphone && (
                    <span className="ep-badge small">
                      <Icon name="phone" size={11} />
                    </span>
                  )}
                  {!fits && <span className="warn-chip">version may not match</span>}
                </button>
              ))}
            </div>
          )}
          <button className="link-button" onClick={() => setCreating(true)}>
            + Make a new EnderPhone instance for this server
          </button>
        </div>

        <div className="settings-actions">
          <button className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button className="play-button" disabled={!chosen || !!launchingId} onClick={join}>
            <Icon name="play" size={16} /> Join server
          </button>
        </div>
      </div>
    </div>
    {creating && (
      <NewEnderPhoneInstance
        suggestedName={server.name}
        onClose={() => setCreating(false)}
        onCreated={(id) => setChosen(id)}
      />
    )}
    </>
  )
}
