// Server-side only, like `first-run-cookie.ts`: a guest's zone is in a cookie.
import { readGuestChoices } from './first-run-cookie';
import { chosenTimeZone, defaultTimeZone } from './reader-time-zone';

/**
 * The reader's zone for a page (T-1391, D-207): the member's, else the one a
 * guest chose in the first run, else the locale's default (UK time on `/en`,
 * UTC elsewhere). `chosen` says whether the reader picked it, so a page can
 * say "sign in for your own zone" only to a reader who has not.
 */
export async function pageTimeZone(
  locale: string,
  me: { timezone?: string | null } | null | undefined,
): Promise<{ timeZone: string; chosen: boolean }> {
  const guest = me === null || me === undefined ? await readGuestChoices() : null;
  const chosen = chosenTimeZone(me, guest);
  return { timeZone: chosen ?? defaultTimeZone(locale), chosen: chosen !== null };
}
