import { useEffect, useState } from 'react'
import wordmark from '../assets/wordmark.png'
import { LOADER_LABEL, timeAgo, useEnderNet, useLaunch } from '../state'
import type { EndportalServer, Profile, RadioNow } from '../types'
import Icon from './Icon'
import InstanceIcon from './InstanceIcon'
import JoinServerDialog from './JoinServerDialog'
import NewEnderPhoneInstance from './NewEnderPhoneInstance'
import type { Tab } from './NavRail'
import ServerBanner from './ServerBanner'

interface Props {
  profile: Profile
  onOpenInstance: (id: string) => void
  onNavigate: (tab: Tab) => void
  onOpenPage: (page: string) => void
}

function greeting(): string {
  const h = new Date().getHours()
  if (h < 5) return 'Up late'
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

export default function HomeTab({ profile, onOpenInstance, onNavigate, onOpenPage }: Props) {
  const { modpacks, lastPlayed, launchingId, play, selectedId } = useLaunch()
  const { session, network, requestConnect } = useEnderNet()
  const [servers, setServers] = useState<EndportalServer[]>()
  const [radio, setRadio] = useState<RadioNow>()
  const [joining, setJoining] = useState<EndportalServer>()
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    window.api.endernet.servers({ sort: 'votes' }).then((r) => setServers(r.ok ? r.data.servers.slice(0, 3) : []))
  }, [])
  useEffect(() => {
    if (!session.connected) return
    window.api.endernet.radio().then((r) => r.ok && setRadio(r.data))
  }, [session.connected])

  // Played instances, most recent first; before anything's been played, just the first few.
  const played = modpacks.filter((m) => lastPlayed[m.id])
  const recent = (played.length ? played.sort((a, b) => lastPlayed[b.id]! - lastPlayed[a.id]!) : modpacks).slice(0, 4)
  const hero = modpacks.find((m) => m.id === selectedId) ?? recent[0]
  const hasEnderPhone = modpacks.some((m) => m.enderphone)

  return (
    <div className="home">
      <section className="home-hero">
        <div className="home-hero-text">
          <p className="eyebrow">{greeting()}</p>
          <h1>
            {profile.name}
            <span className="accent-dot">.</span>
          </h1>
          <p className="home-hero-sub">
            {hero
              ? `Pick up where you left off in ${hero.name}.`
              : 'Set up your first instance - EnderPhone comes installed, and stays up to date on its own.'}
          </p>
          <div className="home-hero-actions">
            {hero ? (
              <>
                <button className="play-button big" disabled={!!launchingId} onClick={() => play(hero.id)}>
                  <Icon name="play" size={20} /> Play {hero.name}
                </button>
                <button className="secondary-button" onClick={() => onOpenInstance(hero.id)}>
                  Open instance
                </button>
              </>
            ) : (
              <button className="play-button big" onClick={() => setCreating(true)}>
                <Icon name="plus" size={20} /> New EnderPhone instance
              </button>
            )}
          </div>
        </div>
        <img className="home-hero-art" src={wordmark} alt="" />
      </section>

      {recent.length > 0 && (
        <section className="home-section">
          <div className="section-header">
            <h2 className="section-title">Jump back in</h2>
            <button className="link-button" onClick={() => onNavigate('library')}>
              All instances →
            </button>
          </div>
          <div className="recent-grid">
            {recent.map((pack) => (
              <div className="recent-card" key={pack.id}>
                <button className="recent-card-main" onClick={() => onOpenInstance(pack.id)}>
                  <InstanceIcon pack={pack} size={48} />
                  <div className="recent-card-info">
                    <div className="recent-card-name">{pack.name}</div>
                    <div className="recent-card-meta">
                      {LOADER_LABEL[pack.loader]} {pack.minecraftVersion}
                      {lastPlayed[pack.id] ? ` · ${timeAgo(lastPlayed[pack.id]!)}` : ' · never played'}
                    </div>
                  </div>
                </button>
                <button className="icon-button play-mini" title={`Play ${pack.name}`} disabled={!!launchingId} onClick={() => play(pack.id)}>
                  <Icon name="play" size={16} />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {!hasEnderPhone && modpacks.length > 0 && (
        <section className="home-callout">
          <Icon name="phone" size={26} />
          <div>
            <strong>None of your instances has EnderPhone yet.</strong>
            <p>Make a new EnderPhone instance, or switch it on for one you have in its EnderPhone tab.</p>
          </div>
          <button className="primary-button" onClick={() => setCreating(true)}>
            New EnderPhone instance
          </button>
        </section>
      )}

      <section className="home-grid">
        <div className="home-card network-card">
          <div className="home-card-head">
            <Icon name="signal" size={18} />
            <h3>EnderNet right now</h3>
          </div>
          {network ? (
            <div className="stat-grid">
              <div className="stat">
                <span className="stat-n">{network.online.toLocaleString()}</span>
                <span className="stat-k">online now</span>
              </div>
              <div className="stat">
                <span className="stat-n">{network.players.today.toLocaleString()}</span>
                <span className="stat-k">played today</span>
              </div>
              <div className="stat">
                <span className="stat-n">{network.calls}</span>
                <span className="stat-k">calls</span>
              </div>
              <div className="stat">
                <span className="stat-n">{network.proximity}</span>
                <span className="stat-k">voice rooms</span>
              </div>
            </div>
          ) : (
            <p className="field-hint">Checking the network…</p>
          )}
        </div>

        <div className="home-card radio-card">
          <div className="home-card-head">
            <Icon name="radio" size={18} />
            <h3>{radio?.station.name ?? 'EnderPhone Radio'}</h3>
          </div>
          {!session.connected ? (
            <>
              <p className="field-hint">Connect to EnderNet to see what's on the radio, your friends and your cape.</p>
              <button className="secondary-button" onClick={requestConnect}>
                Connect
              </button>
            </>
          ) : radio?.playing ? (
            <div className="radio-now">
              <div className="radio-eq" aria-hidden="true">
                <i />
                <i />
                <i />
                <i />
              </div>
              <div>
                <div className="radio-title">{radio.playing.title}</div>
                <div className="radio-artist">{radio.playing.artist}</div>
                {radio.next && <div className="radio-next">Next: {radio.next.title}</div>}
              </div>
            </div>
          ) : (
            <p className="field-hint">Nothing playing right now. Tune in from the phone's Music app.</p>
          )}
        </div>

        <div className="home-card links-card">
          <div className="home-card-head">
            <Icon name="phone" size={18} />
            <h3>On your phone, here</h3>
          </div>
          <div className="quick-links">
            <button onClick={() => onOpenPage('enderchat')}>
              <Icon name="chat" size={18} /> EnderChat
            </button>
            <button onClick={() => onOpenPage('enderbook')}>
              <Icon name="book" size={18} /> Enderbook
            </button>
            <button onClick={() => onOpenPage('sites')}>
              <Icon name="globe" size={18} /> Sites
            </button>
            <button onClick={() => onOpenPage('hosting')}>
              <Icon name="server" size={18} /> Hosting
            </button>
          </div>
        </div>
      </section>

      <section className="home-section">
        <div className="section-header">
          <h2 className="section-title">Top on Endportal this month</h2>
          <button className="link-button" onClick={() => onNavigate('servers')}>
            Browse servers →
          </button>
        </div>
        {servers === undefined ? (
          <p className="field-hint">Loading…</p>
        ) : servers.length === 0 ? (
          <p className="field-hint">Endportal is quiet right now.</p>
        ) : (
          <div className="server-strip">
            {servers.map((s, i) => (
              <div className="server-mini" key={s.slug}>
                <span className="server-rank">#{i + 1}</span>
                <ServerBanner server={s} className="server-mini-banner" />
                <div className="server-mini-info">
                  <div className="server-mini-name">{s.name}</div>
                  <div className="server-mini-meta">
                    <span className={`dot ${s.online ? 'good' : 'bad'}`} />
                    {s.online ? `${s.players ?? 0}/${s.maxPlayers ?? '?'} playing` : 'Offline'} · {s.votes} votes
                  </div>
                </div>
                <button className="secondary-button" disabled={!s.online} onClick={() => setJoining(s)}>
                  Join
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {joining && <JoinServerDialog server={joining} onClose={() => setJoining(undefined)} />}
      {creating && <NewEnderPhoneInstance onClose={() => setCreating(false)} onCreated={onOpenInstance} />}
    </div>
  )
}
