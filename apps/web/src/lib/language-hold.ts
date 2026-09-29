import { cache } from 'react';
import { DEFAULT_LOCALE, type Locale } from '@/i18n/locales';
import { isShippable } from '@/i18n/messages';
import { fetchHeldLocales } from '@/lib/api';

/**
 * Holding back a language that is ready (T-1163, D-155), as the web applies it.
 *
 * A locale is offered when its catalogue passes `isShippable` **and** no
 * administrator holds it back. A hold only ever takes a language away: nothing
 * here can offer a locale `isShippable` refuses, and English, the default, is
 * never held. The holds are read from the API once per request.
 *
 * **When the holds cannot be read, only English is offered.** A hold exists
 * because something in that language must not be shown yet; offering it
 * because the API did not answer would undo the hold at the worst moment.
 * English is always true, so the fallback is a smaller offer, never a false
 * one.
 */

/** When each held locale was held, or `null` when the holds could not be read. */
export type Holds = ReadonlyMap<string, string> | null;

/** The holds in force, once per request (React's `cache`). */
export const currentHolds = cache(async (): Promise<Holds> => {
  const result = await fetchHeldLocales();
  if (!result.ok) return null;
  return new Map(result.data.held.map((hold) => [hold.locale, hold.held_at]));
});

/**
 * The offer predicate given the holds: shippable and not held, English always
 * (when it is shippable, which it is by being the source). Pure, so both
 * states are tested without a catalogue or an API.
 */
export function offeredGiven(
  holds: Holds,
  shippable: (locale: Locale) => boolean = isShippable,
): (locale: Locale) => boolean {
  return (locale) =>
    shippable(locale) && (locale === DEFAULT_LOCALE || (holds !== null && !holds.has(locale)));
}

/** The predicate for this request: what the picker, the first run and its save action use. */
export async function offeredNow(): Promise<(locale: Locale) => boolean> {
  return offeredGiven(await currentHolds());
}

/** The cookie that remembers a reader was told their language is held, once per hold. */
export const HELD_NOTICE_COOKIE = 'fmip_held_notice';

/**
 * Whether to tell a reader their stored language is held, and the value that
 * says they were told: `<locale>@<held_at>`, so a later hold of the same
 * language is told again. `null` when there is nothing to tell: no stored
 * language, English, not held, the holds unreadable, or already told.
 */
export function heldNotice(
  stored: string | null | undefined,
  holds: Holds,
  seen: string | undefined,
): string | null {
  if (stored === null || stored === undefined || stored === DEFAULT_LOCALE || holds === null)
    return null;
  const since = holds.get(stored);
  if (since === undefined) return null;
  const value = `${stored}@${since}`;
  return seen === value ? null : value;
}
