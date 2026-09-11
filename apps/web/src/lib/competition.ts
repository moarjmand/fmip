import type { FormResult, SeasonFixture, SeasonSummary } from '@fmip/contracts';

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

/** The `GET /competitions/:id` query string, empty for the default season. */
export function competitionQuery(seasonId: string | null): string {
  return seasonId === null ? '' : `?season=${encodeURIComponent(seasonId)}`;
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
export function formatFixtureDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
}

export const KIND_LABEL: Record<string, string> = {
  league: 'League',
  cup: 'Cup',
  super_cup: 'Super cup',
  qualifying: 'Qualifying',
  friendly: 'Friendlies',
};
