interface Props {
  skinUrl?: string
  size: number
  className?: string
}

/**
 * A proper "face avatar" cropped (and hat-overlay composited) out of the 64x64/64x32 skin sheet -
 * the small account icons (nav rail, right sidebar) used to just be an <img> of the whole skin
 * texture squished into a square, showing every body part flattened into one blob instead of a
 * face. Same base+hat-overlay compositing trick as the Skin tab's preset thumbnails
 * (.skin-preset-thumb), just parametrized by size instead of hardcoded to 40px.
 */
export default function SkinFace({ skinUrl, size, className }: Props) {
  if (!skinUrl) {
    return (
      <span
        className={`avatar-fallback${className ? ` ${className}` : ''}`}
        style={{ width: size, height: size }}
      />
    )
  }
  const scale = size / 8
  const sheet = `${64 * scale}px ${64 * scale}px`
  // Hat-overlay layer (source x=40,y=8) painted on top of the base face layer (source x=8,y=8) -
  // transparent pixels in the overlay let the base layer show through, same as any skin viewer.
  const position = `-${40 * scale}px -${8 * scale}px, -${8 * scale}px -${8 * scale}px`
  return (
    <span
      className={`skin-face${className ? ` ${className}` : ''}`}
      style={{
        width: size,
        height: size,
        backgroundImage: `url(${skinUrl}), url(${skinUrl})`,
        backgroundSize: `${sheet}, ${sheet}`,
        backgroundPosition: position,
      }}
    />
  )
}
