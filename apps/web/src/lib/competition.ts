import type {
  CoverageState,
  FixtureStatus,
  FormResult,
  LeagueZone,
  LeagueZoneKind,
  LeagueZones,
  SeasonFixture,
  SeasonSummary,
} from '@fmip/contracts';
import { LEADERS_MINUTES_MAX } from '@fmip/contracts';
import { formatDate, formatNumber } from '@/i18n/format';
import { DEFAULT_LOCALE, type Locale, directionOf, isLocale } from '@/i18n/locales';
import { type MessageKey, interpolate, t } from '@/i18n/messages';
import { ltrIsolate } from '@/components/score';
import { stageLabel } from '@/lib/stage-label';

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

/** The page's locale as a catalogue locale; anything unknown reads as English. */
export function pageLocale(locale: string): Locale {
  return isLocale(locale) ? locale : DEFAULT_LOCALE;
}

/**
 * A catalogue message as plain text in the page's locale (T-1304), with any
 * `{name}` placeholders filled -- for strings built outside JSX, where
 * `Translated` cannot go.
 */
export function say(locale: string, key: MessageKey, params?: Record<string, string>): string {
  const text = t(pageLocale(locale), key);
  return params === undefined ? text : interpolate(text, params);
}

/** A provider's stage name or round ("League A - 1") in the reader's words (T-1339). */
export function stageName(locale: string, text: string): string {
  return stageLabel(text, (key) => say(locale, key), locale);
}

/**
 * A list in the reader's language (T-1304): "a, b and c" in English,
 * "الف، ب و ج" in Persian. The joiner and the "and" are the catalogue's.
 */
export function listText(locale: string, items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return say(locale, 'competitionPage.list.and', {
    list: items.slice(0, -1).join(say(locale, 'competitionPage.list.separator')),
    last: items[items.length - 1]!,
  });
}

/**
 * Two numbers joined by an en dash, "3–1", in the locale's digits. On a
 * right-to-left page the pair is isolated left to right, or the bidi
 * algorithm would lay it out as "1–3" (T-153); an English string is left
 * exactly as it was.
 */
export function pairText(locale: string, a: number, b: number): string {
  const text = `${formatNumber(locale, a)}–${formatNumber(locale, b)}`;
  return directionOf(locale) === 'rtl' ? ltrIsolate(text) : text;
}

/** "ALP 3–1 BET" after the match, "ALP v BET" before; short names when there are any. */
export function fixtureLine(locale: string, fixture: SeasonFixture): string {
  const home = fixture.home.short_name ?? fixture.home.name;
  const away = fixture.away.short_name ?? fixture.away.name;
  return fixture.score === null
    ? say(locale, 'competitionPage.versus', { home, away })
    : say(locale, 'competitionPage.scoreLine', {
        home,
        away,
        score: pairText(locale, fixture.score.home, fixture.score.away),
      });
}

/** The form letters: W, D and L in English; ب، م and ش in Persian. */
export const FORM_KEY: Record<FormResult, MessageKey> = {
  W: 'competitionPage.form.won',
  D: 'competitionPage.form.drawn',
  L: 'competitionPage.form.lost',
};

/** The form run as letters, most recent first, e.g. "W D L". */
export function formLine(locale: string, form: FormResult[]): string {
  return form.map((result) => say(locale, FORM_KEY[result])).join(' ');
}

/** A fixture's status where it says something beyond "scheduled" or "finished". */
export const STATUS_KEY: Partial<Record<FixtureStatus, MessageKey>> = {
  live: 'competitionPage.status.live',
  postponed: 'competitionPage.status.postponed',
  suspended: 'competitionPage.status.suspended',
  cancelled: 'competitionPage.status.cancelled',
  abandoned: 'competitionPage.status.abandoned',
  awarded: 'competitionPage.status.awarded',
};

/** " · postponed" beside a fixture's date; nothing for a scheduled or finished one. */
export function statusSuffix(locale: string, status: string): string {
  if (status === 'finished' || status === 'scheduled') return '';
  const key = STATUS_KEY[status as FixtureStatus];
  return ` · ${key === undefined ? status : say(locale, key)}`;
}

/** A module's coverage state, the small label beside its heading (rule 3). */
export const COVERAGE_KEY: Record<CoverageState, MessageKey> = {
  available: 'competitionPage.coverageState.available',
  limited: 'competitionPage.coverageState.limited',
  not_supplied: 'competitionPage.coverageState.notSupplied',
  delayed: 'competitionPage.coverageState.delayed',
};

export function coverageText(locale: string, coverage: CoverageState): string {
  return say(locale, COVERAGE_KEY[coverage]);
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

export const KIND_KEY: Record<string, MessageKey> = {
  league: 'competitionPage.kind.league',
  cup: 'competitionPage.kind.cup',
  super_cup: 'competitionPage.kind.superCup',
  qualifying: 'competitionPage.kind.qualifying',
  friendly: 'competitionPage.kind.friendly',
};

/**
 * The league zones (T-1167, D-171): what each place is called on the table,
 * and the start-edge mark it carries. Colour is never the only sign: the
 * place cell names the zone for a screen reader and the legend below the
 * table says it in words.
 */
export const ZONE_KEY: Record<LeagueZoneKind, MessageKey> = {
  champions_league: 'competitionPage.zone.championsLeague',
  afc_champions_league_elite: 'competitionPage.zone.afcChampionsLeagueElite',
  promotion: 'competitionPage.zone.promotion',
  promotion_playoff: 'competitionPage.zone.promotionPlayoff',
  relegation_playoff: 'competitionPage.zone.relegationPlayoff',
  relegation: 'competitionPage.zone.relegation',
};

export const ZONE_MARK: Record<LeagueZoneKind, string> = {
  champions_league: 'border-s-accent',
  afc_champions_league_elite: 'border-s-accent',
  promotion: 'border-s-accent',
  promotion_playoff: 'border-s-strong',
  relegation_playoff: 'border-s-warning',
  relegation: 'border-s-danger',
};

/** "1-4" or "18": a band of places as the legend reads it. */
export function zoneBand(locale: string, zone: LeagueZone): string {
  return zone.from === zone.to
    ? formatNumber(locale, zone.from)
    : pairText(locale, zone.from, zone.to);
}

/** Why a league table shows no zones (rule 3); null for a cup, which has none to show. */
export function zonesAbsentLine(locale: string, zones: LeagueZones): string | null {
  if (zones.state === 'listed') return null;
  if (zones.reason === 'not_a_league') return null;
  return say(locale, 'competitionPage.zones.absent');
}
