import { useEffect, useRef, useState } from 'react'

interface Props {
  onClose: () => void
}

/**
 * Modal over the live game output. `window.api.console.getBuffer()` returns everything captured
 * since the instance last launched (main process keeps a 5000-line ring buffer - see
 * console-log.js), then `onLines` streams whatever comes in after that.
 */
export default function ConsolePanel({ onClose }: Props) {
  const [lines, setLines] = useState<string[]>([])
  const [hasInstance, setHasInstance] = useState(false)
  const [autoscroll, setAutoscroll] = useState(true)
  const outputRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.api.console.getBuffer().then((buf) => {
      setLines(buf.lines)
      setHasInstance(buf.hasInstance)
    })
    return window.api.console.onLines((incoming) => {
      setLines((prev) => [...prev, ...incoming].slice(-5000))
      setHasInstance(true)
    })
  }, [])

  useEffect(() => {
    if (autoscroll && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [lines, autoscroll])

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel console-panel" onClick={(e) => e.stopPropagation()}>
        <h2>Game console</h2>
        <div className="console-toolbar">
          <label className="console-autoscroll">
            <input
              type="checkbox"
              checked={autoscroll}
              onChange={(e) => setAutoscroll(e.target.checked)}
            />
            Auto-scroll
          </label>
          <button
            className="secondary-button"
            onClick={() => navigator.clipboard.writeText(lines.join('\n'))}
          >
            Copy all
          </button>
          <button className="secondary-button" onClick={() => window.api.console.openLogsFolder()}>
            Open logs folder
          </button>
          <button
            className="secondary-button"
            onClick={() => window.api.console.openCrashReports()}
          >
            Open crash reports
          </button>
        </div>
        <div className="console-output" ref={outputRef}>
          {lines.length === 0 ? (
            <div className="console-empty">
              {hasInstance
                ? 'No output yet.'
                : 'Nothing yet - output shows up here once you hit Play.'}
            </div>
          ) : (
            lines.map((line, i) => (
              <div
                key={i}
                className={`console-line${/error|exception/i.test(line) ? ' error' : ''}`}
              >
                {line}
              </div>
            ))
          )}
        </div>
        <div className="settings-actions">
          <button className="secondary-button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
