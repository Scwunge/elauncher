import { useState } from 'react'
import mark from '../assets/mark.png'
import type { Conversation } from '../types'

/**
 * A player's face: their EnderPhone avatar if they set one, else their Minecraft skin's face, else
 * their initial (offline, or the face service is down).
 */
export function PlayerFace({ uuid, name, avatar, size = 28, online }: { uuid: string; name: string; avatar?: string; size?: number; online?: boolean }) {
  const [broken, setBroken] = useState(false)
  const src = avatar ?? `https://mc-heads.net/avatar/${uuid}/${Math.max(32, size * 2)}`
  const face = broken ? (
    <span className="player-face initial" style={{ width: size, height: size, fontSize: size * 0.42 }}>
      {name.slice(0, 1).toUpperCase()}
    </span>
  ) : (
    <img className={`player-face${avatar ? '' : ' pixel'}`} style={{ width: size, height: size }} src={src} alt="" onError={() => setBroken(true)} />
  )
  if (online === undefined) return face
  return (
    <span className="player-face-wrap">
      {face}
      <span className={`presence ${online ? 'on' : 'off'}`} />
    </span>
  )
}

/** A group's tile: EnderCloud gets the EnderPhone mark; other groups their initials. */
export function GroupFace({ conversation, size = 36 }: { conversation: Conversation; size?: number }) {
  if (conversation.system) {
    return (
      <span className="group-face system" style={{ width: size, height: size }}>
        <img src={mark} alt="" />
      </span>
    )
  }
  let hash = 0
  for (const ch of conversation.name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  const hue = 250 + (hash % 90) - 45
  const initials =
    conversation.name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join('') || '#'
  return (
    <span
      className="group-face"
      style={{ width: size, height: size, fontSize: size * 0.36, background: `linear-gradient(135deg, hsl(${hue} 60% 42%), hsl(${hue + 35} 55% 24%))` }}
    >
      {initials}
    </span>
  )
}
