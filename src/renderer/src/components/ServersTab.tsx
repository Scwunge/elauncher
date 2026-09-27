import { useEffect, useRef, useState } from 'react'
import type { EndportalServer } from '../types'
import Icon from './Icon'
import JoinServerDialog from './JoinServerDialog'
import ServerBanner from './ServerBanner'

const SORTS = [
  { id: 'votes', label: 'Most votes' },
  { id: 'players', label: 'Most players' },
  { id: 'rating', label: 'Best rated' },
  { id: 'newest', label: 'Newest' },
]

function Stars({ rating }: { rating: number }) {
  return (
    <span className="stars" title={`${rating} out of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={i <= Math.round(rating) ? 'on' : ''}>
          ★
        </span>
      ))}
    </span>
  )
}

/**
 * Endportal, EnderNet's server list, in the launcher: live player counts from the API's own
 * pinger, votes and ratings - and a Join button that launches an instance straight into the
 * server. Voting and reviews stay on the Endportal page itself, where they're tied to your
 * EnderPhone account.
 */
export default function ServersTab({ onOpenPage }: { onOpenPage: (page: string) => void }) {
  const [servers, setServers] = useState<EndportalServer[]>()
  const [categories, setCategories] = useState<{ tag: string; count: number }[]>([])
  const [error, setError] = useState<string>()
  const [q, setQ] = useState('')
  const [tag, setTag] = useState('')
  const [sort, setSort] = useState('votes')
  const [joining, setJoining] = useState<EndportalServer>()
  const [copied, setCopied] = useState<string>()
  const seq = useRef(0)

  useEffect(() => {
    const mine = ++seq.current
    const t = setTimeout(async () => {
      const r = await window.api.endernet.servers({ q: q.trim(), tag, sort })
      if (mine !== seq.current) return
      if (r.ok) {
        setServers(r.data.servers)
        setCategories(r.data.categories ?? [])
        setError(undefined)
      } else {
        setError(r.error)
        setServers([])
      }
    }, q ? 250 : 0)
    return () => clearTimeout(t)
  }, [q, tag, sort])

  async function copy(host: string) {
    await navigator.clipboard.writeText(host)
    setCopied(host)
    setTimeout(() => setCopied(undefined), 1500)
  }

  return (
    <div className="servers">
      <div className="section-header">
        <div>
          <h2 className="section-title">Servers</h2>
          <p className="section-sub">From Endportal, EnderNet's server list. Counts are live; votes are by real Minecraft accounts.</p>
        </div>
        <button className="secondary-button" onClick={() => onOpenPage('endportal')}>
          <Icon name="star" size={16} /> Vote and reviews
        </button>
      </div>

      <div className="library-controls">
        <div className="search-box">
          <Icon name="search" size={16} />
          <input type="text" placeholder="Search servers…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="select-control" value={sort} onChange={(e) => setSort(e.target.value)}>
          {SORTS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      {categories.length > 0 && (
        <div className="chip-row">
          <button className={`filter-chip${tag === '' ? ' active' : ''}`} onClick={() => setTag('')}>
            All
          </button>
          {categories
            .filter((c) => c.count > 0)
            .map((c) => (
              <button key={c.tag} className={`filter-chip${tag === c.tag ? ' active' : ''}`} onClick={() => setTag(c.tag)}>
                {c.tag} <span className="count">{c.count}</span>
              </button>
            ))}
        </div>
      )}

      {error && <p className="error-text">Couldn't load Endportal ({error}).</p>}

      {servers === undefined ? (
        <p className="field-hint">Loading servers…</p>
      ) : servers.length === 0 && !error ? (
        <div className="empty-state">
          <h3>No servers found</h3>
          <p>Try another search or category.</p>
        </div>
      ) : (
        <div className="server-grid">
          {servers.map((s) => (
            <article className={`server-card${s.featured ? ' featured' : ''}`} key={s.slug}>
              <div className="server-card-banner">
                <ServerBanner server={s} />
                {s.featured && <span className="ribbon">Featured</span>}
                <span className={`server-online ${s.online ? 'on' : 'off'}`}>
                  <span className="dot" />
                  {s.online ? `${s.players ?? 0} / ${s.maxPlayers ?? '?'}` : 'Offline'}
                </span>
              </div>
              <div className="server-card-body">
                <div className="server-card-title">
                  <h3>{s.name}</h3>
                  {s.rating !== null && (
                    <span className="server-rating">
                      <Stars rating={s.rating} /> <span className="muted">({s.ratingCount})</span>
                    </span>
                  )}
                </div>
                <button className="server-host" title="Copy address" onClick={() => copy(s.host)}>
                  {s.host}
                  <span className="muted">{copied === s.host ? 'copied' : 'copy'}</span>
                </button>
                <p className="server-summary">{s.summary}</p>
                <div className="server-tags">
                  {s.versions && <span className="tag-chip version">{s.versions}</span>}
                  {s.tags.slice(0, 4).map((t) => (
                    <span key={t} className="tag-chip">
                      {t}
                    </span>
                  ))}
                </div>
              </div>
              <div className="server-card-foot">
                <span className="server-votes">
                  <Icon name="heart" size={14} /> {s.votes} this month
                </span>
                <button className="play-button small" disabled={!s.online} onClick={() => setJoining(s)}>
                  <Icon name="play" size={14} /> Join
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {joining && <JoinServerDialog server={joining} onClose={() => setJoining(undefined)} />}
    </div>
  )
}
