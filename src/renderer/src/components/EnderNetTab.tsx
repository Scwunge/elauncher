import { useEffect, useRef, useState } from 'react'
import { useEnderNet } from '../state'
import type { SiteEntry } from '../types'
import Icon from './Icon'
import { useApiBase } from './ServerBanner'

interface Props {
  page: string
  onPageChange: (page: string) => void
}

/** The phone's own pages, always listed. Anything else in the Sites directory is added below. */
const CORE_PAGES: { page: string; label: string; icon: string; blurb: string }[] = [
  { page: 'enderchat', label: 'EnderChat', icon: 'chat', blurb: 'DMs and groups' },
  { page: 'enderbook', label: 'Enderbook', icon: 'book', blurb: 'The social feed' },
  { page: 'endportal', label: 'Endportal', icon: 'portal', blurb: 'Vote and review servers' },
  { page: 'sites', label: 'Sites', icon: 'globe', blurb: 'The phone’s web directory' },
  { page: 'hosting', label: 'Hosting', icon: 'server', blurb: 'Rent a server' },
  { page: 'signin', label: 'Account', icon: 'user', blurb: 'Password, email, linking' },
]

/** Pages that must open in the real browser - anything with a payment in it. */
const EXTERNAL_PAGES = new Set(['donate'])

type WebviewEl = HTMLElement & {
  reload: () => void
  goBack: () => void
  goForward: () => void
  canGoBack: () => boolean
  canGoForward: () => boolean
}

/**
 * EnderNet inside the launcher: the same pages the phone's Browser app opens, signed in with the
 * launcher's session (handed over in the URL fragment, which never reaches a server log - the
 * pages' own convention). The <webview> is locked down in the main process: no Node, no preload,
 * its own partition, and only the API's origin.
 */
export default function EnderNetTab({ page, onPageChange }: Props) {
  const { session, requestConnect } = useEnderNet()
  const base = useApiBase()
  const [url, setUrl] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [extra, setExtra] = useState<SiteEntry[]>([])
  const viewRef = useRef<WebviewEl>(null)

  useEffect(() => {
    window.api.endernet.sites().then((r) => {
      if (!r.ok) return
      const known = new Set([...CORE_PAGES.map((p) => p.page), 'minebook'])
      setExtra(r.data.sites.filter((s) => !known.has(s.slug)))
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    window.api.endernet.pageUrl(page).then((r) => {
      if (!cancelled && r.ok) setUrl(r.data)
    })
    return () => {
      cancelled = true
    }
    // Re-sign the page when the session changes (connect/disconnect).
  }, [page, session.connected])

  useEffect(() => {
    const el = viewRef.current
    if (!el) return
    const start = () => setLoading(true)
    const stop = () => setLoading(false)
    el.addEventListener('did-start-loading', start)
    el.addEventListener('did-stop-loading', stop)
    return () => {
      el.removeEventListener('did-start-loading', start)
      el.removeEventListener('did-stop-loading', stop)
    }
  }, [url])

  function openSite(site: SiteEntry) {
    const m = /^\/app\/([a-z0-9-]{1,32})$/.exec(site.url)
    if (m && !EXTERNAL_PAGES.has(m[1]!)) onPageChange(m[1]!)
    else if (base) void window.api.shell.openExternal(site.url.startsWith('/') ? `${base}${site.url}` : site.url)
  }

  const current = CORE_PAGES.find((p) => p.page === page)

  return (
    <div className="endernet">
      <aside className="endernet-nav">
        <div className="endernet-nav-head">
          <Icon name="phone" size={18} />
          <span>EnderNet</span>
        </div>
        {CORE_PAGES.map((p) => (
          <button key={p.page} className={`endernet-link${page === p.page ? ' active' : ''}`} onClick={() => onPageChange(p.page)}>
            <Icon name={p.icon} size={18} />
            <span>
              <strong>{p.label}</strong>
              <small>{p.blurb}</small>
            </span>
          </button>
        ))}
        {extra.length > 0 && <div className="endernet-nav-sub">More on Sites</div>}
        {extra.map((s) => (
          <button key={s.slug} className={`endernet-link${page === s.slug ? ' active' : ''}`} onClick={() => openSite(s)}>
            {base && s.icon ? <img className="site-icon" src={`${base}/app/assets/${s.icon}`} alt="" /> : <Icon name="globe" size={18} />}
            <span>
              <strong>{s.name}</strong>
              <small>{s.tagline}</small>
            </span>
          </button>
        ))}
        <div className="endernet-nav-foot">
          {session.connected ? (
            <span className="field-hint">
              <span className="dot good" /> Signed in as {session.name}
            </span>
          ) : (
            <button className="secondary-button full" onClick={requestConnect}>
              Connect to sign these pages in
            </button>
          )}
          <button
            className="link-button"
            onClick={() => base && window.api.shell.openExternal(`${base}/app/donate`)}
          >
            <Icon name="heart" size={14} /> Support EnderPhone
          </button>
        </div>
      </aside>

      <div className="endernet-view">
        <div className="endernet-toolbar">
          <button className="icon-button small" title="Back" onClick={() => viewRef.current?.canGoBack() && viewRef.current.goBack()}>
            <Icon name="back" size={16} />
          </button>
          <button className="icon-button small" title="Reload" onClick={() => viewRef.current?.reload()}>
            <Icon name="refresh" size={16} />
          </button>
          <div className="endernet-address">
            <Icon name="lock" size={13} />
            <span>{base ? `${new URL(base).host}/app/${page}` : ''}</span>
            {loading && <span className="spinner" />}
          </div>
          <button
            className="icon-button small"
            title="Open in your browser"
            onClick={() => base && window.api.shell.openExternal(`${base}/app/${page}`)}
          >
            <Icon name="external" size={16} />
          </button>
        </div>
        {url ? (
          <webview key={url} ref={viewRef as never} className="endernet-webview" src={url} partition="persist:endernet" />
        ) : (
          <div className="empty-state">
            <p>Opening {current?.label ?? page}…</p>
          </div>
        )}
      </div>
    </div>
  )
}
