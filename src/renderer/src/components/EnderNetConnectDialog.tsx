import { useEffect, useState } from 'react'
import { useEnderNet } from '../state'
import Icon from './Icon'

/**
 * EnderNet account: connect (with the EnderPhone password when the account has one), or see who
 * you're connected as and disconnect. The password is sent once for the handshake and never kept -
 * only the session token the API returns is stored.
 */
export default function EnderNetConnectDialog({ onClose }: { onClose: () => void }) {
  const { session, connect, disconnect } = useEnderNet()
  const [needsPassword, setNeedsPassword] = useState(false)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string>()

  async function run(pw?: string) {
    setBusy(true)
    setMessage(undefined)
    const result = await connect(pw)
    setBusy(false)
    if (result.status === 'connected') {
      onClose()
    } else if (result.status === 'password-required') {
      setNeedsPassword(true)
    } else if (result.status === 'wrong-password') {
      setNeedsPassword(true)
      setMessage(result.message)
    } else {
      setMessage(result.message)
    }
  }

  useEffect(() => {
    if (!session.connected) void run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel connect-panel" onClick={(e) => e.stopPropagation()}>
        <div className="connect-head">
          <span className="connect-icon">
            <Icon name="phone" size={22} />
          </span>
          <div>
            <h2>EnderNet</h2>
            <p className="field-hint">Your EnderPhone account: friends, chat, capes and the network.</p>
          </div>
        </div>

        {session.connected ? (
          <>
            <div className="connect-who">
              <strong>{session.name}</strong>
              <span className={`tag tag-${session.kind ?? 'official'}`}>{session.kind === 'cracked' ? 'Cracked' : 'Official'}</span>
            </div>
            {session.needs && session.needs.length > 0 && (
              <p className="field-hint">
                Your account has a step left to finish ({session.needs.join(', ')}). Open EnderNet → Account to do it.
              </p>
            )}
            <div className="settings-actions">
              <button
                className="secondary-button"
                onClick={async () => {
                  await disconnect()
                  onClose()
                }}
              >
                Disconnect
              </button>
              <button className="primary-button" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        ) : needsPassword ? (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void run(password)
            }}
          >
            <div className="field">
              <label>EnderPhone password</label>
              <input
                type="password"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="The password you set in the phone"
              />
              <p className="field-hint">This account has a password set, so EnderNet asks for it as well as your Minecraft sign-in.</p>
            </div>
            {message && <p className="error-text">{message}</p>}
            <div className="settings-actions">
              <button type="button" className="secondary-button" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="primary-button" disabled={busy || !password}>
                {busy ? 'Connecting…' : 'Connect'}
              </button>
            </div>
          </form>
        ) : (
          <>
            {busy && <p className="field-hint">Signing in with your Minecraft account…</p>}
            {message && <p className="error-text">{message}</p>}
            <div className="settings-actions">
              <button className="secondary-button" onClick={onClose}>
                Close
              </button>
              <button className="primary-button" disabled={busy} onClick={() => run()}>
                {busy ? 'Connecting…' : 'Try again'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
