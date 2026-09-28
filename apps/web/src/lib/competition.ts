import type { FormResult, SeasonFixture, SeasonSummary } from '@fmip/contracts';
import { LEADERS_MINUTES_MAX } from '@fmip/contracts';
import { formatDate } from '@/i18n/format';

/**
 * The competition page's pure helpers (T-035): the season the URL selects,
 * the links that keep it, and how a fixture and a form run read.
 */

type SearchParams = Record<string, string | string[] | undefined>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `?season=<id>`; anything that is not an id means the API's default season. */
export function readSeasonParam(params: SearchParams): string | null {
  const raw = Array.isArray(params.season) ? params.season[0] : params.season;
  return raw !== undefined && UUID.test(raw) ? raw.toLowerCase() : null;
}

/** The page for one season; the current season needs no parameter. */
export function seasonHref(
  locale: string,
  competitionId: string,
  season: Pick<SeasonSummary, 'id' | 'is_current'>,
): string {
  const base = `/${locale}/competition/${encodeURIComponent(competitionId)}`;
  return season.is_current ? base : `${base}?season=${encodeURIComponent(season.id)}`;
}

/**
 * `?min_minutes=` (T-824): a whole number of minutes the API accepts; zero,
 * anything else, or nothing means no floor -- a malformed value is dropped
 * here rather than sent on to be refused.
 */
export function readMinMinutesParam(params: SearchParams): number | null {
  const raw = Array.isArray(params.min_minutes) ? params.min_minutes[0] : params.min_minutes;
  if (raw === undefined || !/^\d{1,5}$/.test(raw)) return null;
  const n = Number(raw);
  return n === 0 || n > LEADERS_MINUTES_MAX ? null : n;
}

/** The `GET /competitions/:id` query string, empty for the default season and no floor. */
export function competitionQuery(
  seasonId: string | null,
  minMinutes: number | null = null,
): string {
  const query = new URLSearchParams();
  if (seasonId !== null) query.set('season', seasonId);
  if (minMinutes !== null) query.set('min_minutes', String(minMinutes));
  const text = query.toString();
  return text === '' ? '' : `?${text}`;
}

/**
 * The page with the leaders under a floor (T-824), keeping the season; null
 * is no floor. The fragment brings the reader back to the leaders.
 */
export function leadersHref(
  locale: string,
  competitionId: string,
  season: Pick<SeasonSummary, 'id' | 'is_current'>,
  minMinutes: number | null,
): string {
  const base = `/${locale}/competition/${encodeURIComponent(competitionId)}`;
  const query = competitionQuery(season.is_current ? null : season.id, minMinutes);
  return `${base}${query}#leaders`;
}

/** "ALP 3–1 BET" after the match, "ALP v BET" before; short names when there are any. */
export function fixtureLine(fixture: SeasonFixture): string {
  const home = fixture.home.short_name ?? fixture.home.name;
  const away = fixture.away.short_name ?? fixture.away.name;
  return fixture.score === null
    ? `${home} v ${away}`
    : `${home} ${fixture.score.home}–${fixture.score.away} ${away}`;
}

/** The form run as letters, most recent first, e.g. "W D L". */
export function formLine(form: FormResult[]): string {
  return form.join(' ');
}

/** "Mon, 1 Sept 2025, 18:30" in the viewer's zone. */
export function formatFixtureDate(locale: string, iso: string, timeZone: string): string {
  return formatDate(locale, iso, timeZone, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}

export const KIND_LABEL: Record<string, string> = {
  league: 'League',
  cup: 'Cup',
  super_cup: 'Super cup',
  qualifying: 'Qualifying',
  friendly: 'Friendlies',
};
