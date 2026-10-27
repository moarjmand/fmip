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
 * The Stadiomind mark's colours (T-1492, D-262), from the Design System's
 * logos and never recoloured: three bars, home, draw and away, in a Day set
 * for the paper ground and a Night set for the ink one. `tile` is that ink
 * ground -- the Night canvas -- under the favicon and the app icons
 * (`public/icons/mark.svg`), and the browser's tint and the manifest's
 * splash on a dark device.
 */
export const MARK_COLOURS = {
  tile: '#0f1215',
  day: { home: '#0e7a75', draw: '#626c76', away: '#b87818' },
  night: { home: '#2bb3ad', draw: '#56616b', away: '#eba53c' },
} as const;
