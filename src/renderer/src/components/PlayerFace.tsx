import { useState } from 'react'

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
