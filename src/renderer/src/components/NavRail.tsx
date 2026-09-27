import { useState } from 'react'
import mark from '../assets/mark.png'
import type { Profile } from '../types'
import Icon from './Icon'
import SkinFace from './SkinFace'

export type Tab = 'home' | 'library' | 'servers' | 'endernet' | 'discover' | 'wardrobe' | 'theme'

interface Props {
  tab: Tab
  onTabChange: (tab: Tab) => void
  profile: Profile
  onOpenSettings: () => void
  onOpenConsole: () => void
  onSignOut: () => void
  notificationCount: number
}

export const NAV_ITEMS: { id: Tab; label: string; icon: string }[] = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'library', label: 'Library', icon: 'library' },
  { id: 'servers', label: 'Servers', icon: 'portal' },
  { id: 'endernet', label: 'EnderNet', icon: 'phone' },
  { id: 'discover', label: 'Discover', icon: 'compass' },
  { id: 'wardrobe', label: 'Wardrobe', icon: 'shirt' },
  { id: 'theme', label: 'Theme', icon: 'palette' },
]

/**
 * The left rail: pages up top, app chrome (console, settings, account) at the bottom. Labels show
 * as tooltips on hover, and under each icon - small, so a first-time player isn't guessing.
 */
export default function NavRail({ tab, onTabChange, profile, onOpenSettings, onOpenConsole, onSignOut, notificationCount }: Props) {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <nav className="nav-rail">
      <button className="nav-rail-logo" title="E-Launcher" onClick={() => onTabChange('home')}>
        <img src={mark} alt="E-Launcher" />
      </button>
      <div className="nav-rail-items">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            className={`nav-rail-button${tab === item.id ? ' active' : ''}`}
            title={item.label}
            onClick={() => onTabChange(item.id)}
          >
            <span className="nav-rail-icon">
              <Icon name={item.icon} size={21} />
              {item.id === 'endernet' && notificationCount > 0 && (
                <span className="nav-badge">{notificationCount > 9 ? '9+' : notificationCount}</span>
              )}
            </span>
            <span className="nav-rail-label">{item.label}</span>
          </button>
        ))}
      </div>

      <div className="nav-rail-items nav-rail-bottom">
        <button className="nav-rail-button" title="Console" onClick={onOpenConsole}>
          <span className="nav-rail-icon">
            <Icon name="terminal" size={20} />
          </span>
        </button>
        <button className="nav-rail-button" title="Settings" onClick={onOpenSettings}>
          <span className="nav-rail-icon">
            <Icon name="gear" size={20} />
          </span>
        </button>
        <div className="nav-rail-account-wrap">
          <button className="nav-rail-button nav-rail-avatar" title={profile.name} onClick={() => setMenuOpen((v) => !v)}>
            <SkinFace skinUrl={profile.skinUrl} size={38} />
          </button>
          {menuOpen && (
            <div className="account-menu account-menu-rail" onMouseLeave={() => setMenuOpen(false)}>
              <div className="account-menu-name">{profile.name}</div>
              <button
                onClick={() => {
                  setMenuOpen(false)
                  onTabChange('wardrobe')
                }}
              >
                Skin and cape
              </button>
              <button
                className="danger-item"
                onClick={() => {
                  setMenuOpen(false)
                  onSignOut()
                }}
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </nav>
  )
}
