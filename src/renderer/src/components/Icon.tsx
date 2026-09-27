/**
 * The launcher's icon set: small stroke icons on a 24px grid, drawn with currentColor so they
 * follow the theme. One component rather than an icon font or a dependency - there are only a few
 * dozen, and every one of them is right here to read.
 */
const PATHS: Record<string, string> = {
  home: 'M3 11.5 12 4l9 7.5M5.5 9.5V20h13V9.5M10 20v-5.5h4V20',
  library: 'M4 5h6v14H4zM14 5l6 1.5-3 13.5-6-1.5z',
  servers: 'M4 5h16v5H4zM4 14h16v5H4zM7.5 7.5h.01M7.5 16.5h.01',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z',
  compass: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM15.5 8.5l-2 5-5 2 2-5z',
  shirt: 'M8 4 4 6.5 5.5 11 7 10.3V20h10v-9.7l1.5.7L20 6.5 16 4c-.6 1.5-2.2 2.5-4 2.5S8.6 5.5 8 4z',
  palette: 'M12 3a9 9 0 0 0 0 18c1.2 0 1.8-.8 1.8-1.7 0-1.3-1-1.6-1-2.8 0-1 .8-1.7 1.8-1.7H17a4 4 0 0 0 4-4C21 6.4 17 3 12 3zM7.5 11.5h.01M10 7.5h.01M14.5 7.5h.01',
  terminal: 'M4 5h16v14H4zM7.5 9.5l3 2.5-3 2.5M12.5 15h4',
  gear: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19.4 13.5l1.6 1.2-1.9 3.3-1.9-.7a7 7 0 0 1-1.9 1.1L15 20.5h-3.8l-.3-2.1a7 7 0 0 1-1.9-1.1l-1.9.7-1.9-3.3 1.6-1.2a7 7 0 0 1 0-2.2L3.2 10l1.9-3.3 1.9.7A7 7 0 0 1 9 6.3l.3-2.1H13l.3 2.1a7 7 0 0 1 1.9 1.1l1.9-.7L19 10l-1.6 1.2a7 7 0 0 1 0 2.3z',
  play: 'M8 5.5v13l10.5-6.5z',
  plus: 'M12 5v14M5 12h14',
  users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14.8c1.8.7 3 2.5 3 5.2',
  bell: 'M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0',
  radio: 'M4 9h16v11H4zM7 9l9-5M15.5 14.5a2 2 0 1 0 0 .01M7 13h4M7 16h4',
  signal: 'M5 19v-3M9.5 19v-6M14 19V9M18.5 19V5',
  folder: 'M3.5 6.5h6l2 2h9v10h-17z',
  trash: 'M5 7h14M10 7V4.5h4V7M6.5 7l1 13h9l1-13',
  refresh: 'M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  x: 'M6 6l12 12M18 6 6 18',
  external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  search: 'M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM15.5 15.5 20 20',
  lock: 'M6.5 11h11v9h-11zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  phone: 'M8 3h8a1.5 1.5 0 0 1 1.5 1.5v15A1.5 1.5 0 0 1 16 21H8a1.5 1.5 0 0 1-1.5-1.5v-15A1.5 1.5 0 0 1 8 3zM11 18h2',
  download: 'M12 4v11M7.5 10.5 12 15l4.5-4.5M5 20h14',
  star: 'M12 4l2.4 5 5.4.6-4 3.7 1.1 5.4L12 16l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6z',
  chat: 'M4 5h16v11H9l-5 4z',
  book: 'M5 4.5h9.5a2 2 0 0 1 2 2V20H7a2 2 0 0 1-2-2zM16.5 7.5H19V20h-2.5M8.5 8.5h5',
  portal: 'M12 3c3.9 0 6 4 6 9s-2.1 9-6 9-6-4-6-9 2.1-9 6-9zM12 7.5c1.7 0 2.5 2 2.5 4.5s-.8 4.5-2.5 4.5-2.5-2-2.5-4.5.8-4.5 2.5-4.5z',
  server: 'M5 4h14v7H5zM5 13h14v7H5zM8.5 7.5h.01M8.5 16.5h.01M12 7.5h4M12 16.5h4',
  heart: 'M12 20s-7.5-4.6-7.5-10A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 7.5 3c0 5.4-7.5 10-7.5 10z',
  user: 'M12 11.5a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20.5c0-4 3.4-6.5 7.5-6.5s7.5 2.5 7.5 6.5',
  more: 'M5.5 12h.01M12 12h.01M18.5 12h.01',
  back: 'M15 5.5 8.5 12l6.5 6.5',
  world: 'M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8',
  log: 'M6 3.5h9l3 3V20.5H6zM9 10h6M9 13.5h6M9 17h4',
  cube: 'M12 3.5 20 8v8l-8 4.5L4 16V8zM4 8l8 4.5L20 8M12 12.5v8',
  sparkle: 'M12 3.5l1.8 5.2 5.2 1.8-5.2 1.8L12 17.5l-1.8-5.2L5 10.5l5.2-1.8zM18.5 16.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z',
  cape: 'M7 4h10l1.5 16H5.5zM7 4c1 2 3 3 5 3s4-1 5-3',
}

interface Props {
  name: keyof typeof PATHS | string
  size?: number
  className?: string
  strokeWidth?: number
}

export default function Icon({ name, size = 20, className, strokeWidth = 1.8 }: Props) {
  const d = PATHS[name]
  const filled = name === 'play'
  return (
    <svg
      className={`icon${className ? ` ${className}` : ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={filled ? 0 : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {d && <path d={d} />}
    </svg>
  )
}
