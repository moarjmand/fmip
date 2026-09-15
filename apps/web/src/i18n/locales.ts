/**
 * Locale registry.
 *
 * English is the source language (D-003). Arabic joined in T-150 and is the
 * first real right-to-left locale; the six Latin-script languages joined in
 * T-300. Every one of them routes and renders, and every string they have no
 * translation for falls back to English *and says so* (`i18n/messages.ts`).
 * None is indexable or offered as a finished language until its catalogue is
 * filled, because a page that looks translated and is not is the language
 * version of faking coverage.
 *
 * Every layout decision that depends on writing direction reads `directionOf`
 * rather than assuming left-to-right, so adding a locale stays a change to this
 * file and a catalogue.
 */

/**
 * `x-rtl` is a pseudo-locale, not a language. It renders English text in a
 * right-to-left document so that a physical-property regression is visible —
 * and catchable in CI — before anyone ships Arabic. `x-` is BCP 47's
 * private-use prefix, so it is a valid `lang` value.
 */
export const PSEUDO_LOCALES = ['x-rtl'] as const;

/**
 * Locales whose catalogue is not finished. They route and render so that a
 * translator can see their work in place, and they are kept out of the index
 * and out of any "choose your language" list until they are done.
 *
 * All seven of the blueprint's non-English languages are here (13.1: `en`,
 * `es`, `fr`, `de`, `pt`, `ar`, `tr`, `it`). None of them has a catalogue yet,
 * and that is the honest state rather than a gap: every string they render
 * falls back to English **and says so** (`messages.ts`), which is what T-151
 * settled before the first locale existed.
 *
 * **The six Latin-script ones were added before Arabic's catalogue was filled,
 * on purpose.** Their failures are quiet -- a wrong plural form, a date in the
 * wrong order -- and quiet failures are what the machinery has to survive
 * before it carries the language whose failures are visible from across a room.
 */
export const UNFINISHED_LOCALES = ['ar', 'de', 'es', 'fr', 'it', 'pt', 'tr'] as const;

export const LOCALES = ['en', ...UNFINISHED_LOCALES, ...PSEUDO_LOCALES] as const;

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

/** Whether this locale's catalogue is still being written (T-150, T-151). */
export function isUnfinishedLocale(value: string): boolean {
  return (UNFINISHED_LOCALES as readonly string[]).includes(value);
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
