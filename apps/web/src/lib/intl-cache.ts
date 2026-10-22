/**
 * `Intl` formatters, made once per locale and option set (T-1466).
 *
 * Constructing an `Intl.DateTimeFormat` costs about 0.2 ms; using one costs a
 * hundredth of that. The homepage's helpers asked for a new one for every
 * kick-off in two weeks of scores (649 matches, five or six passes): 969 ms
 * of a render on the production payload, the gap between its second and
 * third round of requests. Formatters are immutable and safe to share, so
 * each distinct (locale, options) pair is built once per process. The keys
 * are few -- a handful of option sets times the locales and the zones
 * readers use -- and the map is emptied if it ever passes `MAX_ENTRIES`.
 */

const MAX_ENTRIES = 1000;

function cached<T>(map: Map<string, T>, locale: string, options: object, make: () => T): T {
  const key = `${locale}\u0000${JSON.stringify(options)}`;
  let found = map.get(key);
  if (found === undefined) {
    if (map.size >= MAX_ENTRIES) map.clear();
    found = make();
    map.set(key, found);
  }
  return found;
}

const dates = new Map<string, Intl.DateTimeFormat>();
const numbers = new Map<string, Intl.NumberFormat>();
const relatives = new Map<string, Intl.RelativeTimeFormat>();

export function dateTimeFormat(
  locale: string,
  options: Intl.DateTimeFormatOptions = {},
): Intl.DateTimeFormat {
  return cached(dates, locale, options, () => new Intl.DateTimeFormat(locale, options));
}

export function numberFormat(
  locale: string,
  options: Intl.NumberFormatOptions = {},
): Intl.NumberFormat {
  return cached(numbers, locale, options, () => new Intl.NumberFormat(locale, options));
}

export function relativeTimeFormat(
  locale: string,
  options: Intl.RelativeTimeFormatOptions = {},
): Intl.RelativeTimeFormat {
  return cached(relatives, locale, options, () => new Intl.RelativeTimeFormat(locale, options));
}
