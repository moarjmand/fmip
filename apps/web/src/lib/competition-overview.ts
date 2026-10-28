import type {
  AccuracyMetrics,
  AccuracyPoint,
  CompetitionPage,
  CoverageState,
  PublicModelAccuracyResponse,
  SeasonFixture,
  SeasonSummary,
} from '@fmip/contracts';
import { ACCURACY_MINIMUM_MATCHES } from '@fmip/contracts';
import { formatNumber, intlLocale } from '@/i18n/format';
import { competitionQuery, stageNames } from '@/lib/competition';

/**
 * The Hybrid competition page's pure helpers (T-1385, D-203): which tab the
 * URL opens, the links that keep the season, the round the Overview calls
 * "this matchweek", fixtures grouped by round, and the league's figures
 * counted from its stored results. Nothing here asks the API.
 */

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * The page's sections, in the order the tab bar shows them (T-1498, D-274):
 * the Stadiomind canvas's six. Fixtures and results are one Matches tab.
 */
export const COMPETITION_TABS = [
  'overview',
  'table',
  'matches',
  'players',
  'model',
  'news',
] as const;
export type CompetitionTab = (typeof COMPETITION_TABS)[number];

/**
 * The Hybrid page's tab addresses (T-1385), kept working: a shared link to
 * `?tab=fixtures` or `?tab=results` opens Matches, `?tab=stats` the Overview,
 * whose coverage module it held.
 */
const RETIRED_TABS: Record<string, CompetitionTab> = {
  fixtures: 'matches',
  results: 'matches',
  stats: 'overview',
};

/** `?tab=`: one of the page's sections; anything else (or nothing) is the Overview. */
export function readTabParam(params: SearchParams): CompetitionTab {
  const raw = (Array.isArray(params.tab) ? params.tab[0] : params.tab) ?? '';
  if ((COMPETITION_TABS as readonly string[]).includes(raw)) return raw as CompetitionTab;
  return RETIRED_TABS[raw] ?? 'overview';
}

/**
 * Whether the season has a table to show (T-1385). A league always has one
 * to speak of, rows or a "not supplied" sentence; a season with a group
 * stage has its groups; a cup played only in knockout rounds (a domestic
 * cup) has none, and the page says so instead of drawing an empty grid.
 */
export function hasTable(
  page: Pick<CompetitionPage, 'table' | 'group_tables'> & {
    competition: Pick<CompetitionPage['competition'], 'kind'>;
  },
): boolean {
  if (page.group_tables !== null) return true;
  if ((page.table.data ?? []).length > 0) return true;
  return page.competition.kind === 'league';
}

/**
 * The tabs this season has: the Table tab only when there is a table or a
 * knockout bracket to put in it (a domestic cup has neither).
 */
export function availableTabs(
  page: Pick<CompetitionPage, 'table' | 'group_tables' | 'bracket'> & {
    competition: Pick<CompetitionPage['competition'], 'kind'>;
  },
): CompetitionTab[] {
  const table = hasTable(page) || page.bracket !== null;
  return COMPETITION_TABS.filter((tab) => tab !== 'table' || table);
}

/** One tab's address, keeping the season and the scorers' floor; the Overview needs no `tab`. */
export function tabHref(
  locale: string,
  competitionId: string,
  season: Pick<SeasonSummary, 'id' | 'is_current'>,
  tab: CompetitionTab,
  minMinutes: number | null = null,
): string {
  const base = `/${locale}/competition/${encodeURIComponent(competitionId)}`;
  const query = new URLSearchParams(
    competitionQuery(season.is_current ? null : season.id, minMinutes).replace(/^\?/, ''),
  );
  if (tab !== 'overview') query.set('tab', tab);
  const text = query.toString();
  return text === '' ? base : `${base}?${text}`;
}

/** At most this many matches of a round on the Overview; the Fixtures tab has them all. */
export const MATCHWEEK_LIMIT = 12;

export interface Matchweek {
  /** The round in the reader's words, or null when we cannot name it (D-193). */
  label: string | null;
  /** `next`: the round being played or about to be; `latest`: the season's last round played. */
  state: 'next' | 'latest';
  /** The round's matches by kick-off, at most `MATCHWEEK_LIMIT`. */
  fixtures: SeasonFixture[];
  /** Matches the round has beyond the ones shown. */
  more: number;
}

const byKickoff = (a: SeasonFixture, b: SeasonFixture): number =>
  a.kickoff_at === b.kickoff_at ? a.id.localeCompare(b.id) : a.kickoff_at < b.kickoff_at ? -1 : 1;

const sameRound = (a: SeasonFixture, b: SeasonFixture): boolean =>
  a.round === b.round && (a.stage?.id ?? null) === (b.stage?.id ?? null);

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The round the Overview shows (T-1385): the one a live match belongs to,
 * else the next scheduled match's, with every match of that round played or
 * not; when the season has nothing left to play, its last round. A match
 * whose round is not stored brings the week of matches from it instead,
 * unnamed. A postponed match from an old round does not set the round.
 * Null when the season has no match at all.
 */
export function currentMatchweek(
  locale: string,
  page: Pick<CompetitionPage, 'results' | 'fixtures'>,
): Matchweek | null {
  const anchor =
    page.fixtures.find((f) => f.status === 'live') ??
    page.fixtures.find((f) => f.status === 'scheduled') ??
    page.results[0];
  if (anchor === undefined) return null;
  const state = page.fixtures.includes(anchor) ? 'next' : 'latest';
  const all = [...page.results, ...page.fixtures].sort(byKickoff);
  let round: SeasonFixture[];
  if (anchor.round !== null) {
    round = all.filter((f) => sameRound(f, anchor));
  } else {
    const at = Date.parse(anchor.kickoff_at);
    round = all.filter((f) => {
      const t = Date.parse(f.kickoff_at);
      return state === 'next' ? t >= at && t - at < WEEK_MS : t <= at && at - t < WEEK_MS;
    });
  }
  const labels = stageNames(locale, anchor.stage?.name, anchor.round);
  return {
    label: anchor.round === null || labels.length === 0 ? null : labels.join(' · '),
    state,
    fixtures: round.slice(0, MATCHWEEK_LIMIT),
    more: Math.max(0, round.length - MATCHWEEK_LIMIT),
  };
}

export interface RoundGroup {
  key: string;
  /** The stage and round in the reader's words; null for one we cannot name (never the raw text). */
  label: string | null;
  fixtures: SeasonFixture[];
}

/**
 * Fixtures or results by round (T-1385), each round once, in the order the
 * list already has (soonest first for fixtures, latest first for results).
 * A round we cannot name is grouped by its stored text but headed by
 * nothing: the provider's wording never reaches the page (D-193).
 */
export function roundGroups(locale: string, fixtures: readonly SeasonFixture[]): RoundGroup[] {
  const groups = new Map<string, RoundGroup>();
  for (const f of fixtures) {
    const labels = stageNames(locale, f.stage?.name, f.round);
    const label = labels.length === 0 ? null : labels.join(' · ');
    const key = label ?? `?${f.stage?.id ?? ''}|${f.round ?? ''}`;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, { key, label, fixtures: [f] });
    else group.fixtures.push(f);
  }
  return [...groups.values()];
}

export interface LeagueNumbers {
  coverage: CoverageState;
  /** Finished matches with a score: what every figure is counted over. */
  counted: number;
  /** Finished matches stored without a score, left out of every figure. */
  unscored: number;
  /**
   * Finished qualifying matches, before the season's main competition (the
   * API's `qualifying`), left out of every figure and named (T-1394, D-209).
   */
  qualifying: number;
  goals: number;
  homeWins: number;
  draws: number;
  goalless: number;
}

/**
 * The season in figures (T-1385), counted from the stored results alone:
 * goals per match, home wins, draws and goalless draws. A finished match
 * with no score is left out and counted, so the figures say what they are
 * over (`limited`); no result with a score is `not_supplied`, never a row
 * of noughts.
 *
 * A cup's figures are its main competition's (T-1394, D-209): a qualifying
 * match is left out and counted apart, so "108 results" is not 18 of the
 * Champions League and 90 of its qualifying rounds read as one season.
 */
export function leagueNumbers(results: readonly SeasonFixture[]): LeagueNumbers {
  let counted = 0;
  let unscored = 0;
  let qualifying = 0;
  let goals = 0;
  let homeWins = 0;
  let draws = 0;
  let goalless = 0;
  for (const f of results) {
    if (f.status !== 'finished') continue;
    if (f.qualifying === true) {
      qualifying += 1;
      continue;
    }
    if (f.score === null) {
      unscored += 1;
      continue;
    }
    counted += 1;
    goals += f.score.home + f.score.away;
    if (f.score.home > f.score.away) homeWins += 1;
    if (f.score.home === f.score.away) {
      draws += 1;
      if (f.score.home === 0) goalless += 1;
    }
  }
  const coverage: CoverageState =
    counted === 0 ? 'not_supplied' : unscored > 0 ? 'limited' : 'available';
  return { coverage, counted, unscored, qualifying, goals, homeWins, draws, goalless };
}

/** The season's matches of its main competition: what the band counts as played (D-209). */
export function mainResults<T extends Pick<SeasonFixture, 'qualifying'>>(
  results: readonly T[],
): T[] {
  return results.filter((f) => f.qualifying !== true);
}

/** A share as a whole percentage in the locale's digits: "37%", «۳۷٪». */
export function sharePercent(locale: string, part: number, whole: number): string {
  if (whole === 0) return formatNumber(locale, 0);
  return new Intl.NumberFormat(intlLocale(locale), {
    style: 'percent',
    maximumFractionDigits: 0,
  }).format(part / whole);
}

/** Goals per match to two decimals, in the locale's digits: "1.75", «۱٫۷۵». */
export function perMatch(locale: string, total: number, matches: number): string {
  return new Intl.NumberFormat(intlLocale(locale), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(matches === 0 ? 0 : total / matches);
}

/**
 * A season label ("2026/27", "2026") in the locale's digits (D-193: Persian
 * digits everywhere on `/fa`). The label is ours (the season's own), so only
 * its digits change.
 */
export function seasonDigits(locale: string, label: string): string {
  return label.replace(/\d+/g, (digits) =>
    // Keep a leading zero ("2026/07") and never group a year ("2,026").
    digits
      .split('')
      .map((d) => formatNumber(locale, Number(d)))
      .join(''),
  );
}

/** The teams on the season's table, or null when it has no rows to count. */
export function clubCount(page: Pick<CompetitionPage, 'table'>): number | null {
  const rows = page.table.data ?? [];
  return rows.length === 0 ? null : rows.length;
}

// ---------------------------------------------------------------------------
// The day's matches (T-1498)
// ---------------------------------------------------------------------------

/** A calendar day in the reader's zone, `YYYY-MM-DD`. */
export function dayKey(iso: string, timeZone: string): string {
  // en-CA writes the ISO order; the digits are Latin whatever the page's locale.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

export interface MatchDay {
  /** `YYYY-MM-DD` in the reader's zone. */
  day: string;
  /** That day's matches by kick-off, played, playing or to come. */
  fixtures: SeasonFixture[];
}

/**
 * A scheduled match this long past its kick-off with no word from the feed
 * does not make its day "the next match day": it is late news, not the plan.
 */
const STALE_SCHEDULED_MS = 6 * 60 * 60 * 1000;

function sameDay(
  page: Pick<CompetitionPage, 'results' | 'fixtures'>,
  day: string,
  timeZone: string,
): SeasonFixture[] {
  return [...page.fixtures, ...page.results]
    .filter((f) => dayKey(f.kickoff_at, timeZone) === day)
    .sort(byKickoff);
}

/**
 * The Overview's day of matches (T-1498): the day, in the reader's zone, of
 * the first match being played or still to come, with every match of the
 * competition that day, finished ones included. Null when the season has
 * nothing left to play: the page says so rather than showing an old day.
 */
export function nextMatchDay(
  page: Pick<CompetitionPage, 'results' | 'fixtures'>,
  timeZone: string,
  now: number,
): MatchDay | null {
  const first = [...page.fixtures]
    .filter(
      (f) =>
        f.status === 'live' ||
        (f.status === 'scheduled' && Date.parse(f.kickoff_at) > now - STALE_SCHEDULED_MS),
    )
    .sort(byKickoff)[0];
  if (first === undefined) return null;
  const day = dayKey(first.kickoff_at, timeZone);
  return { day, fixtures: sameDay(page, day, timeZone) };
}

/**
 * The latest day with a result before `before` (the Overview's match day,
 * whose own results it already shows), in the reader's zone; null with none.
 */
export function lastResultDay(
  page: Pick<CompetitionPage, 'results' | 'fixtures'>,
  timeZone: string,
  before: string | null,
): MatchDay | null {
  const days = page.results
    .filter((f) => f.status === 'finished')
    .map((f) => dayKey(f.kickoff_at, timeZone))
    .filter((d) => before === null || d < before)
    .sort();
  const day = days[days.length - 1];
  if (day === undefined) return null;
  return {
    day,
    fixtures: sameDay(page, day, timeZone).filter((f) => f.status === 'finished'),
  };
}

// ---------------------------------------------------------------------------
// The season round by round (T-1636, D-298)
// ---------------------------------------------------------------------------

export interface SeasonRound {
  /**
   * Its place in the season's order of rounds, from 1: the page's `round`
   * parameter, so a round can be linked ("?round=9").
   */
  number: number;
  /** The stage and round in the reader's words; null when we cannot name it (D-193). */
  label: string | null;
  /** Its first and last kick-off: the dates that stand in for a label we do not have. */
  first: string;
  last: string;
  /** Every match of it, played, playing or to come, by kick-off. */
  fixtures: SeasonFixture[];
}

/**
 * The season's rounds, in the order they are played (T-1636): every match
 * stored for the season, results and fixtures alike, grouped by the round
 * the provider gives it within its stage (T-1391), each round once, ordered
 * by its first kick-off. A cup's two legs share their round; a group stage's
 * matchday is one round across its groups; a qualifying round is its own. A
 * match stored without a round is grouped by its day in the reader's zone
 * instead, so nothing is left out and nothing is guessed. A match moved to
 * another date stays in its round.
 */
export function seasonRounds(
  locale: string,
  page: Pick<CompetitionPage, 'results' | 'fixtures'>,
  timeZone: string,
): SeasonRound[] {
  const groups = new Map<string, SeasonFixture[]>();
  for (const f of [...page.results, ...page.fixtures].sort(byKickoff)) {
    const key =
      f.round === null
        ? `day|${dayKey(f.kickoff_at, timeZone)}`
        : `round|${f.stage?.id ?? ''}|${f.round}`;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [f]);
    else group.push(f);
  }
  // A Map keeps the order its keys arrived in: each round's first kick-off.
  return [...groups.values()].map((fixtures, index) => {
    const anchor = fixtures[0]!;
    const labels =
      anchor.round === null ? [] : stageNames(locale, anchor.stage?.name, anchor.round);
    return {
      number: index + 1,
      label: labels.length === 0 ? null : labels.join(' · '),
      first: anchor.kickoff_at,
      last: fixtures[fixtures.length - 1]!.kickoff_at,
      fixtures,
    };
  });
}

/**
 * The round the page opens on (T-1636), as the season's figures name it: the
 * one a match is being played in; else the one whose match comes next (a
 * match marked to come hours after its kick-off is late news, not the plan,
 * as for the next match day); else the last round with a result. A round of
 * postponed matches alone never sets it. Null for a season with no match.
 */
export function defaultRound(rounds: readonly SeasonRound[], now: number): SeasonRound | null {
  const live = rounds.find((r) => r.fixtures.some((f) => f.status === 'live'));
  if (live !== undefined) return live;
  let next: { round: SeasonRound; at: number } | null = null;
  let played: { round: SeasonRound; at: number } | null = null;
  for (const round of rounds) {
    for (const f of round.fixtures) {
      const at = Date.parse(f.kickoff_at);
      if (f.status === 'scheduled' && at > now - STALE_SCHEDULED_MS) {
        if (next === null || at < next.at) next = { round, at };
      }
      if (f.status === 'finished' && (played === null || at > played.at)) played = { round, at };
    }
  }
  return next?.round ?? played?.round ?? rounds[0] ?? null;
}

/** `?round=`: a round's number in this season; anything else (or nothing) is the page's own. */
export function readRoundParam(params: SearchParams, count: number): number | null {
  const raw = (Array.isArray(params.round) ? params.round[0] : params.round) ?? '';
  if (!/^[1-9][0-9]{0,3}$/.test(raw)) return null;
  const n = Number(raw);
  return n <= count ? n : null;
}

/**
 * A round's address on the Overview, keeping the season, and opening at the
 * card (`#match-day`) when the page is loaded from it; inside the page the
 * picker's links keep the scroll where it is.
 */
export function roundHref(
  locale: string,
  competitionId: string,
  season: Pick<SeasonSummary, 'id' | 'is_current'>,
  round: number,
): string {
  const base = tabHref(locale, competitionId, season, 'overview');
  return `${base}${base.includes('?') ? '&' : '?'}round=${round}#match-day`;
}

/** A round's matches by day in the reader's zone, each day once, in kick-off order. */
export function roundDays(round: SeasonRound, timeZone: string): MatchDay[] {
  const days: MatchDay[] = [];
  for (const f of round.fixtures) {
    const day = dayKey(f.kickoff_at, timeZone);
    const last = days[days.length - 1];
    if (last !== undefined && last.day === day) last.fixtures.push(f);
    else days.push({ day, fixtures: [f] });
  }
  return days;
}

// ---------------------------------------------------------------------------
// The model in this league (T-1498)
// ---------------------------------------------------------------------------

/**
 * How the statistical model's published pre-kick-off forecasts have scored
 * in this competition (`GET /model/accuracy`, T-1369): only the model, never
 * the founder's analysis or the community (rule 6). `unreachable`: the
 * answer did not come; `not_supplied`: nothing in this league is scored yet,
 * or the model has not forecast it -- no figure is shown (rule 3).
 */
export type LeagueModel =
  | { state: 'unreachable' }
  | { state: 'not_supplied' }
  | {
      state: 'scored';
      /** The newest month with a scored match. */
      latest: AccuracyPoint;
      /** Every month with a scored match, newest first. */
      months: AccuracyPoint[];
      total: AccuracyMetrics;
      modelVersions: string[];
      lastUpdatedAt: string | null;
    };

export function leagueModel(
  answer: PublicModelAccuracyResponse | null,
  competitionId: string,
  /** The season on the page: only its months count (T-1556, D-278). */
  season?: Pick<SeasonSummary, 'start_date' | 'end_date'>,
): LeagueModel {
  if (answer === null) return { state: 'unreachable' };
  const series = answer.competitions.find((s) => s.competition?.id === competitionId);
  const points = series?.points ?? [];
  const inSeason =
    season === undefined ? points : points.filter((p) => monthInSeason(p.period_start, season));
  const months = inSeason.filter((p) => p.coverage !== 'not_supplied' && p.matches > 0).reverse();
  const latest = months[0];
  if (series === undefined || latest === undefined) return { state: 'not_supplied' };
  return {
    state: 'scored',
    latest,
    months,
    // Every month is the season's: the API's own total stands. Otherwise
    // the season's months are summed here, each figure weighted by matches.
    total: inSeason.length === points.length ? series.total : monthsTotal(months),
    modelVersions: series.model_versions,
    lastUpdatedAt: answer.last_updated_at,
  };
}

/**
 * Whether a month (`YYYY-MM-01`) shares a day with the season. A month that
 * straddles two seasons counts on both pages: the record is kept by month.
 */
export function monthInSeason(
  periodStart: string,
  season: Pick<SeasonSummary, 'start_date' | 'end_date'>,
): boolean {
  const first = periodStart.slice(0, 10);
  // Lexical comparison of ISO dates; "-31" is past every month's last day.
  const last = `${periodStart.slice(0, 7)}-31`;
  return first <= season.end_date.slice(0, 10) && last >= season.start_date.slice(0, 10);
}

/**
 * Several months as one row: the matches and forecasts added up, every
 * figure the average over the matches (each month's figure weighted by its
 * matches, which is exact: a match is scored in one month only), and the
 * coverage read from the matches as the API reads it.
 */
export function monthsTotal(months: readonly AccuracyMetrics[]): AccuracyMetrics {
  const matches = months.reduce((sum, m) => sum + m.matches, 0);
  const mean = (pick: (m: AccuracyMetrics) => number | null): number | null => {
    let weight = 0;
    let sum = 0;
    for (const m of months) {
      const value = pick(m);
      if (value === null || m.matches === 0) continue;
      weight += m.matches;
      sum += value * m.matches;
    }
    return weight === 0 ? null : sum / weight;
  };
  return {
    forecasts: months.reduce((sum, m) => sum + m.forecasts, 0),
    matches,
    coverage:
      matches === 0 ? 'not_supplied' : matches < ACCURACY_MINIMUM_MATCHES ? 'limited' : 'available',
    log_loss: mean((m) => m.log_loss),
    brier: mean((m) => m.brier),
    rps: mean((m) => m.rps),
    accuracy: mean((m) => m.accuracy),
    uniform_rps: mean((m) => m.uniform_rps),
  };
}
