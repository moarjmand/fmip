'use server';

import { loadCompetitionsMenu } from '@/components/competitions-menu';
import { isLocale } from '@/i18n/locales';
import { isTimeZone } from '@/lib/scores';

/**
 * The competitions menu's list, drawn by the server when the header's panel
 * asks (T-1643, D-301): on the first opening of a page -- or a hover of its
 * trigger just before -- and again on an opening once what it has is more
 * than a few seconds old, so the panel is never older than its answers. The
 * header lives in the locale layout, which a client-side navigation does not
 * render again; this is how it stays current without drawing every
 * competition into every page.
 *
 * Public and read-only: the directory and today's scores as a guest sees
 * them, in the zone the page was drawn with (one `Intl` knows). `null` for
 * anything else, or when the directory could not be read: the panel says so.
 */
export async function refreshCompetitionsMenu(locale: string, timeZone: string) {
  if (typeof locale !== 'string' || !isLocale(locale)) return null;
  if (typeof timeZone !== 'string' || !isTimeZone(timeZone)) return null;
  return (await loadCompetitionsMenu(locale, timeZone)).view;
}
