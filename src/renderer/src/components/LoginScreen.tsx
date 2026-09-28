import { useState } from 'react'
import logo from '../assets/elauncher-logo.png'
import Icon from './Icon'

interface Props {
  onSignIn: () => Promise<{ ok: boolean; error?: string }>
}

const POINTS = [
  { icon: 'phone', text: 'EnderPhone installed and kept up to date in every instance you pick' },
  { icon: 'portal', text: 'Browse Endportal servers and join one in a click' },
  { icon: 'chat', text: 'EnderChat, Enderbook and your friends, right in the launcher' },
]

export default function LoginScreen({ onSignIn }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  async function handleClick() {
    setBusy(true)
    setError(undefined)
    const result = await onSignIn()
    setBusy(false)
    if (!result.ok) setError(result.error ?? 'Something went wrong.')
  }

  return (
    <div className="login-screen">
      <div className="login-glow" aria-hidden="true" />
      <div className="login-card">
        <img className="login-wordmark" src={logo} alt="E-Launcher" />
        <h1>
          E-Launcher<span className="login-sub"> · Ender Launcher</span>
        </h1>
        <p>The Minecraft launcher built around EnderPhone. Sign in with the Microsoft account that owns Minecraft: Java Edition.</p>
        <ul className="login-points">
          {POINTS.map((p) => (
            <li key={p.text}>
              <Icon name={p.icon} size={18} />
              {p.text}
            </li>
          ))}
        </ul>
        <button className="primary-button big" disabled={busy} onClick={handleClick}>
          {busy ? 'Signing in…' : 'Sign in with Microsoft'}
        </button>
        {error && <p className="error-text">{error}</p>}
      </div>
    </div>
  )
}
