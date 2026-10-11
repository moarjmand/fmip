import type { ReactNode } from 'react';
import { cx } from './cx';

/**
 * The Hybrid design's line icons (T-1388, D-206): 24-unit strokes drawn in
 * the text colour, so an icon takes the colour of whatever it sits in and no
 * icon names a colour of its own. Always decorative (`aria-hidden`): the word
 * beside it says the meaning, and an icon never stands alone for a state --
 * the coverage badges pair one with a colour *and* a word, so the four states
 * never rest on hue (rule 3).
 *
 * A direction-bearing icon (the forward chevron) mirrors under `dir="rtl"`;
 * the rest are symmetric or, like the external-link arrow, conventional in
 * both directions.
 */
export type IconName =
  | 'check'
  | 'limited'
  | 'dash'
  | 'clock'
  | 'forward'
  | 'external'
  | 'model'
  | 'founder'
  | 'community'
  | 'pick'
  | 'lock'
  | 'screen'
  | 'play'
  | 'bell';

const PATHS: Record<IconName, ReactNode> = {
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  limited: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4v16" />
    </>
  ),
  dash: <path d="M6 12h12" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  forward: <path d="m9.5 6 6 6-6 6" />,
  external: (
    <>
      <path d="M14 4h6v6M20 4l-9 9" />
      <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </>
  ),
  model: <path d="M5 20v-8M10 20V5M15 20v-6M20 20V9" />,
  founder: (
    <>
      <circle cx="12" cy="8.5" r="3.8" />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
    </>
  ),
  community: (
    <>
      <circle cx="9" cy="8.5" r="3.2" />
      <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
      <path d="M15.5 5.6a3 3 0 0 1 0 5.8M17 14.2a5 5 0 0 1 3.5 4.8" />
    </>
  ),
  pick: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3.5" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  screen: (
    <>
      <rect x="3" y="5" width="18" height="12" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </>
  ),
  play: <path d="M8 5.5v13l10.5-6.5z" />,
  bell: (
    <>
      <path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z" />
      <path d="M10 20.5a2 2 0 0 0 4 0" />
    </>
  ),
};

/** Icons that point along the line of reading, and so turn round in a right-to-left page. */
const MIRRORED: ReadonlySet<IconName> = new Set(['forward']);

export function Icon({
  name,
  size = 16,
  strokeWidth = 1.8,
  className,
}: {
  name: IconName;
  /** CSS pixels, square. */
  size?: number;
  strokeWidth?: number;
  className?: string;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-icon={name}
      className={cx('shrink-0', MIRRORED.has(name) && 'rtl:-scale-x-100', className)}
    >
      {PATHS[name]}
    </svg>
  );
}
