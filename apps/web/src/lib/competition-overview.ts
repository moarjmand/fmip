import type { CompetitionPage, CoverageState, SeasonFixture, SeasonSummary } from '@fmip/contracts';
import { formatNumber, intlLocale } from '@/i18n/format';
import { competitionQuery, stageNames } from '@/lib/competition';

/**
 * The Hybrid competition page's pure helpers (T-1385, D-203): which tab the
 * URL opens, the links that keep the season, the round the Overview calls
 * "this matchweek", fixtures grouped by round, and the league's figures
 * counted from its stored results. Nothing here asks the API.
 */

type SearchParams = Record<string, string | string[] | undefined>;

/** The page's sections, in the order the tab bar shows them. */
export const COMPETITION_TABS = [
  'overview',
  'table',
  'fixtures',
  'results',
  'players',
  'stats',
] as const;
export type CompetitionTab = (typeof COMPETITION_TABS)[number];

/** `?tab=`: one of the page's sections; anything else (or nothing) is the Overview. */
export function readTabParam(params: SearchParams): CompetitionTab {
  const raw = Array.isArray(params.tab) ? params.tab[0] : params.tab;
  return (COMPETITION_TABS as readonly string[]).includes(raw ?? '')
    ? (raw as CompetitionTab)
    : 'overview';
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
 */
export function leagueNumbers(results: readonly SeasonFixture[]): LeagueNumbers {
  let counted = 0;
  let unscored = 0;
  let goals = 0;
  let homeWins = 0;
  let draws = 0;
  let goalless = 0;
  for (const f of results) {
    if (f.status !== 'finished') continue;
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
  return { coverage, counted, unscored, goals, homeWins, draws, goalless };
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
