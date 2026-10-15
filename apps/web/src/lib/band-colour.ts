import { BRAND_COLOURS } from '@/lib/brand-colours';

/**
 * A club's colour on the top band of its page (T-1418, D-204, D-218): the
 * fill and the text on it. The text is white or the ink, whichever stands
 * further from the colour; when neither reaches `BAND_MIN_CONTRAST` (WCAG AA
 * for normal text), the colour is darkened towards black in steps of
 * `BAND_DARKEN_STEP` until white does. Pure, so a spec computes every
 * contrast; the colour comes from our own record (`team.colour`), never from
 * a provider field, and this is the only place it is turned into paint.
 */

export const BAND_MIN_CONTRAST = 4.5;
export const BAND_DARKEN_STEP = 0.05;

const WHITE = BRAND_COLOURS['on-accent'];
const INK = BRAND_COLOURS.text;
const HEX = /^#[0-9a-f]{6}$/;

function channels(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

/** WCAG 2 relative luminance of `#rrggbb`. */
export function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio between two `#rrggbb` colours, 1 to 21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** `#rrggbb` moved `amount` (0 to 1) of the way to black. */
export function darken(hex: string, amount: number): string {
  const out = channels(hex).map((c) =>
    Math.round(c * (1 - amount))
      .toString(16)
      .padStart(2, '0'),
  );
  return `#${out.join('')}`;
}

/** The band's fill and text for a club colour, or `null` for a value that is not `#rrggbb`. */
export function bandColours(colour: string): { fill: string; text: string } | null {
  if (!HEX.test(colour)) return null;
  const onWhite = contrast(colour, WHITE);
  const onInk = contrast(colour, INK);
  if (Math.max(onWhite, onInk) >= BAND_MIN_CONTRAST) {
    return { fill: colour, text: onWhite >= onInk ? WHITE : INK };
  }
  for (let step = 1; step * BAND_DARKEN_STEP <= 1; step += 1) {
    const fill = darken(colour, step * BAND_DARKEN_STEP);
    if (contrast(fill, WHITE) >= BAND_MIN_CONTRAST) return { fill, text: WHITE };
  }
  return { fill: darken(colour, 1), text: WHITE };
}
