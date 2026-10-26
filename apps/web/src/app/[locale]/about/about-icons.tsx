import type { ReactNode } from 'react';
import { Icon, type IconName } from '@/components/ui/icons';

/**
 * The About page's own line icons (T-1615): drawn like the shared set
 * (`components/ui/icons.tsx`) -- 24-unit strokes in the text colour, always
 * decorative, the word beside each saying what it means -- for the things
 * only this page pictures. A name the shared set has is drawn by it.
 * None of them points along the line of reading, so none mirrors.
 */
type OwnIconName =
  'data' | 'pitch' | 'ball' | 'trophy' | 'news' | 'trend' | 'gauge' | 'podium' | 'whistle';

export type AboutIconName = OwnIconName | IconName;

const PATHS: Record<OwnIconName, ReactNode> = {
  // Licensed match data: a store of records.
  data: (
    <>
      <ellipse cx="12" cy="6" rx="7" ry="2.6" />
      <path d="M5 6v12c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6V6" />
      <path d="M5 12c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6" />
    </>
  ),
  // The one match record, and the match centre: a pitch from above.
  pitch: (
    <>
      <rect x="2.5" y="5" width="19" height="14" rx="1.5" />
      <path d="M12 5v14M2.5 9.5h2.8v5H2.5M21.5 9.5h-2.8v5h2.8" />
      <circle cx="12" cy="12" r="2.4" />
    </>
  ),
  ball: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m12 8.2 3.1 2.2-1.2 3.6h-3.8l-1.2-3.6z" />
      <path d="M12 3.5v4.7M15.1 10.4l4.2-1.5M13.9 14l2.6 3.7M10.1 14l-2.6 3.7M8.9 10.4 4.7 8.9" />
    </>
  ),
  trophy: (
    <>
      <path d="M8 4h8v5.5a4 4 0 0 1-8 0z" />
      <path d="M8 6.5H5.2a3 3 0 0 0 3 3.8M16 6.5h2.8a3 3 0 0 1-3 3.8" />
      <path d="M12 13.5v3.5M8.5 20h7M9.8 17h4.4" />
    </>
  ),
  news: (
    <>
      <rect x="3.5" y="4.5" width="13" height="15" rx="1.5" />
      <path d="M16.5 8.5h3V18a1.5 1.5 0 0 1-3 0M7 8.5h6M7 12h6M7 15.5h4" />
    </>
  ),
  // The model's track record: a line that is scored as it goes.
  trend: (
    <>
      <path d="M4 19.5h16" />
      <path d="m4.5 15.5 4.5-4.5 3 3 6.5-6.5" />
      <path d="M14.5 7.5h4v4" />
    </>
  ),
  // A Performance Rating: a gauge.
  gauge: (
    <>
      <path d="M4 16.5a8 8 0 1 1 16 0" />
      <path d="m12 16.5 3.6-4.3" />
      <circle cx="12" cy="16.5" r="1.3" />
    </>
  ),
  podium: <path d="M3 20h18M4.5 20v-6h5v6M9.5 20V8.5h5V20M14.5 20v-8.5h5V20" />,
  // Full time: the referee's whistle.
  whistle: (
    <>
      <path d="M3.5 9.5h11a5 5 0 1 1-4.9 6H6.5a3 3 0 0 1-3-3z" />
      <circle cx="14.5" cy="14.5" r="1.4" />
      <path d="M9.5 9.5V6.5h3.5" />
    </>
  ),
};

function isOwn(name: AboutIconName): name is OwnIconName {
  return name in PATHS;
}

export function AboutIcon({
  name,
  size = 20,
  className,
}: {
  name: AboutIconName;
  /** CSS pixels, square. */
  size?: number;
  className?: string;
}) {
  if (!isOwn(name)) return <Icon name={name} size={size} className={className} />;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-icon={name}
      className={className === undefined ? 'shrink-0' : `shrink-0 ${className}`}
    >
      {PATHS[name]}
    </svg>
  );
}
