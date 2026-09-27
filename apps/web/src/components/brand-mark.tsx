import type { ReactElement } from 'react';
import { BRAND_COLOURS } from '@/lib/brand-colours';

/**
 * The mark (T-604, D-089): a green tile with a white "F" and a ball. The
 * source is `public/icons/mark.svg`, which `scripts/make-icons.mjs` draws the
 * app icons from; this is the same drawing inline, so the header and the share
 * cards need no request for it. `brand-mark.spec.ts` fails if the two differ.
 *
 * Decorative wherever it is used: the product's name always stands beside it,
 * so it is hidden from assistive technology rather than given a second label.
 * Plain attributes only, because `next/og` renders it too -- and so plain
 * colour values, from `lib/brand-colours.ts`: the mark is the same green on
 * either theme.
 */
export function BrandMark({ size, className }: { size: number; className?: string }): ReactElement {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <rect x="0" y="0" width="64" height="64" rx="14" fill={BRAND_COLOURS.accent} />
      <rect x="17" y="13" width="10" height="38" fill={BRAND_COLOURS['on-accent']} />
      <rect x="17" y="13" width="29" height="9" fill={BRAND_COLOURS['on-accent']} />
      <rect x="17" y="28" width="19" height="8" fill={BRAND_COLOURS['on-accent']} />
      <circle cx="42" cy="45" r="6" fill={BRAND_COLOURS['on-accent']} />
    </svg>
  );
}
