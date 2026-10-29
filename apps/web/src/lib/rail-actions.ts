'use server';

import { loadMoments } from '@/components/moments-rail';
import { isLocale } from '@/i18n/locales';
import { isTimeZone } from '@/lib/scores';

/**
 * The moments rail drawn again (T-1642, D-300; the matchday rail's since
 * T-1635, D-297). The rail is in the locale layout, which a client-side
 * navigation does not render again, so its client half (`MomentsRailView`)
 * asks for it through this Server Function while anything is being played,
 * and the answer is the rail as the server draws it on a page load: the same
 * cards and hover cards, by the same code, from the same shared answer
 * (`sharedAnswer`). Nothing is drawn twice in two ways, and the contracts
 * package and the catalogues stay off the client.
 *
 * Public and read-only, like the rail. The zone and "a member" come from the
 * page the server drew; the zone must be one `Intl` knows. A member's answer
 * is asked with their own session cookie, read here, which only marks their
 * followed matches; anyone else's is a guest's. `null` for anything else,
 * and the rail keeps what it has (its freshness note says when that is
 * behind).
 */
export async function refreshRail(
  locale: string,
  timeZone: string,
  signedIn: boolean,
  fresh: boolean,
) {
  if (typeof locale !== 'string' || !isLocale(locale)) return null;
  if (typeof timeZone !== 'string' || !isTimeZone(timeZone)) return null;
  return loadMoments({ locale, timeZone, signedIn: signedIn === true }, { fresh: fresh === true });
}
