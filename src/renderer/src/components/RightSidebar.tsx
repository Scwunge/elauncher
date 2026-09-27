import { useState } from 'react'
import { useEnderNet } from '../state'
import type { Friend, Profile } from '../types'
import Icon from './Icon'
import SkinFace from './SkinFace'

interface Props {
  profile: Profile
  onOpenPage: (page: string) => void
}

const REGION_NAMES: Record<string, string> = { uk: 'London', fr: 'Roubaix', na: 'Canada' }

/** A friend's face: their EnderPhone avatar if they set one, else their Minecraft skin's face, else
 *  their initial (offline, or the face service is down). */
function FriendFace({ friend }: { friend: Friend }) {
  const [broken, setBroken] = useState(false)
  if (broken) return <span className="friend-avatar initial">{friend.name.slice(0, 1).toUpperCase()}</span>
  const src = friend.avatar ?? `https://mc-heads.net/avatar/${friend.uuid}/28`
  return <img className={`friend-avatar${friend.avatar ? '' : ' pixel'}`} src={src} alt="" onError={() => setBroken(true)} />
}

/**
 * Always-on right column: who you're playing as, your EnderPhone friends (online first, requests on
 * top), and the network's live state - the relays that carry calls and proximity voice.
 */
export default function RightSidebar({ profile, onOpenPage }: Props) {
  const { session, requestConnect, friends, reloadFriends, network, networkDown } = useEnderNet()
  const [busy, setBusy] = useState<string>()

  async function respond(uuid: string, accept: boolean) {
    setBusy(uuid)
    await (accept ? window.api.endernet.follow(uuid) : window.api.endernet.decline(uuid))
    await reloadFriends()
    setBusy(undefined)
  }

  const sorted = friends
    ? [...friends.friends].sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name))
    : []
  const onlineCount = sorted.filter((f) => f.online).length

  return (
    <aside className="right-sidebar">
      <div className="sidebar-section">
        <h4>Playing as</h4>
        <div className="playing-as">
          <SkinFace skinUrl={profile.skinUrl} size={40} />
          <div>
            <div className="playing-as-name">{profile.name}</div>
            <div className="playing-as-sub">
              {session.connected ? (
                <>
                  <span className="dot good" /> On EnderNet
                </>
              ) : (
                <button className="link-button" onClick={requestConnect}>
                  Connect to EnderNet
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="sidebar-section sidebar-friends">
        <h4>
          Friends {friends && <span className="count">{onlineCount} online</span>}
        </h4>
        {!session.connected ? (
          <div className="sidebar-empty">
            <Icon name="users" size={22} />
            <p>Connect to EnderNet to see which friends are online.</p>
          </div>
        ) : !friends ? (
          <p className="field-hint">Loading…</p>
        ) : (
          <>
            {friends.incoming.length > 0 && (
              <div className="friend-requests">
                {friends.incoming.map((f) => (
                  <div className="friend-row request" key={f.uuid}>
                    <FriendFace friend={f} />
                    <div className="friend-name">
                      {f.name}
                      <span className="friend-sub">wants to be friends</span>
                    </div>
                    <button className="icon-button small good" title="Accept" disabled={busy === f.uuid} onClick={() => respond(f.uuid, true)}>
                      <Icon name="check" size={15} />
                    </button>
                    <button className="icon-button small" title="Decline" disabled={busy === f.uuid} onClick={() => respond(f.uuid, false)}>
                      <Icon name="x" size={15} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {sorted.length === 0 ? (
              <div className="sidebar-empty">
                <p>No friends yet. Add people from the phone's Friends app or on Enderbook.</p>
              </div>
            ) : (
              <div className="friend-list">
                {sorted.map((f) => (
                  <div className={`friend-row${f.online ? ' online' : ''}`} key={f.uuid}>
                    <span className="friend-face-wrap">
                      <FriendFace friend={f} />
                      <span className={`presence ${f.online ? 'on' : 'off'}`} />
                    </span>
                    <div className="friend-name">
                      {f.name}
                      <span className="friend-sub">{f.online ? 'Online' : 'Offline'}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <button className="secondary-button full" onClick={() => onOpenPage('enderchat')}>
              <Icon name="chat" size={16} /> Open EnderChat
            </button>
          </>
        )}
      </div>

      <div className="sidebar-section">
        <h4>Network</h4>
        {networkDown ? (
          <span className="status-pill offline">
            <span className="dot" /> EnderNet unreachable
          </span>
        ) : network ? (
          <div className="network-mini">
            <div className="network-mini-row">
              <span>Online now</span>
              <strong>{network.online.toLocaleString()}</strong>
            </div>
            <div className="network-mini-row">
              <span>In calls</span>
              <strong>{network.calls}</strong>
            </div>
            <div className="relay-list">
              {network.relays.map((r) => (
                <span key={r.id} className={`relay-chip ${r.up ? 'up' : 'down'}`} title={r.up ? 'Carrying voice' : 'Down'}>
                  <span className="dot" />
                  {REGION_NAMES[r.id] ?? r.region ?? r.id}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <p className="field-hint">Checking…</p>
        )}
      </div>
    </aside>
  )
}
