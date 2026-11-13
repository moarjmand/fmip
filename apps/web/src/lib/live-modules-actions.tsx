'use server';

import type { MatchCentre } from '@fmip/contracts';
import { isLocale } from '@/i18n/locales';
import { type ApiResult, fetchMatchCentre } from '@/lib/api';
import { type LiveModules, drawsKeyEvents } from '@/lib/live-modules';
import { isTimeZone } from '@/lib/scores';
import { matchWords } from '@/lib/words-server';
import { KeyEvents } from '@/components/match-key-events';

/**
 * The match centre's moving modules, drawn again by the server when the live
 * page's stream says they changed (T-1811, D-409 point 2): the key events
 * today; the statistics, line-ups and Top rated as they move to the server
 * (T-1813, T-1814). The page calls it from `LiveMatch`, and only when a
 * snapshot changed what these modules read (`lib/live-modules`), so a
 * thousand readers of a match ask about once an event, not once a second.
 *
 * Public and read-only, like `refreshCompetitionsMenu` (D-301): a fixture
 * id, a locale and an IANA zone and nothing else; no cookie is read, so the
 * answer is the same document for every reader. It never draws from what a
 * client sends: it asks the API for the match itself. `null` for anything
 * else, or when the match cannot be read -- the page keeps what it has.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The reads in flight, by fixture and locale: calls that arrive together
 * (every reader of a match, a few seconds after a goal) share one read of
 * the match, as the API's `SharedSnapshots` does for its stream. A read is
 * forgotten once it settles; nothing is cached after that.
 */
const reading = new Map<string, Promise<ApiResult<MatchCentre>>>();

function readMatch(fixtureId: string, locale: string): Promise<ApiResult<MatchCentre>> {
  const key = `${fixtureId} ${locale}`;
  const current = reading.get(key);
  if (current !== undefined) return current;
  const read = fetchMatchCentre(fixtureId, locale).finally(() => reading.delete(key));
  reading.set(key, read);
  return read;
}

export async function refreshLiveModules(
  fixtureId: string,
  locale: string,
  timeZone: string,
): Promise<LiveModules | null> {
  if (typeof fixtureId !== 'string' || !UUID.test(fixtureId)) return null;
  if (typeof locale !== 'string' || !isLocale(locale)) return null;
  if (typeof timeZone !== 'string' || !isTimeZone(timeZone)) return null;
  const result = await readMatch(fixtureId, locale);
  if (!result.ok) return null;
  const centre = result.data;
  const words = matchWords(locale);
  const modules: LiveModules = {};
  // The same card and the same rule as the page (`drawsKeyEvents`); a match
  // whose status no longer has it leaves the page's slot as it is (the
  // status change draws the whole page again).
  if (drawsKeyEvents(centre.fixture.status)) {
    modules.keyEvents = (
      <KeyEvents centre={centre} locale={locale} timeZone={timeZone} words={words} />
    );
  }
  return modules;
}
