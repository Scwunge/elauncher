import { useEnderNet } from '../state'
import Icon from './Icon'
import { NAV_ITEMS, type Tab } from './NavRail'

interface Props {
  tab: Tab
}

/**
 * Page title on the left, EnderNet connection on the right. The chip is the one place the
 * launcher's EnderPhone session is always visible: who you are there, or a button to connect.
 */
export default function TitleBar({ tab }: Props) {
  const { session, requestConnect, network, networkDown } = useEnderNet()
  const label = NAV_ITEMS.find((i) => i.id === tab)?.label ?? ''

  return (
    <div className="title-bar">
      <div className="title-bar-page">
        <span className="title-bar-brand">E-Launcher</span>
        <span className="title-bar-sep">/</span>
        <span className="title-bar-title">{label}</span>
      </div>
      <div className="title-bar-right">
        {network && !networkDown && (
          <span className="title-bar-stat" title="Players on EnderNet right now">
            <span className="pulse-dot" /> {network.online.toLocaleString()} online
          </span>
        )}
        {networkDown && <span className="title-bar-stat warn">EnderNet unreachable</span>}
        {session.connected ? (
          <button className="endernet-chip connected" onClick={requestConnect} title="EnderNet account">
            <Icon name="phone" size={15} />
            {session.name}
            <span className={`tag tag-${session.kind ?? 'official'}`}>{session.kind === 'cracked' ? 'Cracked' : 'Official'}</span>
          </button>
        ) : (
          <button className="endernet-chip" onClick={requestConnect}>
            <Icon name="phone" size={15} />
            Connect to EnderNet
          </button>
        )}
      </div>
    </div>
  )
}
