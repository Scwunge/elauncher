import type { ModpackSummary } from '../types'

/** An instance's icon, or a generated tile (initials on a colour picked from its id) without one. */
export default function InstanceIcon({ pack, size = 56 }: { pack: Pick<ModpackSummary, 'id' | 'name' | 'iconUrl'>; size?: number }) {
  if (pack.iconUrl) {
    return <span className="instance-icon" style={{ width: size, height: size, backgroundImage: `url(${pack.iconUrl})` }} />
  }
  let hash = 0
  for (const ch of pack.id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  const hue = 250 + (hash % 80) - 40 // stays in the violet family, drifting to blue and pink
  const initials =
    pack.name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join('') || '?'
  return (
    <span
      className="instance-icon generated"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.36,
        background: `linear-gradient(135deg, hsl(${hue} 70% 45%), hsl(${hue + 30} 60% 25%))`,
      }}
    >
      {initials}
    </span>
  )
}
