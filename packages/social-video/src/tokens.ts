/**
 * The clips are drawn in the social card's Night tokens (D-454 point 1,
 * D-427 point 11). `packages/*` may not import from `apps/web`, so the values
 * are written here a second time; `tokens.spec.ts` reads
 * `apps/web/src/lib/brand-colours.ts` and fails if one of them differs.
 *
 * `model` is the turquoise only the statistical model's words wear (rule 6).
 */
export const NIGHT = {
  canvas: '#0f1215',
  surface: '#171b1f',
  text: '#eef0f1',
  'text-muted': '#a3acb5',
  caption: '#828c96',
  border: '#2a3037',
  accent: '#eba53c',
  model: '#3cc4be',
} as const;

/** The Stadiomind mark's Night bars (D-262), never recoloured. */
export const MARK_NIGHT = { home: '#2bb3ad', draw: '#56616b', away: '#eba53c' } as const;

/** The logo's bars on its 24-unit grid, as `apps/web`'s `BrandMark` draws them. */
export const MARK_BARS = [
  { y: 4, width: 18, colour: 'home' },
  { y: 10, width: 11, colour: 'draw' },
  { y: 16, width: 7, colour: 'away' },
] as const;

/** Opacity of a bar segment by its share's rank (D-368): full, three quarters, a half. */
export const RANK_OPACITY = { 1: 1, 2: 0.75, 3: 0.5 } as const;

/** The card's faces (`apps/web/src/lib/card-fonts.ts`) and the Persian one. */
export const FACES = {
  sans: 'Archivo',
  narrow: 'Archivo Narrow',
  black: 'Archivo Black',
  mono: 'Geist Mono',
  persian: 'Vazirmatn',
} as const;

export const SANS = `${FACES.sans}, sans-serif`;
export const NARROW = `'${FACES.narrow}', ${FACES.sans}, sans-serif`;
export const BLACK = `'${FACES.black}', ${FACES.sans}, sans-serif`;
export const MONO = `'${FACES.mono}', monospace`;
/** Persian text first; Latin letters inside it (the model's version) fall to Archivo. */
export const PERSIAN = `${FACES.persian}, ${FACES.sans}, sans-serif`;

/** Both aspects of D-454 point 10, 15 s at 30 frames a second. */
export const CLIP = { fps: 30, seconds: 15 } as const;
export const ASPECTS = {
  '9x16': { width: 1080, height: 1920 },
  '4x5': { width: 1080, height: 1350 },
} as const;
export type Aspect = keyof typeof ASPECTS;
