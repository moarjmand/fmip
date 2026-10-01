import { DEFAULT_LOCALE, isLocale, isPseudoLocale } from '@/i18n/locales';

/**
 * `?locale=` on a catalog request (T-303): the language the reader is on, so
 * the API can answer a localised name beside the canonical one.
 *
 * A pure string helper, because the three fetchers that need it already build
 * their paths three different ways -- a bare path, a path with a season query
 * -- and the join is the part that is easy to get wrong.
 */
export function withLocale(path: string, locale: string | undefined): string {
  if (locale === undefined || locale === '') return path;
  const joiner = path.includes('?') ? '&' : '?';
  return `${path}${joiner}locale=${encodeURIComponent(locale)}`;
}

/**
 * The request header the locale proxy sets on every page request (T-1312),
 * so the API client can ask for names in the reader's language without each
 * page passing its locale to each fetcher.
 */
export const READER_LOCALE_HEADER = 'x-fmip-locale';

/**
 * The path a read is sent to, with the reader's locale on it (T-1312): every
 * `GET` that may name a team, a competition or a country, so the API answers
 * those names in the reader's language. The default language is sent too
 * (D-178): it is also which news sources the reader is shown, and a read
 * without a locale filters none. A pseudo-locale reads as the default
 * language, whose words it carries. Left alone when the caller already chose
 * a locale, for the operators' console (`/admin`, which stays in English,
 * D-175), and for writes.
 */
export function withReaderLocale(
  path: string,
  method: string,
  reader: string | null | undefined,
): string {
  if (method !== 'GET' || reader === null || reader === undefined) return path;
  if (path.startsWith('/admin') || /[?&]locale=/.test(path)) return path;
  if (isPseudoLocale(reader)) return withLocale(path, DEFAULT_LOCALE);
  if (!isLocale(reader)) return path;
  return withLocale(path, reader);
}
