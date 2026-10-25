import type { ReactElement } from 'react';
import { MARK_COLOURS } from '@/lib/brand-colours';

/** The logo's bars, home, draw and away, on its 24-unit grid. */
const BARS = [
  { y: 4, width: 18, colour: 'home' },
  { y: 10, width: 11, colour: 'draw' },
  { y: 16, width: 7, colour: 'away' },
] as const;

/**
 * The Stadiomind mark (T-1492, D-262): three rounded bars, home, draw and
 * away, the forecast bar turned into a sign. Drawn inline so the header and
 * the share cards need no request for it.
 *
 * - `day` and `night` are the Design System's logos: the bars alone, in the
 *   colours for a paper or an ink ground. The header is on paper in either
 *   theme (D-198), and so are the share cards, so both take `day`.
 * - `tile` is `public/icons/mark.svg`, the source `scripts/make-icons.mjs`
 *   draws the favicon and the app icons from: the Night bars on an ink tile,
 *   at twice the logo's scale and centred (64 units = 2 x 24 + 16).
 *   `brand-mark.spec.ts` fails if the two differ.
 *
 * Decorative wherever it is used: the product's name always stands beside it,
 * so it is hidden from assistive technology rather than given a second label.
 * Plain attributes only, because `next/og` renders it too -- and so plain
 * colour values, from `lib/brand-colours.ts` (`MARK_COLOURS`), and sibling
 * shapes rather than a fragment, which `next/og` cannot draw.
 */
export function BrandMark({
  size,
  ground = 'day',
  className,
}: {
  size: number;
  ground?: 'day' | 'night' | 'tile';
  className?: string;
}): ReactElement {
  const tile = ground === 'tile';
  const colours = tile ? MARK_COLOURS.night : MARK_COLOURS[ground];
  const scale = tile ? 2 : 1;
  const offset = tile ? 8 : 0;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={tile ? '0 0 64 64' : '0 0 24 24'}
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {tile ? <rect x="0" y="0" width="64" height="64" rx="14" fill={MARK_COLOURS.tile} /> : null}
      {BARS.map(({ y, width, colour }) => (
        <rect
          key={colour}
          x={3 * scale + offset}
          y={y * scale + offset}
          width={width * scale}
          height={4 * scale}
          rx={2 * scale}
          fill={colours[colour]}
        />
      ))}
    </svg>
  );
}
