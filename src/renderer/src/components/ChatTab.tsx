import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react'
import { dmPeer, nameColour, previewText, shortTime, threadItems, type UiMessage } from '../chat-model'
import { useChat } from '../chat-state'
import { useEnderNet } from '../state'
import type { Conversation, Screenshot } from '../types'
import { AddMemberDialog, ImageViewer, NewChatDialog, RenameDialog, ReportDialog, ScreenshotPicker } from './ChatDialogs'
import { ClipPlayer, toPngBase64 } from './ChatMedia'
import Icon from './Icon'
import { GroupFace, PlayerFace } from './PlayerFace'

const MAX_LEN = 1000

const REALTIME_LABEL: Record<string, string> = {
  live: 'Live',
  connecting: 'Connecting…',
  retrying: 'Reconnecting…',
  off: 'Checking every few seconds',
  'signed-out': 'Offline',
}

/**
 * EnderChat, native in the launcher: the same DMs, groups and EnderCloud as the phone's Messages
 * app and the EnderChat page, live both ways - a message sent here shows on the phone in-game.
 */
export default function ChatTab() {
  const chat = useChat()
  const { session, requestConnect } = useEnderNet()
  const [filter, setFilter] = useState('')
  const [dialog, setDialog] = useState<'dm' | 'group'>()

  useEffect(() => {
    chat.setVisible(true)
    const onVis = () => chat.setVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', onVis)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      chat.setVisible(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Open the most recent conversation the first time the page shows, rather than an empty pane.
  useEffect(() => {
    if (!chat.open && chat.conversations.length) {
      const first = chat.conversations.find((c) => !c.system) ?? chat.conversations[0]!
      chat.setOpen({ conversationId: first.id })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.conversations.length])

  if (!session.connected) {
    return (
      <div className="chat-signedout">
        <div className="empty-state big">
          <div className="empty-state-icon">
            <Icon name="chat" size={40} />
          </div>
          <h3>EnderChat</h3>
          <p>Your DMs, groups and EnderCloud from the phone, right here - and live, so what you send shows up in game.</p>
          <button className="primary-button" onClick={requestConnect}>
            Connect to EnderNet
          </button>
        </div>
      </div>
    )
  }

  const q = filter.trim().toLowerCase()
  const visible = q ? chat.conversations.filter((c) => c.name.toLowerCase().includes(q) || c.members.some((m) => m.name.toLowerCase().includes(q))) : chat.conversations
  const groups = visible.filter((c) => c.kind === 'group')
  const dms = visible.filter((c) => c.kind !== 'group')
  const openId = chat.open && 'conversationId' in chat.open ? chat.open.conversationId : undefined

  return (
    <div className="chat">
      <aside className="chat-list">
        <div className="chat-list-head">
          <div className="chat-title">
            <Icon name="chat" size={18} />
            <span>EnderChat</span>
          </div>
          <span className={`realtime-pill ${chat.realtime}`} title={REALTIME_LABEL[chat.realtime]}>
            <span className="dot" />
            {chat.realtime === 'live' ? 'Live' : chat.realtime === 'off' ? 'Polling' : '…'}
          </span>
        </div>
        <div className="chat-list-actions">
          <div className="search-box grow">
            <Icon name="search" size={15} />
            <input type="text" placeholder="Find a chat" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
          <button className="icon-button" title="New message or group" onClick={() => setDialog('dm')}>
            <Icon name="plus" size={17} />
          </button>
        </div>

        <div className="chat-list-scroll">
          {!chat.ready ? (
            <p className="field-hint pad">Loading your chats…</p>
          ) : chat.error && chat.conversations.length === 0 ? (
            <p className="error-text pad">{chat.error}</p>
          ) : (
            <>
              {groups.length > 0 && <div className="chat-section">Groups</div>}
              {groups.map((c) => (
                <ConversationRow key={c.id} c={c} active={openId === c.id} onClick={() => chat.setOpen({ conversationId: c.id })} />
              ))}
              <div className="chat-section">
                Direct messages
                <button className="link-button" onClick={() => setDialog('dm')}>
                  New
                </button>
              </div>
              {chat.open && 'uuid' in chat.open && (
                <div className="chat-row active draft">
                  <PlayerFace uuid={chat.open.uuid} name={chat.open.name} size={36} />
                  <div className="chat-row-text">
                    <div className="chat-row-name">{chat.open.name}</div>
                    <div className="chat-row-preview">New message</div>
                  </div>
                </div>
              )}
              {dms.length === 0 && !(chat.open && 'uuid' in chat.open) && <p className="field-hint pad">No DMs yet. Message a friend from the sidebar, or press +.</p>}
              {dms.map((c) => (
                <ConversationRow key={c.id} c={c} active={openId === c.id} onClick={() => chat.setOpen({ conversationId: c.id })} />
              ))}
              <button className="link-button pad" onClick={() => setDialog('group')}>
                <Icon name="users" size={14} /> Start a group
              </button>
            </>
          )}
        </div>
      </aside>

      {chat.open ? (
        <Thread key={openId ?? ('uuid' in chat.open ? chat.open.uuid : '')} />
      ) : (
        <div className="chat-empty">
          <div className="empty-state">
            <Icon name="chat" size={36} />
            <h3>Pick a chat</h3>
            <p>Or start one with the + button.</p>
          </div>
        </div>
      )}

      {dialog && <NewChatDialog mode={dialog} onClose={() => setDialog(undefined)} />}
    </div>
  )
}

function ConversationRow({ c, active, onClick }: { c: Conversation; active: boolean; onClick: () => void }) {
  const { session } = useEnderNet()
  const peer = c.kind !== 'group' ? dmPeer(c, session.uuid) : undefined
  return (
    <button className={`chat-row${active ? ' active' : ''}${c.unread ? ' unread' : ''}`} onClick={onClick}>
      {peer ? <PlayerFace uuid={peer.uuid} name={peer.name} size={36} online={peer.online} /> : <GroupFace conversation={c} size={36} />}
      <div className="chat-row-text">
        <div className="chat-row-top">
          <span className="chat-row-name">{c.name}</span>
          <span className="chat-row-time">{c.lastAt ? shortTime(c.lastAt) : ''}</span>
        </div>
        <div className="chat-row-bottom">
          <span className="chat-row-preview">{previewText(c)}</span>
          {c.unread > 0 && <span className="unread-badge">{c.unread > 99 ? '99+' : c.unread}</span>}
        </div>
      </div>
    </button>
  )
}

/* ------------------------------------------------------------------ the open conversation */

function Thread() {
  const chat = useChat()
  const { session } = useEnderNet()
  const me = session.uuid
  const convo = chat.openConversation
  const draft = chat.open && 'uuid' in chat.open ? chat.open : undefined
  const [showMembers, setShowMembers] = useState(false)
  const [dialog, setDialog] = useState<'add' | 'rename' | 'report' | 'shots'>()
  const [viewing, setViewing] = useState<string>()
  const [dragOver, setDragOver] = useState(false)
  const [text, setText] = useState('')
  const [attachment, setAttachment] = useState<{ base64: string } | { shot: Screenshot }>()
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string>()
  const scroller = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const stick = useRef(true)

  const items = useMemo(() => threadItems(chat.messages ?? []), [chat.messages])
  const names = useMemo(() => new Map(convo?.members.map((m) => [m.uuid, m.name]) ?? []), [convo])
  const peer = convo && convo.kind !== 'group' ? dmPeer(convo, me) : draft ? { uuid: draft.uuid, name: draft.name, online: false } : undefined
  const isGroup = convo?.kind === 'group'
  const owner = !!convo && convo.ownerUuid === me
  const title = convo?.name ?? draft?.name ?? ''

  // Stay pinned to the bottom as messages arrive, unless the player has scrolled up to read.
  useLayoutEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [items.length])

  useEffect(() => {
    input.current?.focus()
  }, [])

  async function submit() {
    if (sending) return
    setError(undefined)
    const caption = text.trim()
    if (!attachment && !caption) return
    setSending(true)
    stick.current = true
    let err: string | undefined
    if (attachment && 'base64' in attachment) err = await chat.sendImage(attachment.base64, caption)
    else if (attachment) err = await chat.sendScreenshot(attachment.shot.path, caption, attachment.shot.thumb)
    else err = await chat.send(caption)
    setSending(false)
    if (err) setError(err)
    else {
      setText('')
      setAttachment(undefined)
      input.current?.focus()
    }
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void submit()
    }
  }

  async function attachFile(file: Blob) {
    setError(undefined)
    try {
      setAttachment({ base64: await toPngBase64(file) })
    } catch (err) {
      setError((err as Error).message)
    }
  }

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const item = [...e.clipboardData.items].find((i) => i.type.startsWith('image/'))
    const file = item?.getAsFile()
    if (file) {
      e.preventDefault()
      void attachFile(file)
    }
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragOver(false)
    const file = [...e.dataTransfer.files].find((f) => f.type.startsWith('image/'))
    if (file) void attachFile(file)
  }

  async function leave() {
    if (!convo || !confirm(`Leave ${convo.name}? You'll need someone to add you back.`)) return
    const r = await chat.act(() => window.api.chat.leave(convo.id))
    if (r.ok) chat.setOpen(undefined)
    else alert(r.error)
  }

  async function kick(uuid: string, name: string) {
    if (!convo || !confirm(`Remove ${name} from ${convo.name}?`)) return
    const r = await chat.act(() => window.api.chat.removeMember(convo.id, uuid))
    if (!r.ok) alert(r.error)
  }

  const onlineCount = convo?.members.filter((m) => m.online).length ?? 0

  return (
    <section
      className={`chat-thread${dragOver ? ' dragover' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragOver(false)}
      onDrop={onDrop}
    >
      <header className="chat-head">
        {peer && !isGroup ? <PlayerFace uuid={peer.uuid} name={peer.name} size={34} online={peer.online} /> : convo ? <GroupFace conversation={convo} size={34} /> : null}
        <div className="chat-head-text">
          <h2>
            {title}
            {convo?.system && <span className="tag tag-official">Everyone</span>}
          </h2>
          <span className="chat-head-sub">
            {isGroup ? `${convo!.members.length} members · ${onlineCount} online` : peer?.online ? 'Online' : draft ? 'Your first message starts the chat' : 'Offline'}
          </span>
        </div>
        <div className="chat-head-actions">
          {isGroup && !convo!.system && (
            <button className="icon-button" title="Add people" onClick={() => setDialog('add')}>
              <Icon name="plus" size={17} />
            </button>
          )}
          {isGroup && owner && !convo!.system && (
            <button className="icon-button" title="Rename" onClick={() => setDialog('rename')}>
              <Icon name="gear" size={16} />
            </button>
          )}
          {isGroup && (
            <button className={`icon-button${showMembers ? ' on' : ''}`} title="Members" onClick={() => setShowMembers((v) => !v)}>
              <Icon name="users" size={17} />
            </button>
          )}
          {isGroup && !convo!.system && (
            <button className="icon-button" title="Leave group" onClick={leave}>
              <Icon name="logout" size={17} />
            </button>
          )}
          {peer && !isGroup && peer.uuid !== me && (
            <button className="icon-button" title={`Report or block ${peer.name}`} onClick={() => setDialog('report')}>
              <Icon name="flag" size={16} />
            </button>
          )}
        </div>
      </header>

      <div className="chat-body">
        <div
          className="chat-scroll"
          ref={scroller}
          onScroll={(e) => {
            const el = e.currentTarget
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
          }}
        >
          {chat.messages === undefined ? (
            <p className="field-hint pad">Loading…</p>
          ) : items.length === 0 ? (
            <div className="chat-hello">
              {peer && !isGroup ? <PlayerFace uuid={peer.uuid} name={peer.name} size={64} /> : convo ? <GroupFace conversation={convo} size={64} /> : null}
              <h3>{draft ? `Say hi to ${draft.name}` : `This is the start of ${title}`}</h3>
              <p>Messages here show up on the phone in-game too.</p>
            </div>
          ) : (
            items.map((item) =>
              item.kind === 'day' ? (
                <div className="chat-day" key={item.key}>
                  <span>{item.label}</span>
                </div>
              ) : (
                <MessageRow
                  key={item.key}
                  m={item.message}
                  head={item.head}
                  mine={item.message.fromUuid === me}
                  name={names.get(item.message.fromUuid) ?? (item.message.fromUuid === me ? session.name : peer?.name) ?? 'Unknown'}
                  showName={isGroup}
                  onImage={setViewing}
                  onRetry={() => chat.retry(item.message)}
                />
              ),
            )
          )}
        </div>

        {showMembers && convo && isGroup && (
          <aside className="chat-members">
            <h4>Members — {convo.members.length}</h4>
            {[...convo.members]
              .sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name))
              .map((m) => (
                <div key={m.uuid} className={`member-row${m.online ? '' : ' away'}`}>
                  <PlayerFace uuid={m.uuid} name={m.name} size={28} online={m.online} />
                  <span className="member-name">
                    {m.name}
                    {convo.ownerUuid === m.uuid && <span className="owner-tag">owner</span>}
                  </span>
                  {m.uuid !== me && (
                    <span className="member-actions">
                      <button className="icon-button small" title={`Message ${m.name}`} onClick={() => chat.openDirect(m.uuid, m.name)}>
                        <Icon name="chat" size={13} />
                      </button>
                      {owner && !convo.system && (
                        <button className="icon-button small" title={`Remove ${m.name}`} onClick={() => kick(m.uuid, m.name)}>
                          <Icon name="x" size={13} />
                        </button>
                      )}
                    </span>
                  )}
                </div>
              ))}
          </aside>
        )}
      </div>

      <div className="chat-compose">
        {attachment && (
          <div className="attach-preview">
            <img src={'base64' in attachment ? `data:image/png;base64,${attachment.base64}` : attachment.shot.thumb} alt="" />
            <span>{'shot' in attachment ? `${attachment.shot.instance} screenshot` : 'Image'} - add a caption, or just send</span>
            <button className="icon-button small" title="Remove" onClick={() => setAttachment(undefined)}>
              <Icon name="x" size={13} />
            </button>
          </div>
        )}
        {error && (
          <p className="error-text compose-error">
            {error}{' '}
            <button className="link-button" onClick={() => setError(undefined)}>
              Dismiss
            </button>
          </p>
        )}
        <div className="compose-row">
          <button className="icon-button" title="Send a screenshot from your instances" onClick={() => setDialog('shots')}>
            <Icon name="camera" size={18} />
          </button>
          <label className="icon-button" title="Attach an image (or paste one)">
            <Icon name="image" size={18} />
            <input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && attachFile(e.target.files[0])} />
          </label>
          <textarea
            ref={input}
            rows={1}
            maxLength={MAX_LEN}
            placeholder={`Message ${isGroup ? convo!.name : (peer?.name ?? '')}`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            onPaste={onPaste}
          />
          {text.length > MAX_LEN - 100 && <span className="compose-count">{MAX_LEN - text.length}</span>}
          <button className="send-button" title="Send (Enter)" disabled={sending || (!text.trim() && !attachment)} onClick={submit}>
            {sending ? <span className="spinner" /> : <Icon name="send" size={17} />}
          </button>
        </div>
      </div>

      {dialog === 'add' && convo && <AddMemberDialog conversation={convo} onClose={() => setDialog(undefined)} />}
      {dialog === 'rename' && convo && <RenameDialog conversation={convo} onClose={() => setDialog(undefined)} />}
      {dialog === 'report' && peer && <ReportDialog uuid={peer.uuid} name={peer.name} onClose={() => setDialog(undefined)} />}
      {dialog === 'shots' && (
        <ScreenshotPicker
          onClose={() => setDialog(undefined)}
          onPick={(shot) => {
            setAttachment({ shot })
            setDialog(undefined)
            input.current?.focus()
          }}
        />
      )}
      {viewing && <ImageViewer url={viewing} onClose={() => setViewing(undefined)} />}
    </section>
  )
}

function MessageRow({
  m,
  head,
  mine,
  name,
  showName,
  onImage,
  onRetry,
}: {
  m: UiMessage
  head: boolean
  mine: boolean
  name: string
  showName: boolean
  onImage: (url: string) => void
  onRetry: () => void
}) {
  const time = new Date(m.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return (
    <div className={`msg${head ? ' head' : ''}${mine ? ' mine' : ''}${m.pending ? ' pending' : ''}${m.failed ? ' failed' : ''}`}>
      <div className="msg-gutter">{head ? <PlayerFace uuid={m.fromUuid} name={name} size={34} /> : <span className="msg-hover-time">{time}</span>}</div>
      <div className="msg-main">
        {head && (
          <div className="msg-meta">
            <span className="msg-name" style={showName && !mine ? { color: nameColour(m.fromUuid) } : undefined}>
              {name}
            </span>
            <span className="msg-time">{time}</span>
          </div>
        )}
        {m.photoUrl &&
          (m.photoKind === 'clip' ? (
            <ClipPlayer url={m.photoUrl} />
          ) : (
            <button className="msg-photo" onClick={() => onImage(m.photoUrl!)}>
              <img src={m.photoUrl} alt="" loading="lazy" />
            </button>
          ))}
        {m.body && <div className="msg-body">{m.body}</div>}
        {m.failed && (
          <div className="msg-failed">
            Not sent.{' '}
            {!m.photoId && (
              <button className="link-button" onClick={onRetry}>
                Try again
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
