/**
 * The light colour tokens as plain values, for the renderers that cannot
 * read a CSS variable (T-602, D-090): `next/og` drawing the share cards, the
 * web manifest, the `theme-color` meta and the inline mark that `next/og`
 * also draws. Each key is a token's name in `app/tokens.css` without its
 * `--token-` prefix, and `app/tokens.spec.ts` fails if a value here differs
 * from the light value there.
 *
 * This object and `tokens.css` are the only places in `src` a colour is
 * written; `app/raw-colours.spec.ts` refuses one anywhere else. A page never
 * imports it for styling -- classes carry the tokens and follow the theme,
 * which these values do not.
 */
export const BRAND_COLOURS = {
  canvas: '#ffffff',
  text: '#111827',
  'text-muted': '#4b5563',
  border: '#d1d5db',
  accent: '#0b6b3a',
  'on-accent': '#ffffff',
} as const;
