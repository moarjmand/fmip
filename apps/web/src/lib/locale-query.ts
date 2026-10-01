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
 * those names in the reader's language. Left alone when the caller already
 * chose a locale, for the operators' console (`/admin`, which stays in
 * English, D-175), for writes, and when the reader is on the default
 * language or a pseudo-locale -- the canonical names are already English.
 */
export function withReaderLocale(
  path: string,
  method: string,
  reader: string | null | undefined,
): string {
  if (method !== 'GET' || reader === null || reader === undefined) return path;
  if (!isLocale(reader) || reader === DEFAULT_LOCALE || isPseudoLocale(reader)) return path;
  if (path.startsWith('/admin') || /[?&]locale=/.test(path)) return path;
  return withLocale(path, reader);
}
