import { useEffect, useState } from 'react'
import NavRail, { type Tab } from './components/NavRail'
import TitleBar from './components/TitleBar'
import RightSidebar from './components/RightSidebar'
import LoginScreen from './components/LoginScreen'
import HomeTab from './components/HomeTab'
import LibraryTab from './components/LibraryTab'
import ServersTab from './components/ServersTab'
import EnderNetTab from './components/EnderNetTab'
import EnderChatTab from './components/EnderChatTab'
import { ChatProvider, useChat } from './chat-state'
import DiscoverTab from './components/DiscoverTab'
import WardrobeTab from './components/WardrobeTab'
import ThemeTab from './components/ThemeTab'
import SettingsPanel from './components/SettingsPanel'
import ConsolePanel from './components/ConsolePanel'
import LaunchDock from './components/LaunchDock'
import EnderNetConnectDialog from './components/EnderNetConnectDialog'
import UpdateToast from './components/UpdateToast'
import { EnderNetProvider, LaunchProvider, useEnderNet } from './state'
import { applyTheme } from './theme-utils'
import type { AuthStatus, Profile, Settings } from './types'

export default function App() {
  const [auth, setAuth] = useState<AuthStatus | 'loading'>('loading')

  useEffect(() => {
    window.api.auth.restore().then(setAuth)
    window.api.settings.get().then((s) => applyTheme(s.theme))
  }, [])

  async function handleSignIn() {
    const result = await window.api.auth.signIn()
    setAuth(result)
    return result.status === 'error' ? { ok: false, error: result.message } : { ok: true }
  }

  if (auth === 'loading') return <div className="app app-loading" />

  if (auth.status !== 'signed-in') {
    return (
      <div className="app">
        <LoginScreen onSignIn={handleSignIn} />
      </div>
    )
  }

  return (
    <EnderNetProvider>
      <ChatProvider>
        <LaunchProvider>
          <SignedIn
            profile={auth.profile}
            onProfileChange={(profile) => setAuth({ status: 'signed-in', profile })}
            onSignOut={async () => {
              await window.api.auth.signOut()
              setAuth({ status: 'signed-out' })
            }}
          />
        </LaunchProvider>
      </ChatProvider>
    </EnderNetProvider>
  )
}

interface SignedInProps {
  profile: Profile
  onProfileChange: (profile: Profile) => void
  onSignOut: () => void
}

function SignedIn({ profile, onProfileChange, onSignOut }: SignedInProps) {
  const [tab, setTab] = useState<Tab>('home')
  const [settings, setSettings] = useState<Settings>()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [consoleOpen, setConsoleOpen] = useState(false)
  const [updateReady, setUpdateReady] = useState(false)
  const [openInstanceId, setOpenInstanceId] = useState<string>()
  const [endernetPage, setEndernetPage] = useState('enderbook')
  const endernet = useEnderNet()
  const chat = useChat()

  useEffect(() => {
    window.api.settings.get().then(setSettings)
  }, [])
  useEffect(() => window.api.updater.onReady(() => setUpdateReady(true)), [])
  useEffect(() => applyTheme(settings?.theme), [settings?.theme])

  function openInstance(id: string) {
    setOpenInstanceId(id)
    setTab('library')
  }
  function openPage(page: string) {
    // EnderChat is native now: every "open EnderChat" lands on its own tab, not the web page.
    if (page === 'enderchat') return setTab('chat')
    setEndernetPage(page)
    setTab('endernet')
  }
  function messagePlayer(uuid: string) {
    chat.openDirect(uuid)
    setTab('chat')
  }

  // The EnderChat page stays loaded once opened, so coming back to it is instant and keeps your place.
  const [chatMounted, setChatMounted] = useState(false)
  useEffect(() => {
    if (tab === 'chat') setChatMounted(true)
  }, [tab])

  // A notification clicked while on another page brings you to that chat.
  useEffect(() => window.api.chat.onOpen(() => setTab('chat')), [])

  const wide = tab === 'endernet' || tab === 'wardrobe' || tab === 'chat'
  const fullBleed = tab === 'endernet' || tab === 'chat'

  return (
    <div className="app">
      <NavRail
        tab={tab}
        onTabChange={(t) => {
          if (t === 'library') setOpenInstanceId(undefined)
          setTab(t)
        }}
        profile={profile}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenConsole={() => setConsoleOpen(true)}
        onSignOut={onSignOut}
        notificationCount={endernet.unreadNotifications}
        chatUnread={tab === 'chat' ? 0 : chat.totalUnread}
      />

      <div className="app-main">
        <TitleBar tab={tab} />

        <div className={`content content-${tab}`}>
          {chatMounted && (
            <div className="chat-mount" hidden={tab !== 'chat'}>
              <EnderChatTab active={tab === 'chat'} />
            </div>
          )}
          {tab === 'home' ? (
            <HomeTab
              profile={profile}
              onOpenInstance={openInstance}
              onNavigate={setTab}
              onOpenPage={openPage}
            />
          ) : tab === 'library' ? (
            <LibraryTab openId={openInstanceId} onOpenId={setOpenInstanceId} />
          ) : tab === 'servers' ? (
            <ServersTab onOpenPage={openPage} />
          ) : tab === 'endernet' ? (
            <EnderNetTab page={endernetPage} onPageChange={setEndernetPage} />
          ) : tab === 'discover' ? (
            <DiscoverTab />
          ) : tab === 'wardrobe' ? (
            <WardrobeTab
              profile={profile}
              onSkinUploaded={(skinUrl, skinModel) => onProfileChange({ ...profile, skinUrl, skinModel })}
            />
          ) : tab === 'theme' && settings ? (
            <ThemeTab
              theme={settings.theme}
              onChange={async (theme) => setSettings(await window.api.settings.update({ theme }))}
            />
          ) : null}
        </div>

        {!fullBleed && <LaunchDock onOpenInstance={openInstance} onOpenConsole={() => setConsoleOpen(true)} />}
      </div>

      {!wide && <RightSidebar profile={profile} onOpenChat={() => setTab('chat')} onMessage={messagePlayer} />}

      {settingsOpen && settings && (
        <SettingsPanel
          settings={settings}
          onSave={async (patch) => setSettings(await window.api.settings.update(patch))}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {consoleOpen && <ConsolePanel onClose={() => setConsoleOpen(false)} />}
      {endernet.dialogOpen && <EnderNetConnectDialog onClose={endernet.closeDialog} />}
      {updateReady && <UpdateToast onInstall={() => window.api.updater.install()} />}
    </div>
  )
}
