/**
 * Locale registry.
 *
 * English only at launch (D-003), but every layout decision that depends on
 * writing direction reads `directionOf` rather than assuming left-to-right, so
 * adding a locale is a change to this file and nothing else.
 */

export const LOCALES = ['en'] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

/**
 * Languages written right-to-left. Kept separate from `LOCALES` so the mapping
 * stays true regardless of which locales the product currently ships.
 */
const RTL_LANGUAGES = new Set(['ar', 'fa', 'he', 'ur', 'ps', 'sd', 'ug', 'yi']);

export type Direction = 'ltr' | 'rtl';

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

/**
 * Writing direction for a locale tag. Matches on the language subtag, so
 * regional variants (`ar-EG`) resolve correctly.
 */
export function directionOf(locale: string): Direction {
  const language = locale.toLowerCase().split('-')[0] ?? '';

  return RTL_LANGUAGES.has(language) ? 'rtl' : 'ltr';
}

/** The locale segment of a pathname, or `undefined` if it carries none. */
export function localeFromPathname(pathname: string): Locale | undefined {
  const segment = pathname.split('/')[1] ?? '';

  return isLocale(segment) ? segment : undefined;
}
