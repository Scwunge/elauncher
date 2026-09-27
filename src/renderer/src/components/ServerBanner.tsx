import { useEffect, useState } from 'react'
import type { EndportalServer } from '../types'

let apiBase: Promise<string> | undefined
/** The EnderPhone API's base URL (dev builds can point elsewhere), fetched once per session. */
export function useApiBase(): string | undefined {
  const [base, setBase] = useState<string>()
  useEffect(() => {
    apiBase ??= window.api.app.getApiBase()
    apiBase.then(setBase)
  }, [])
  return base
}

/** A server's Endportal banner, or a generated one from its name when it hasn't uploaded one. */
export default function ServerBanner({ server, className }: { server: EndportalServer; className?: string }) {
  const base = useApiBase()
  const [broken, setBroken] = useState(false)
  if (server.banner && base && !broken) {
    return (
      <img
        className={`server-banner ${className ?? ''}`}
        src={`${base}/cdn/photos/${server.banner.slice(0, 2)}/${server.banner}.png`}
        alt=""
        onError={() => setBroken(true)}
      />
    )
  }
  let hash = 0
  for (const ch of server.slug) hash = (hash * 33 + ch.charCodeAt(0)) >>> 0
  const hue = hash % 360
  return (
    <span
      className={`server-banner generated ${className ?? ''}`}
      style={{ background: `linear-gradient(120deg, hsl(${hue} 55% 30%), hsl(${(hue + 60) % 360} 50% 16%))` }}
    >
      {server.name.slice(0, 1).toUpperCase()}
    </span>
  )
}
