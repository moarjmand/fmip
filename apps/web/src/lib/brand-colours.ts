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
  canvas: '#f2f3f1',
  text: '#121518',
  'text-muted': '#4c5660',
  border: '#dce0e2',
  accent: '#8a5300',
  'on-accent': '#ffffff',
} as const;

/**
 * The D-089 mark's colours: the green tile and its white "F", which the
 * committed app icons (`public/icons`), the manifest and `theme-color` share.
 * The Stadiomind palette (D-263) moved the tokens to saffron, but the mark,
 * the icons and the browser's tint move together when T-1492 draws the
 * Stadiomind mark (D-262); until then they keep this green, so an icon and
 * the inline mark never disagree. TODO(T-1492): remove with the old mark.
 */
export const MARK_COLOURS = {
  tile: '#0b6b3a',
  figure: '#ffffff',
} as const;
