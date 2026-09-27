import { useEffect, useState } from 'react'
import { useEnderNet } from '../state'
import type { Edition, Settings, UpdaterStatus } from '../types'

interface Props {
  settings: Settings
  onSave: (patch: Partial<Settings>) => Promise<void>
  onClose: () => void
}

function updaterStatusText(status?: UpdaterStatus): string {
  if (!status) return ''
  switch (status.status) {
    case 'checking':
      return 'Checking for updates…'
    case 'up-to-date':
      return 'You have the latest version.'
    case 'downloading':
      return status.percent != null
        ? `Downloading update… ${status.percent.toFixed(0)}%`
        : `Downloading update ${status.version ?? ''}…`
    case 'ready':
      return `Update ${status.version ?? ''} downloaded — restart the launcher to install.`
    case 'error':
      return `Update check failed: ${status.message ?? 'unknown error'}`
    default:
      return ''
  }
}

export default function SettingsPanel({ settings, onSave, onClose }: Props) {
  const [gameDirectory, setGameDirectory] = useState(settings.gameDirectory)
  const [minMemoryMb, setMinMemoryMb] = useState(settings.minMemoryMb)
  const [maxMemoryMb, setMaxMemoryMb] = useState(settings.maxMemoryMb)
  const [saving, setSaving] = useState(false)
  const [appVersion, setAppVersion] = useState<string>()
  const [updaterStatus, setUpdaterStatus] = useState<UpdaterStatus>()
  const [checking, setChecking] = useState(false)
  const [whileRunning, setWhileRunning] = useState(settings.whileRunning ?? 'minimize')
  const [defaultEdition, setDefaultEdition] = useState<Edition>(settings.defaultEdition ?? 'full')
  const [appearOnline, setAppearOnline] = useState(settings.appearOnline !== false)
  const [chatNotifications, setChatNotifications] = useState(settings.chatNotifications !== false)
  const { session, requestConnect, disconnect } = useEnderNet()

  useEffect(() => {
    window.api.app.getVersion().then(setAppVersion)
    return window.api.updater.onStatus(setUpdaterStatus)
  }, [])

  async function handleCheckForUpdates() {
    setChecking(true)
    setUpdaterStatus({ status: 'checking' })
    try {
      await window.api.updater.check()
    } finally {
      setChecking(false)
    }
  }

  async function chooseDirectory() {
    const picked = await window.api.settings.chooseGameDirectory()
    if (picked) setGameDirectory(picked)
  }

  async function handleSave() {
    setSaving(true)
    try {
      await onSave({ gameDirectory, minMemoryMb, maxMemoryMb, whileRunning, defaultEdition, appearOnline, chatNotifications })
      // The live chat socket is what shows you online, so the setting takes effect right away.
      if (appearOnline !== (settings.appearOnline !== false)) await window.api.chat.live(appearOnline && session.connected)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <h2>Settings</h2>

        <div className="field">
          <label>Game directory</label>
          <div className="row">
            <input type="text" value={gameDirectory} readOnly />
            <button onClick={chooseDirectory}>Choose…</button>
          </div>
          <p className="field-hint">Where each instance's files are stored.</p>
        </div>

        <div className="field">
          <label>Memory allocation (MB)</label>
          <div className="row">
            <input
              type="number"
              value={minMemoryMb}
              min={512}
              step={512}
              onChange={(e) => setMinMemoryMb(Number(e.target.value))}
              style={{ width: 100 }}
            />
            <span>to</span>
            <input
              type="number"
              value={maxMemoryMb}
              min={512}
              step={512}
              onChange={(e) => setMaxMemoryMb(Number(e.target.value))}
              style={{ width: 100 }}
            />
          </div>
          <p className="field-hint">Minimum and maximum heap passed to the JVM.</p>
        </div>

        <div className="field">
          <label>While Minecraft is running</label>
          <select className="select-control" value={whileRunning} onChange={(e) => setWhileRunning(e.target.value as typeof whileRunning)}>
            <option value="minimize">Minimise the launcher</option>
            <option value="hide">Hide the launcher until the game closes</option>
            <option value="keep">Keep the launcher open</option>
          </select>
        </div>

        <div className="field">
          <label>EnderPhone edition for new instances</label>
          <div className="seg-row">
            <button type="button" className={`seg${defaultEdition === 'full' ? ' active' : ''}`} onClick={() => setDefaultEdition('full')}>
              EnderPhone
            </button>
            <button type="button" className={`seg${defaultEdition === 'lite' ? ' active' : ''}`} onClick={() => setDefaultEdition('lite')}>
              Lite
            </button>
          </div>
          <p className="field-hint">Each instance can still pick its own, in its EnderPhone tab.</p>
        </div>

        <div className="field">
          <label>EnderChat</label>
          <label className="check-row">
            <input type="checkbox" checked={appearOnline} onChange={(e) => setAppearOnline(e.target.checked)} />
            Appear online to friends while E-Launcher is open (messages arrive instantly)
          </label>
          <label className="check-row">
            <input type="checkbox" checked={chatNotifications} onChange={(e) => setChatNotifications(e.target.checked)} />
            Desktop notifications for new messages (never while Minecraft is running - the phone has it)
          </label>
        </div>

        <div className="field">
          <label>EnderNet account</label>
          <div className="row">
            <span>{session.connected ? `Connected as ${session.name}` : 'Not connected'}</span>
            {session.connected ? (
              <button onClick={() => disconnect()}>Disconnect</button>
            ) : (
              <button onClick={requestConnect}>Connect</button>
            )}
          </div>
          <p className="field-hint">Signs in with your Minecraft account, the same way the phone does. Your EnderPhone password, if you set one, is never stored.</p>
        </div>

        <div className="field">
          <label>Launcher version</label>
          <div className="row">
            <span>{appVersion ?? '…'}</span>
            <button onClick={handleCheckForUpdates} disabled={checking}>
              {checking ? 'Checking…' : 'Check for Updates'}
            </button>
          </div>
          {updaterStatus && <p className="field-hint">{updaterStatusText(updaterStatus)}</p>}
        </div>

        <div className="settings-actions">
          <button className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" disabled={saving} onClick={handleSave}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
