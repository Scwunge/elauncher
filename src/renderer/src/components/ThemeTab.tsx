import { useRef, useState, type DragEvent } from 'react'
import type { Theme } from '../types'
import { THEME_COLOR_GROUPS, applyTheme } from '../theme-utils'

interface Props {
  theme: Theme | undefined
  onChange: (theme: Theme) => void
}

const MAX_BACKGROUND_BYTES = 8 * 1024 * 1024 // 8MB - generous for a background GIF, keeps the
// electron-store settings file (plain JSON on disk) from bloating on something much bigger.

/**
 * The phone's own themes (Settings > Style in EnderPhone, and the swatches on enderphone.cloud),
 * stretched into the launcher's five-step surface scale. Picking the one you use on the phone makes
 * the launcher match it.
 */
function preset(label: string, swatch: string, c: [string, string, string, string, string, string, string, string, string]) {
  const [s1, s2, s3, s4, s5, text, dim, faint, accent] = c
  return {
    label,
    swatch,
    colors: {
      'surface-1': s1,
      'surface-2': s2,
      'surface-3': s3,
      'surface-4': s4,
      'surface-5': s5,
      text,
      'text-dim': dim,
      'text-faint': faint,
      accent,
      'accent-strong': accent,
      'accent-contrast': s1,
    },
  }
}

const PRESETS = [
  preset('End', '#B388FF', ['#0d0715', '#140c1f', '#1b1229', '#251a3a', '#332650', '#f2e8ff', '#a995c4', '#7a6699', '#b388ff']),
  preset('Midnight', '#4FA3FF', ['#0a0d11', '#101418', '#171c22', '#20262e', '#404040', '#ffffff', '#a0a0a0', '#767676', '#4fa3ff']),
  preset('Nether', '#FF7043', ['#120705', '#1a0a07', '#24100b', '#331710', '#5a2418', '#ffede2', '#c49384', '#8f6356', '#ff7043']),
  preset('Grove', '#66BB6A', ['#060d08', '#0a140d', '#101c13', '#17271b', '#2c4a32', '#e9f6ea', '#93b49a', '#66836c', '#66bb6a']),
  preset('Deep', '#29B6F6', ['#040911', '#070e18', '#0c1522', '#132030', '#24384f', '#e4f0ff', '#8aa3be', '#5f7690', '#29b6f6']),
  preset('Rose', '#FF6E9F', ['#10060b', '#190a11', '#221019', '#2f1723', '#55303f', '#ffe9f1', '#c08fa2', '#8c6675', '#ff6e9f']),
]

/**
 * Full launcher theming - every color token individually editable (native <input type="color">,
 * so "every colour on the spectrum" needs no custom picker widget) plus a custom background image
 * or GIF. Applies instantly (calls applyTheme directly, not just waiting on the settings round
 * trip through IPC) and persists via onChange, same "no separate Save step" feel as the old
 * accent-only picker had.
 */
export default function ThemeTab({ theme, onChange }: Props) {
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState<string>()
  const fileInputRef = useRef<HTMLInputElement>(null)

  function commit(next: Theme) {
    applyTheme(next)
    onChange(next)
  }

  function setColor(key: string, value: string) {
    commit({ ...theme, preset: 'Custom', colors: { ...theme?.colors, [key]: value } })
  }

  function applyPreset(label: string, colors: Record<string, string>) {
    commit({ ...theme, preset: label, colors })
  }

  function handleFile(file: File) {
    setError(undefined)
    if (file.size > MAX_BACKGROUND_BYTES) {
      setError(`That file is ${(file.size / 1e6).toFixed(1)}MB - backgrounds are capped at 8MB.`)
      return
    }
    const reader = new FileReader()
    reader.onload = () => commit({ ...theme, backgroundImage: reader.result as string })
    reader.readAsDataURL(file)
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleFile(file)
  }

  function resetAll() {
    if (!confirm('Reset the whole theme back to the default look?')) return
    commit({})
  }

  return (
    <div>
      <div className="section-header">
        <h2 className="section-title">Theme</h2>
        <button className="secondary-button" onClick={resetAll}>
          Reset to defaults
        </button>
      </div>

      <div className="theme-section">
        <h3 className="resume-heading">Background</h3>
        <div
          className={`skin-dropzone${dragOver ? ' dragover' : ''}`}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          {theme?.backgroundImage ? (
            <img className="theme-bg-preview" src={theme.backgroundImage} alt="" />
          ) : null}
          <div className="skin-dropzone-text">
            <strong>{theme?.backgroundImage ? 'Choose a different image' : 'Drag an image or GIF here'}</strong>
            <span>or click to browse — up to 8MB</span>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          />
        </div>
        {error && <p className="error-text">{error}</p>}

        {theme?.backgroundImage && (
          <div className="theme-bg-controls">
            <div className="field">
              <label>Darken for readability</label>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round((theme.backgroundOverlay ?? 0.5) * 100)}
                onChange={(e) => commit({ ...theme, backgroundOverlay: Number(e.target.value) / 100 })}
              />
            </div>
            <div className="field">
              <label>Fit</label>
              <select
                className="select-control"
                value={theme.backgroundFit ?? 'cover'}
                onChange={(e) => commit({ ...theme, backgroundFit: e.target.value as Theme['backgroundFit'] })}
              >
                <option value="cover">Cover</option>
                <option value="contain">Contain</option>
                <option value="repeat">Repeat (tile)</option>
              </select>
            </div>
            <button
              className="secondary-button"
              onClick={() => commit({ ...theme, backgroundImage: undefined })}
            >
              Remove background
            </button>
          </div>
        )}
      </div>

      <div className="theme-section">
        <h3 className="resume-heading">Match your phone</h3>
        <div className="theme-preset-row">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              className={`theme-preset${(theme?.preset ?? 'End') === p.label ? ' active' : ''}`}
              onClick={() => applyPreset(p.label, p.colors)}
            >
              <span className="theme-preset-swatch" style={{ background: `linear-gradient(135deg, ${p.colors['surface-5']}, ${p.colors['surface-1']})` }}>
                <i style={{ background: p.swatch }} />
              </span>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {THEME_COLOR_GROUPS.map((group) => (
        <div className="theme-section" key={group.label}>
          <h3 className="resume-heading">{group.label}</h3>
          <div className="theme-color-grid">
            {group.keys.map((key) => (
              <label key={key} className="theme-color-swatch">
                <input
                  type="color"
                  value={theme?.colors?.[key] ?? getComputedDefault(key)}
                  onChange={(e) => setColor(key, e.target.value)}
                />
                <span>{key}</span>
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

/** Reads the actual current value straight off the document (whatever index.css's :root has, or an
 *  already-applied override) so each swatch shows the real starting color rather than a hardcoded
 *  guess that could drift from index.css over time. */
function getComputedDefault(key: string): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(`--${key}`).trim()
  return /^#[0-9a-f]{6}$/i.test(raw) ? raw : '#000000'
}
