import type { CSSProperties } from 'react';

export type IconName = 'mic' | 'mic-off' | 'keyboard' | 'send' | 'settings' | 'close' | 'pause' | 'play' | 'volume' | 'slow' | 'translate' | 'arrow' | 'check' | 'upload' | 'download' | 'spark' | 'leaf' | 'chevron' | 'headphones' | 'stop' | 'info' | 'zoom-in' | 'zoom-out' | 'reset-view';

const paths: Record<IconName, React.ReactNode> = {
  mic: <><rect x="9" y="2" width="6" height="13" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8" /></>,
  'mic-off': <><path d="m3 3 18 18M9 9v3a3 3 0 0 0 5.1 2.1M15 9V5a3 3 0 0 0-5.9-.8M5 10v2a7 7 0 0 0 12 4.9M19 10v2a7 7 0 0 1-.2 1.6M12 19v3m-4 0h8" /></>,
  keyboard: <><rect x="2" y="5" width="20" height="14" rx="3" /><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M8 16h8" /></>,
  send: <><path d="m21 3-7 18-4-7-7-4 18-7ZM10 14 21 3" /></>,
  settings: <><path d="m9 3-.6 2.3-2.2 1.3L4 6l-2 3.5 1.6 1.7v2.6L2 15.5 4 19l2.2-.6 2.2 1.3L9 22h4l.6-2.3 2.2-1.3 2.2.6 2-3.5-1.6-1.7v-2.6L20 9.5 18 6l-2.2.6-2.2-1.3L13 3H9Z" transform="translate(1 -0.5) scale(.95)" /><circle cx="11.5" cy="11.5" r="3" /></>,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  pause: <><path d="M8 5v14M16 5v14" strokeWidth="4" /></>,
  play: <path d="m8 4 12 8-12 8V4Z" />,
  volume: <><path d="m11 4-6 5H2v6h3l6 5V4ZM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" /></>,
  slow: <><circle cx="12" cy="13" r="8" /><path d="M12 9v4l-3 2M9 2h6M19 5l2 2" /></>,
  translate: <><path d="M2 5h12M8 2v3m4 0c-1 7-4 10-9 12m1-8c2 4 4 6 8 8m1 4 4-11 4 11m-6.5-4h5" /></>,
  arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
  check: <path d="m5 12 4 4L19 6" />,
  upload: <><path d="M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5" /></>,
  download: <><path d="M12 3v13m-5-5 5 5 5-5M4 16v5h16v-5" /></>,
  spark: <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z" /></>,
  leaf: <g transform="translate(1 -.5) scale(.72)" strokeWidth="1.3"><path d="M16 31C15 22 15 15 22 6" /><path d="M17 20C14 12 18 6 27 4C27 13 23 19 17 20Z" fill="currentColor" fillOpacity=".18" /><path d="M15 27C8 26 4 21 5 15C12 16 16 20 15 27Z" fill="currentColor" fillOpacity=".12" /></g>,
  chevron: <path d="m9 5 7 7-7 7" />,
  headphones: <><path d="M4 14v-3a8 8 0 0 1 16 0v3" /><rect x="2" y="12" width="5" height="8" rx="2" /><rect x="17" y="12" width="5" height="8" rx="2" /></>,
  stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6m0-10v.1" /></>,
  'zoom-in': <><circle cx="10" cy="10" r="6" /><path d="m15 15 6 6M7 10h6M10 7v6" /></>,
  'zoom-out': <><circle cx="10" cy="10" r="6" /><path d="m15 15 6 6M7 10h6" /></>,
  'reset-view': <><path d="M3 10a9 9 0 1 1 2.6 8.4M3 4v6h6" /><circle cx="12" cy="12" r="2" /></>,
};

export function Icon({ name, size = 20, style }: { name: IconName; size?: number; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}>{paths[name]}</svg>;
}
