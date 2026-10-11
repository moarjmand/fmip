import { DEFAULT_LOCALE, isLocale, type Locale } from '@/i18n/locales';
import { interpolate, t } from '@/i18n/messages';
import { isTimeZone } from './first-run';

/**
 * The reader's time zone, the same on every page (T-1391, D-207): the
 * member's zone, else the one a guest chose in the first run (T-620), else
 * the locale's default. Pure, so every page and the live strip agree and the
 * rule is tested once.
 *
 * The default is the English site's audience, abroad: UK time on `/en`
 * (D-207). Every other locale keeps UTC, as `/fa` did before.
 */
export const ENGLISH_DEFAULT_TIME_ZONE = 'Europe/London';

export function defaultTimeZone(locale: string): string {
  return locale === 'en' ? ENGLISH_DEFAULT_TIME_ZONE : 'UTC';
}

type Zoned = { timezone?: string | null } | null | undefined;

/** The zone the reader chose (member first, then guest), or `null` when neither did. */
export function chosenTimeZone(me: Zoned, guest: Zoned): string | null {
  for (const zone of [me?.timezone, guest?.timezone]) {
    if (typeof zone === 'string' && zone !== '' && isTimeZone(zone)) return zone;
  }
  return null;
}

export function readerTimeZone(locale: string, me: Zoned, guest: Zoned): string {
  return chosenTimeZone(me, guest) ?? defaultTimeZone(locale);
}

/**
 * The zone in words, after a time: "UK time", "Tehran time", "UTC", or
 * "<city> time" for any other zone. "UTC time" is not English (D-207).
 */
export function zoneWords(locale: string, timeZone: string): string {
  const l: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  if (timeZone === 'Asia/Tehran') return t(l, 'nextMatch.tehranTime');
  if (timeZone === ENGLISH_DEFAULT_TIME_ZONE) return t(l, 'nextMatch.ukTime');
  if (timeZone === 'UTC' || timeZone === 'Etc/UTC') return t(l, 'nextMatch.utc');
  return interpolate(t(l, 'nextMatch.zoneTime'), {
    zone: timeZone.split('/').at(-1)?.replace(/_/g, ' ') ?? timeZone,
  });
}
