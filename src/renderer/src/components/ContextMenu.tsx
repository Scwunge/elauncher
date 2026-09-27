import { useEffect, useRef } from 'react'

export interface ContextMenuItem {
  label: string
  icon?: string
  onClick: () => void
  danger?: boolean
  /** A thin divider line rendered above this item - for grouping related actions. */
  separatorBefore?: boolean
}

interface Props {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}

/**
 * A small floating menu at a specific screen position (no full-screen dimming backdrop, unlike
 * the settings-overlay modals) - closes on an outside click or Escape, and clamps its own
 * position so it never renders off the right/bottom edge of the window.
 */
export default function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    // Listen on the capture phase so this fires before the click that opened the menu (a
    // right-click on a *different* card) has a chance to also register as "outside" on its own
    // context-menu handler mid-transition - both still just close-then-reopen correctly either way.
    document.addEventListener('mousedown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const overflowX = rect.right - window.innerWidth
    const overflowY = rect.bottom - window.innerHeight
    if (overflowX > 0) el.style.left = `${x - overflowX - 8}px`
    if (overflowY > 0) el.style.top = `${y - overflowY - 8}px`
  }, [x, y])

  return (
    <div className="context-menu" ref={ref} style={{ left: x, top: y }}>
      {items.map((item, i) => (
        <button
          key={i}
          className={`context-menu-item${item.danger ? ' danger' : ''}`}
          style={item.separatorBefore ? { borderTop: '1px solid var(--panel-border)', marginTop: 4, paddingTop: 8 } : undefined}
          onClick={() => {
            item.onClick()
            onClose()
          }}
        >
          {item.icon && <span className="context-menu-icon">{item.icon}</span>}
          {item.label}
        </button>
      ))}
    </div>
  )
}
