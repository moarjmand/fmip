/**
 * Locale registry.
 *
 * English only at launch (D-003), but every layout decision that depends on
 * writing direction reads `directionOf` rather than assuming left-to-right, so
 * adding a locale is a change to this file and nothing else.
 */

/**
 * `x-rtl` is a pseudo-locale, not a language. It renders English text in a
 * right-to-left document so that a physical-property regression is visible —
 * and catchable in CI — before anyone ships Arabic. `x-` is BCP 47's
 * private-use prefix, so it is a valid `lang` value.
 */
export const PSEUDO_LOCALES = ['x-rtl'] as const;

export const LOCALES = ['en', ...PSEUDO_LOCALES] as const;

export type Locale = (typeof LOCALES)[number];

export type PseudoLocale = (typeof PSEUDO_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

/**
 * Languages written right-to-left. Kept separate from `LOCALES` so the mapping
 * stays true regardless of which locales the product currently ships.
 */
const RTL_LANGUAGES = new Set(['ar', 'fa', 'he', 'ur', 'ps', 'sd', 'ug', 'yi']);

/** Locale tags that are right-to-left without being a right-to-left language. */
const RTL_TAGS = new Set<string>(['x-rtl']);

export type Direction = 'ltr' | 'rtl';

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

export function isPseudoLocale(value: string): value is PseudoLocale {
  return (PSEUDO_LOCALES as readonly string[]).includes(value);
}

/**
 * Writing direction for a locale tag. Matches on the language subtag, so
 * regional variants (`ar-EG`) resolve correctly.
 */
export function directionOf(locale: string): Direction {
  const tag = locale.toLowerCase();

  if (RTL_TAGS.has(tag)) {
    return 'rtl';
  }

  const language = tag.split('-')[0] ?? '';

  return RTL_LANGUAGES.has(language) ? 'rtl' : 'ltr';
}

/** The locale segment of a pathname, or `undefined` if it carries none. */
export function localeFromPathname(pathname: string): Locale | undefined {
  const segment = pathname.split('/')[1] ?? '';

  return isLocale(segment) ? segment : undefined;
}
