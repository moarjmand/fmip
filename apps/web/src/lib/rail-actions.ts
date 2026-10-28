'use server';

import { loadRail } from '@/components/matchday-rail';
import { isLocale } from '@/i18n/locales';
import { isTimeZone } from '@/lib/scores';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The matchday rail drawn again (T-1635, D-297). The rail is in the locale
 * layout, which a client-side navigation does not render again, so its
 * client half (`MatchdayRailView`) asks for it through this Server Function
 * while a match today is being played, and the answer is the rail as the
 * server draws it on a page load: the same logos, statuses and drawer, by
 * the same code, from the same shared answer (`sharedAnswer`). Nothing is
 * drawn twice in two ways, and the contracts package stays off the client.
 * Only the drawer the reader has open is drawn (`drawer`, a competition id,
 * or `null` for none), not every league's.
 *
 * Public and read-only, like the rail: today's scores as a guest sees them,
 * asked without the session. The zone and "a member" come from the page the
 * server drew; the zone must be one `Intl` knows, and "a member" only adds
 * the My teams link. `null` for anything else, and the rail keeps what it
 * has (its freshness note says when that is behind).
 */
export async function refreshRail(
  locale: string,
  timeZone: string,
  signedIn: boolean,
  fresh: boolean,
  drawer: string | null,
) {
  if (typeof locale !== 'string' || !isLocale(locale)) return null;
  if (typeof timeZone !== 'string' || !isTimeZone(timeZone)) return null;
  if (drawer !== null && (typeof drawer !== 'string' || !UUID.test(drawer))) return null;
  return loadRail(
    { locale, timeZone, signedIn: signedIn === true },
    { fresh: fresh === true, drawer },
  );
}
