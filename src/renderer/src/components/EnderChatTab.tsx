import { useEffect, useRef, useState } from 'react'
import { useChat, type OpenRequest } from '../chat-state'
import { useEnderNet } from '../state'
import Icon from './Icon'

type WebviewEl = HTMLElement & {
  executeJavaScript: (code: string) => Promise<unknown>
  reload: () => void
}

/** How often a fresh session token is handed to the page (the API's last 12 hours). */
const TOKEN_REFRESH_MS = 30 * 60 * 1000

function fragmentFor(req: OpenRequest): string {
  return 'conversationId' in req ? `c=${req.conversationId}` : `dm=${encodeURIComponent(req.uuid)}`
}

/**
 * EnderChat - the Discord-style EnderChat page itself (api.enderphone.cloud/app/enderchat), in a
 * tab, signed in with the launcher's session. Kept mounted once opened (App hides it rather than
 * unmounting), so switching tabs doesn't reload it or lose your place.
 *
 * The page takes instructions through its URL fragment: `t=` a session token, `c=` a conversation
 * to open, `dm=` a player to open your DM with. The first load carries them in the URL; after
 * that they're set on `location.hash`, which the page listens for - so opening a chat from a
 * notification or a friend in the sidebar, and handing over a fresh token, never reloads it.
 */
export default function EnderChatTab({ active }: { active: boolean }) {
  const { session, requestConnect } = useEnderNet()
  const { request, setVisible } = useChat()
  const [url, setUrl] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const viewRef = useRef<WebviewEl>(null)
  const ready = useRef(false)
  const handled = useRef(0)

  useEffect(() => {
    setVisible(active)
    return () => setVisible(false)
  }, [active, setVisible])

  // The page's URL, signed in. A request that's already waiting rides along on the first load.
  useEffect(() => {
    if (!session.connected) {
      setUrl(undefined)
      return
    }
    let cancelled = false
    ready.current = false
    setLoading(true)
    setFailed(false)
    window.api.endernet.pageUrl('enderchat').then((r) => {
      if (cancelled) return
      if (!r.ok) {
        setFailed(true)
        return
      }
      let next = r.data
      if (request && request.seq > handled.current) {
        handled.current = request.seq
        next += `${next.includes('#') ? '&' : '#'}${fragmentFor(request)}`
      }
      setUrl(next)
    })
    return () => {
      cancelled = true
    }
    // Only a change of session means a new page; requests after that go through the hash.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.connected, session.uuid])

  // Load events, and knowing when the page can take a hash instruction.
  useEffect(() => {
    const el = viewRef.current
    if (!el) return
    const stop = () => {
      setLoading(false)
      ready.current = true
    }
    const start = () => setLoading(true)
    const fail = (e: Event) => {
      // -3 is an aborted load (a navigation replaced it), not a failure.
      if ((e as Event & { errorCode?: number }).errorCode !== -3) setFailed(true)
    }
    el.addEventListener('did-stop-loading', stop)
    el.addEventListener('did-start-loading', start)
    el.addEventListener('did-fail-load', fail)
    return () => {
      el.removeEventListener('did-stop-loading', stop)
      el.removeEventListener('did-start-loading', start)
      el.removeEventListener('did-fail-load', fail)
    }
  }, [url])

  // "Open this chat" after the page is up: set it on the hash.
  useEffect(() => {
    if (!request || request.seq <= handled.current || !ready.current || !viewRef.current) return
    handled.current = request.seq
    void viewRef.current.executeJavaScript(`location.hash = ${JSON.stringify(fragmentFor(request))}`)
  }, [request, loading])

  // A fresh token now and then, so a launcher left open all day never shows "session expired".
  useEffect(() => {
    if (!url) return
    const id = setInterval(async () => {
      if (!ready.current || !viewRef.current) return
      const r = await window.api.endernet.pageUrl('enderchat')
      const t = r.ok ? /[#&]t=([^&]+)/.exec(r.data)?.[1] : undefined
      if (t) void viewRef.current.executeJavaScript(`location.hash = ${JSON.stringify(`t=${t}`)}`)
    }, TOKEN_REFRESH_MS)
    return () => clearInterval(id)
  }, [url])

  if (!session.connected) {
    return (
      <div className="chat-signedout">
        <div className="empty-state big">
          <div className="empty-state-icon">
            <Icon name="chat" size={40} />
          </div>
          <h3>EnderChat</h3>
          <p>Your DMs, groups and EnderCloud, the same as on the phone. Connect to EnderNet to open it.</p>
          <button className="primary-button" onClick={requestConnect}>
            Connect to EnderNet
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="enderchat-host">
      {url && <webview key={url} ref={viewRef as never} className="enderchat-webview" src={url} partition="persist:endernet" />}
      {(loading || !url) && !failed && (
        <div className="enderchat-loading">
          <span className="spinner" /> Opening EnderChat…
        </div>
      )}
      {failed && (
        <div className="enderchat-loading failed">
          <p>Couldn't reach EnderChat.</p>
          <button
            className="secondary-button"
            onClick={() => {
              setFailed(false)
              if (viewRef.current) viewRef.current.reload()
              else window.api.endernet.pageUrl('enderchat').then((r) => r.ok && setUrl(r.data))
            }}
          >
            <Icon name="refresh" size={15} /> Try again
          </button>
        </div>
      )}
    </div>
  )
}
