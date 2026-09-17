import { DEFAULT_LOCALE, type Locale, isLocale, isPseudoLocale } from './locales';

/**
 * Dates, times and numbers in the reader's language (T-300).
 *
 * Until this module existed every date in the product was formatted with a
 * hardcoded `'en-GB'`, so `/es` rendered Spanish-marked English over British
 * dates: the words said one language and the numbers said another. Formatting
 * is the half of T-300 that is *not* translation -- there is no catalogue to
 * fill and no translator to wait for, because `Intl` already knows how Spanish
 * writes a Tuesday. It only had to be asked.
 *
 * **What this module is not for.** Two calls in `lib/scores.ts` also use
 * `Intl.DateTimeFormat`, and neither displays anything: one validates a time
 * zone name (`en-US`), the other builds the `YYYY-MM-DD` key the scores day
 * tabs are addressed by (`en-CA`, chosen because its date order *is* ISO).
 * Those are machine formats. Routing them through here would make the day
 * tabs' URLs depend on the reader's language, and `format.spec.ts` fails if
 * anybody tries. The distinction is the whole point of having one module: a
 * date somebody reads goes through here; a date something parses does not.
 */

/**
 * The tag `Intl` is given for one of our locales.
 *
 * `en` becomes `en-GB` on purpose: that is what every call site said before
 * this module, so an English page formats byte-for-byte as it did, and the
 * change to the other seven locales is the only change. The pseudo-locale is
 * English mirrored, not a language, so it formats as English too -- and it has
 * to be mapped rather than passed through, because `x-rtl` is a private-use
 * tag and `Intl.DateTimeFormat('x-rtl')` throws a RangeError. Every page on
 * `/x-rtl` that shows a date would otherwise crash in render.
 */
export function intlLocale(locale: string): string {
  if (!isLocale(locale) || isPseudoLocale(locale) || locale === DEFAULT_LOCALE) return 'en-GB';
  return locale;
}

/** The moment `iso` names, or the epoch if it is not one -- never a throw in a render. */
function at(iso: string | number): Date {
  return new Date(iso);
}

/**
 * Date and time together, the way a list of messages or requests shows when
 * something happened: "5 Jan 2025, 16:28" in English, "5 ene 2025, 16:28" in
 * Spanish, "05.01.2025, 16:28" in German.
 */
export function formatDateTime(locale: Locale | string, iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(at(iso));
}

/**
 * A clock reading, always on the 24-hour cycle: "20:31", or "20:31:07" with
 * `seconds`. The cycle is fixed rather than left to the locale because these
 * are kick-offs and last-updated stamps read at a glance beside a live score,
 * and "8:31 pm" is longer, wraps, and is not how football is written anywhere
 * the product ships.
 */
export function formatTime(
  locale: Locale | string,
  iso: string | number,
  timeZone: string,
  options: { seconds?: boolean } = {},
): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    ...(options.seconds ? { second: '2-digit' } : {}),
    hourCycle: 'h23',
  }).format(at(iso));
}

/**
 * A date with the parts a call site asks for, in the locale's own order and
 * spelling. `parts` is the same option bag `Intl.DateTimeFormat` takes, minus
 * the locale, so a caller that today writes the options out keeps writing them.
 */
export function formatDate(
  locale: Locale | string,
  iso: string,
  timeZone: string,
  parts: Pick<
    Intl.DateTimeFormatOptions,
    'weekday' | 'day' | 'month' | 'year' | 'hour' | 'minute' | 'hourCycle'
  >,
): string {
  return new Intl.DateTimeFormat(intlLocale(locale), { timeZone, ...parts }).format(at(iso));
}

/** A count somebody reads -- an attendance, a capacity -- with the locale's grouping. */
export function formatNumber(locale: Locale | string, value: number): string {
  return new Intl.NumberFormat(intlLocale(locale)).format(value);
}
