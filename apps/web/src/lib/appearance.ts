import {
  CONTRAST_PREFERENCES,
  type ContrastPreference,
  MOTION_PREFERENCES,
  type MotionPreference,
  TEXT_SIZE_PREFERENCES,
  type TextSizePreference,
} from '@fmip/contracts';

/**
 * The accessibility preferences (blueprint 2.2, T-621), kept exactly as the
 * theme is (T-602, D-090): a cookie per preference that the locale layout
 * reads and writes on <html> as an attribute, so the first paint already has
 * them and nothing depends on a script; for a member, the same choice on the
 * account (`PATCH /me/preferences`), brought to a new browser at sign-in.
 *
 *   text size  `data-text-size`  default | large | larger  (100 / 112.5 / 125%)
 *   contrast   `data-contrast`   system | standard | more  (more: AAA text)
 *   motion     `data-motion`     system | reduce
 *
 * The first value of each is what nobody chose: the browser's own text size,
 * and the device's `prefers-contrast` and `prefers-reduced-motion`.
 */
export const APPEARANCE = {
  text_size: {
    cookie: 'fmip_text_size',
    attribute: 'data-text-size',
    values: TEXT_SIZE_PREFERENCES,
  },
  contrast: {
    cookie: 'fmip_contrast',
    attribute: 'data-contrast',
    values: CONTRAST_PREFERENCES,
  },
  motion: {
    cookie: 'fmip_motion',
    attribute: 'data-motion',
    values: MOTION_PREFERENCES,
  },
} as const;

export type AppearanceKey = keyof typeof APPEARANCE;
export const APPEARANCE_KEYS = Object.keys(APPEARANCE) as AppearanceKey[];

export interface Appearance {
  text_size: TextSizePreference;
  contrast: ContrastPreference;
  motion: MotionPreference;
}

export type { ContrastPreference, MotionPreference, TextSizePreference };

/** What nobody chose, for each: the first value of its list. */
export const DEFAULT_APPEARANCE: Appearance = {
  text_size: TEXT_SIZE_PREFERENCES[0],
  contrast: CONTRAST_PREFERENCES[0],
  motion: MOTION_PREFERENCES[0],
};

/** A value from a cookie or a form: one of that preference's own, or `undefined`. */
export function parseAppearance<K extends AppearanceKey>(
  key: K,
  raw: unknown,
): Appearance[K] | undefined {
  const values: readonly string[] = APPEARANCE[key].values;
  return values.find((value) => value === raw) as Appearance[K] | undefined;
}

/**
 * What the layout renders on <html>, from whatever the cookies hold: an
 * unknown or missing value is the default.
 */
export function appearanceOf(raw: Partial<Record<AppearanceKey, unknown>>): Appearance {
  return {
    text_size: parseAppearance('text_size', raw.text_size) ?? DEFAULT_APPEARANCE.text_size,
    contrast: parseAppearance('contrast', raw.contrast) ?? DEFAULT_APPEARANCE.contrast,
    motion: parseAppearance('motion', raw.motion) ?? DEFAULT_APPEARANCE.motion,
  };
}

/**
 * At sign-in, the browser and the account come to one value, the rule the
 * theme follows (`reconcileTheme`): a choice the account holds reaches this
 * browser; an account that never chose takes the one this browser made as a
 * guest; nothing is written when the two agree or neither chose.
 */
export function reconcilePreference<T extends string>(
  account: T,
  browser: T | undefined,
  unchosen: T,
): { cookie?: T; account?: T } {
  if (account !== unchosen) return account === browser ? {} : { cookie: account };
  if (browser !== undefined && browser !== unchosen) return { account: browser };
  return {};
}
