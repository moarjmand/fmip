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
