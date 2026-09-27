import type { Theme } from './types'

/** Every base color token a player can override - matches index.css's own :root declarations
 *  exactly (main/../index.css). The `-highlight` variants aren't in this list on purpose (see
 *  deriveHighlights below) - full control over every base color, not literally every CSS variable
 *  in the file, keeps the editor to a sane number of pickers instead of ~20+. */
export const THEME_COLOR_GROUPS: { label: string; keys: string[] }[] = [
  { label: 'Surfaces', keys: ['surface-1', 'surface-2', 'surface-3', 'surface-4', 'surface-5'] },
  { label: 'Text', keys: ['text', 'text-dim', 'text-faint'] },
  { label: 'Accent', keys: ['accent', 'accent-strong', 'accent-contrast'] },
  { label: 'Status', keys: ['danger', 'warning', 'info'] },
]

/** #rrggbb -> rgba(r, g, b, alpha). Falls back to a fully-transparent value for anything that
 *  isn't a plain 6-digit hex (a `<input type="color">` always produces one, but this stays
 *  defensive against a hand-edited/imported theme value). */
export function hexToRgba(hex: string, alpha: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!match) return `rgba(0, 0, 0, ${alpha})`
  const int = parseInt(match[1], 16)
  const r = (int >> 16) & 255
  const g = (int >> 8) & 255
  const b = int & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/** The three base colors that also have a derived `-highlight` (a translucent wash of themselves,
 *  used for hover/badge backgrounds) - computed rather than exposed as their own pickers. */
const HIGHLIGHT_SOURCES: Record<string, string> = {
  accent: 'accent-highlight',
  danger: 'danger-highlight',
  warning: 'warning-highlight',
  info: 'info-highlight',
}

/** Applies (or clears) every themeable CSS custom property on the document root. Called whenever
 *  `settings.theme` changes (see App.tsx) - `style.removeProperty` for anything unset so it falls
 *  back to index.css's own default instead of needing every default value duplicated here. */
export function applyTheme(theme: Theme | undefined): void {
  const root = document.documentElement.style
  const colors = theme?.colors ?? {}

  for (const group of THEME_COLOR_GROUPS) {
    for (const key of group.keys) {
      const value = colors[key]
      if (value) root.setProperty(`--${key}`, value)
      else root.removeProperty(`--${key}`)
    }
  }

  for (const [baseKey, highlightVar] of Object.entries(HIGHLIGHT_SOURCES)) {
    const base = colors[baseKey]
    if (base) root.setProperty(`--${highlightVar}`, hexToRgba(base, 0.25))
    else root.removeProperty(`--${highlightVar}`)
  }

  if (theme?.backgroundImage) root.setProperty('--user-bg-image', `url(${theme.backgroundImage})`)
  else root.removeProperty('--user-bg-image')

  if (theme?.backgroundOverlay !== undefined) {
    root.setProperty('--bg-overlay-alpha', String(theme.backgroundOverlay))
  } else {
    root.removeProperty('--bg-overlay-alpha')
  }

  // "repeat" is a background-repeat concept (tile at natural size), not a background-size keyword
  // (background-size only accepts cover/contain/lengths/auto - "repeat" there would just be
  // silently invalid CSS) - translate the one user-facing choice into the two real properties.
  if (theme?.backgroundFit === 'repeat') {
    root.setProperty('--bg-fit', 'auto')
    root.setProperty('--bg-repeat', 'repeat')
  } else if (theme?.backgroundFit) {
    root.setProperty('--bg-fit', theme.backgroundFit)
    root.setProperty('--bg-repeat', 'no-repeat')
  } else {
    root.removeProperty('--bg-fit')
    root.removeProperty('--bg-repeat')
  }
}
