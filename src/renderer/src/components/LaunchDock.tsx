import { LOADER_LABEL, useLaunch } from '../state'
import Icon from './Icon'
import InstanceIcon from './InstanceIcon'

interface Props {
  onOpenInstance: (id: string) => void
  onOpenConsole: () => void
}

/**
 * The bar along the bottom of every page: the selected instance and its Play button, and - while
 * a launch is going - what it's doing. One launch at a time, shown the same wherever it started.
 */
export default function LaunchDock({ onOpenInstance, onOpenConsole }: Props) {
  const { modpacks, selectedId, launchingId, progress, error, clearError, play } = useLaunch()
  const active = modpacks.find((m) => m.id === (launchingId ?? selectedId))
  if (!active) return null
  const launching = !!launchingId
  const running = launching && progress?.phase === 'done'

  return (
    <div className={`launch-dock${launching ? ' busy' : ''}`}>
      <button className="launch-dock-instance" onClick={() => onOpenInstance(active.id)} title="Open instance">
        <InstanceIcon pack={active} size={44} />
        <div className="launch-dock-info">
          <div className="launch-dock-name">{active.name}</div>
          <div className="launch-dock-meta">
            {LOADER_LABEL[active.loader]} {active.minecraftVersion}
            {active.enderphone && (
              <span className="ep-badge small">
                <Icon name="phone" size={11} /> {active.enderphone.edition === 'lite' ? 'Lite' : 'EnderPhone'}
              </span>
            )}
          </div>
        </div>
      </button>

      <div className="launch-dock-status">
        {error ? (
          <div className="launch-dock-error">
            <span>{error}</span>
            <button className="link-button" onClick={clearError}>
              Dismiss
            </button>
          </div>
        ) : launching && progress ? (
          <>
            <div className="launch-dock-message">
              {running ? 'Minecraft is running' : progress.message}
              {progress.bytesTransferred !== undefined && progress.totalBytes !== undefined && !running && (
                <span className="launch-dock-bytes">
                  {(progress.bytesTransferred / 1e6).toFixed(0)} / {(progress.totalBytes / 1e6).toFixed(0)} MB
                </span>
              )}
            </div>
            <div className={`progress-track${progress.fraction === undefined && !running ? ' indeterminate' : ''}`}>
              <div className="progress-fill" style={{ width: `${Math.round((running ? 1 : progress.fraction ?? 0) * 100)}%` }} />
            </div>
          </>
        ) : null}
      </div>

      {running && (
        <button className="secondary-button" onClick={onOpenConsole}>
          <Icon name="terminal" size={16} /> Console
        </button>
      )}
      <button className="play-button" disabled={launching} onClick={() => play(active.id)}>
        <Icon name="play" size={18} />
        {running ? 'Playing' : launching ? 'Starting…' : 'Play'}
      </button>
    </div>
  )
}
