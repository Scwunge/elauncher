import { useEffect, useMemo, useState } from 'react'
import { useChat } from '../chat-state'
import { timeAgo, useEnderNet } from '../state'
import type { Conversation, Screenshot } from '../types'
import Icon from './Icon'
import { PlayerFace } from './PlayerFace'

type Person = { uuid: string; name: string; online?: boolean; avatar?: string }

/** Friends first, then anyone on EnderNet matching what's typed (two letters or more). */
function usePeopleSearch(query: string, exclude: Set<string>) {
  const { friends } = useEnderNet()
  const [found, setFound] = useState<Person[]>([])
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setFound([])
      return
    }
    const t = setTimeout(async () => {
      const r = await window.api.endernet.searchPlayers(q)
      setFound(r.ok ? r.data.players : [])
    }, 250)
    return () => clearTimeout(t)
  }, [query])
  return useMemo(() => {
    const q = query.trim().toLowerCase()
    const mine = (friends?.friends ?? []).filter((f) => !q || f.name.toLowerCase().includes(q))
    const seen = new Set(mine.map((f) => f.uuid))
    const rest = found.filter((p) => !seen.has(p.uuid))
    return [...mine, ...rest].filter((p) => !exclude.has(p.uuid)).slice(0, 30)
  }, [friends, found, query, exclude])
}

function PersonRow({ p, onClick, selected }: { p: Person; onClick: () => void; selected?: boolean }) {
  return (
    <button className={`person-row${selected ? ' selected' : ''}`} onClick={onClick}>
      <PlayerFace uuid={p.uuid} name={p.name} avatar={p.avatar} size={30} online={p.online} />
      <span className="person-name">{p.name}</span>
      {p.online && <span className="person-sub">online</span>}
      {selected !== undefined && <span className={`person-check${selected ? ' on' : ''}`}>{selected && <Icon name="check" size={13} />}</span>}
    </button>
  )
}

function Overlay({ children, onClose, className }: { children: React.ReactNode; onClose: () => void; className?: string }) {
  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className={`settings-panel ${className ?? ''}`} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ new message / new group */

export function NewChatDialog({ mode: initial, onClose }: { mode: 'dm' | 'group'; onClose: () => void }) {
  const { openDirect, act, setOpen } = useChat()
  const { session } = useEnderNet()
  const [mode, setMode] = useState(initial)
  const [query, setQuery] = useState('')
  const [name, setName] = useState('')
  const [picked, setPicked] = useState<Person[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const exclude = useMemo(() => new Set([session.uuid ?? '']), [session.uuid])
  const people = usePeopleSearch(query, exclude)

  function toggle(p: Person) {
    setPicked((prev) => (prev.some((x) => x.uuid === p.uuid) ? prev.filter((x) => x.uuid !== p.uuid) : [...prev, p]))
  }

  async function createGroup() {
    setBusy(true)
    setError(undefined)
    const r = await act(() => window.api.chat.createGroup(name.trim(), picked.map((p) => p.name)))
    setBusy(false)
    if (!r.ok) return setError(r.error)
    setOpen({ conversationId: r.data.id })
    onClose()
  }

  return (
    <Overlay onClose={onClose} className="chat-dialog">
      <div className="seg-row chat-dialog-tabs">
        <button className={`seg${mode === 'dm' ? ' active' : ''}`} onClick={() => setMode('dm')}>
          Message someone
        </button>
        <button className={`seg${mode === 'group' ? ' active' : ''}`} onClick={() => setMode('group')}>
          New group
        </button>
      </div>

      {mode === 'group' && (
        <div className="field">
          <label>Group name</label>
          <input type="text" autoFocus maxLength={40} value={name} onChange={(e) => setName(e.target.value)} placeholder="Base builders" />
        </div>
      )}

      <div className="search-box">
        <Icon name="search" size={16} />
        <input
          type="text"
          autoFocus={mode === 'dm'}
          placeholder="Friends, or any player's name…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {mode === 'group' && picked.length > 0 && (
        <div className="picked-row">
          {picked.map((p) => (
            <button key={p.uuid} className="picked-chip" onClick={() => toggle(p)} title="Remove">
              {p.name} <Icon name="x" size={12} />
            </button>
          ))}
        </div>
      )}

      <div className="person-list">
        {people.length === 0 ? (
          <p className="field-hint">{query.trim().length < 2 ? 'Type a name to find anyone on EnderNet.' : 'Nobody by that name on EnderNet yet.'}</p>
        ) : (
          people.map((p) =>
            mode === 'dm' ? (
              <PersonRow
                key={p.uuid}
                p={p}
                onClick={() => {
                  openDirect(p.uuid, p.name)
                  onClose()
                }}
              />
            ) : (
              <PersonRow key={p.uuid} p={p} selected={picked.some((x) => x.uuid === p.uuid)} onClick={() => toggle(p)} />
            ),
          )
        )}
      </div>

      {error && <p className="error-text">{error}</p>}
      <div className="settings-actions">
        <button className="secondary-button" onClick={onClose}>
          Cancel
        </button>
        {mode === 'group' && (
          <button className="primary-button" disabled={busy || !name.trim()} onClick={createGroup}>
            {busy ? 'Creating…' : `Create group${picked.length ? ` with ${picked.length}` : ''}`}
          </button>
        )}
      </div>
    </Overlay>
  )
}

/* ------------------------------------------------------------------ add people */

export function AddMemberDialog({ conversation, onClose }: { conversation: Conversation; onClose: () => void }) {
  const { act } = useChat()
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<string>()
  const [added, setAdded] = useState<string[]>([])
  const [error, setError] = useState<string>()
  const exclude = useMemo(() => new Set(conversation.members.map((m) => m.uuid)), [conversation.members])
  const people = usePeopleSearch(query, exclude)

  async function add(nameToAdd: string) {
    setBusy(nameToAdd)
    setError(undefined)
    const r = await act(() => window.api.chat.addMember(conversation.id, nameToAdd))
    setBusy(undefined)
    if (r.ok) setAdded((a) => [...a, r.data.name])
    else setError(r.error)
  }

  return (
    <Overlay onClose={onClose} className="chat-dialog">
      <h2>Add people to {conversation.name}</h2>
      <form
        className="search-box"
        onSubmit={(e) => {
          e.preventDefault()
          if (query.trim()) void add(query.trim())
        }}
      >
        <Icon name="search" size={16} />
        <input type="text" autoFocus placeholder="A friend, or a Minecraft name + Enter" value={query} onChange={(e) => setQuery(e.target.value)} />
      </form>
      <div className="person-list">
        {people.map((p) => (
          <PersonRow key={p.uuid} p={p} onClick={() => !busy && add(p.name)} />
        ))}
      </div>
      {added.length > 0 && <p className="good-text">Added {added.join(', ')}.</p>}
      {error && <p className="error-text">{error}</p>}
      <div className="settings-actions">
        <button className="primary-button" onClick={onClose}>
          Done
        </button>
      </div>
    </Overlay>
  )
}

/* ------------------------------------------------------------------ rename */

export function RenameDialog({ conversation, onClose }: { conversation: Conversation; onClose: () => void }) {
  const { act } = useChat()
  const [name, setName] = useState(conversation.name)
  const [error, setError] = useState<string>()
  return (
    <Overlay onClose={onClose} className="chat-dialog small">
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          const r = await act(() => window.api.chat.rename(conversation.id, name.trim()))
          if (r.ok) onClose()
          else setError(r.error)
        }}
      >
        <h2>Rename group</h2>
        <div className="field">
          <input type="text" autoFocus maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        {error && <p className="error-text">{error}</p>}
        <div className="settings-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary-button" disabled={!name.trim() || name.trim() === conversation.name}>
            Rename
          </button>
        </div>
      </form>
    </Overlay>
  )
}

/* ------------------------------------------------------------------ report / block */

const REASONS = [
  { id: 'harassment', label: 'Harassment or bullying' },
  { id: 'spam', label: 'Spam' },
  { id: 'inappropriate', label: 'Inappropriate content' },
  { id: 'other', label: 'Something else' },
] as const

export function ReportDialog({ uuid, name, onClose }: { uuid: string; name: string; onClose: () => void }) {
  const { reload } = useChat()
  const { reloadFriends } = useEnderNet()
  const [reason, setReason] = useState<(typeof REASONS)[number]['id']>('harassment')
  const [block, setBlock] = useState(true)
  const [done, setDone] = useState<string>()
  const [error, setError] = useState<string>()

  async function submit() {
    setError(undefined)
    const r = await window.api.chat.report(uuid, reason)
    if (!r.ok) return setError(r.error)
    if (block) {
      const b = await window.api.chat.block(uuid)
      if (!b.ok) return setError(b.error)
      await Promise.all([reload(), reloadFriends()])
    }
    setDone(block ? `Reported and blocked ${name}.` : `Reported ${name}. Thanks - an operator will look at it.`)
  }

  return (
    <Overlay onClose={onClose} className="chat-dialog small">
      <h2>Report {name}</h2>
      {done ? (
        <p className="good-text">
          <Icon name="check" size={14} /> {done}
        </p>
      ) : (
        <>
          <div className="field">
            <label>What's wrong?</label>
            <div className="reason-list">
              {REASONS.map((r) => (
                <label key={r.id} className="check-row">
                  <input type="radio" name="reason" checked={reason === r.id} onChange={() => setReason(r.id)} /> {r.label}
                </label>
              ))}
            </div>
          </div>
          <label className="check-row">
            <input type="checkbox" checked={block} onChange={(e) => setBlock(e.target.checked)} /> Also block {name} (you won't see their messages, and they can't message you)
          </label>
        </>
      )}
      {error && <p className="error-text">{error}</p>}
      <div className="settings-actions">
        <button className="secondary-button" onClick={onClose}>
          {done ? 'Close' : 'Cancel'}
        </button>
        {!done && (
          <button className="danger-button solid" onClick={submit}>
            Report
          </button>
        )}
      </div>
    </Overlay>
  )
}

/* ------------------------------------------------------------------ screenshots */

/** Your newest screenshots across every instance - F2 in game, then send it here. */
export function ScreenshotPicker({ onPick, onClose }: { onPick: (s: Screenshot) => void; onClose: () => void }) {
  const [shots, setShots] = useState<Screenshot[]>()
  const [error, setError] = useState<string>()
  useEffect(() => {
    window.api.chat.screenshots().then((r) => (r.ok ? setShots(r.data) : setError(r.error)))
  }, [])
  return (
    <Overlay onClose={onClose} className="chat-dialog wide">
      <h2>Send a screenshot</h2>
      <p className="field-hint">Your newest screenshots from every instance (F2 in game).</p>
      {error ? (
        <p className="error-text">{error}</p>
      ) : shots === undefined ? (
        <p className="field-hint">Looking…</p>
      ) : shots.length === 0 ? (
        <div className="empty-state">
          <h3>No screenshots yet</h3>
          <p>Press F2 in game, and they'll show up here.</p>
        </div>
      ) : (
        <div className="shot-grid">
          {shots.map((s) => (
            <button key={s.path} className="shot" onClick={() => onPick(s)} title={s.name}>
              <img src={s.thumb} alt="" />
              <span>
                {s.instance} · {timeAgo(s.takenAt)}
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="settings-actions">
        <button className="secondary-button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Overlay>
  )
}

/* ------------------------------------------------------------------ image viewer */

export function ImageViewer({ url, onClose }: { url: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="settings-overlay image-viewer" onClick={onClose}>
      <img src={url} alt="" onClick={(e) => e.stopPropagation()} />
      {/^https?:/.test(url) && (
        <button
          className="secondary-button image-viewer-open"
          onClick={(e) => {
            e.stopPropagation()
            void window.api.shell.openExternal(url)
          }}
        >
          <Icon name="external" size={15} /> Open in browser
        </button>
      )}
    </div>
  )
}
