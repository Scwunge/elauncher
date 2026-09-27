interface Props {
  onInstall: () => void
}

export default function UpdateToast({ onInstall }: Props) {
  return (
    <div className="update-toast">
      <span>A launcher update is ready.</span>
      <button className="primary-button" onClick={onInstall}>
        Restart now
      </button>
    </div>
  )
}
