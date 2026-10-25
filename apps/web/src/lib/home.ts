import {
  PANEL_LATEST_BATCH,
  type AccuracyMetrics,
  type AccuracyPeriod,
  type ForecastVersion,
  type MatchViewing,
  type ModelLeadingFactor,
  type PanelLatest,
  type PublicModelAccuracyResponse,
  type ScoreCard,
  type ScoresGroup,
  type ScoresResponse,
  type TableRow,
  type ViewingOption,
} from '@fmip/contracts';
import { formatDate } from '@/i18n/format';
import { dateIn, shiftDate } from './scores';
import { optionsState } from './viewing';

/**
 * What the homepage shows (blueprint 2.3, T-526; the Hybrid front page,
 * T-1382, D-200), chosen from answers the product already gives. Pure, so
 * the choices are tested without a page.
 *
 * The scores answer is asked for **without** the session (D-200): its groups
 * then come in the competitions' stated order (D-154) -- the Pro League
 * first, then the Champions League and the big leagues -- and a member's own
 * teams are lifted here, from the teams they follow, rather than by the
 * answer's pinning, which also lifts favourite competitions.
 */

/**
 * How many days ahead the homepage looks: two weeks, the most one scores
 * request may span, so the first matches after an international break are
 * already on it (T-505 keeps the season's schedule).
 */
export const HOME_DAYS = 14;
/** How many table rows the side column shows: the top six (T-1516). */
export const HOME_TABLE_ROWS = 6;
/** How many competitions the model's month lists, the most accurate first. */
export const HOME_MONTH_LEAGUES = 6;
/** How many competitions "today by competition" lists before "All N matches". */
export const KEY_GROUPS = 6;
/** How many matches of one competition it lists before "N more". */
export const KEY_ROWS = 4;
/** How many followed teams "My teams" asks about (one team page each). */
export const HOME_MY_TEAMS = 4;
/** How many stories the news grid shows. */
export const HOME_STORIES = 6;

const OPEN: ReadonlySet<ScoreCard['status']> = new Set(['live', 'scheduled']);

/** Every card of the answer, each once, pinned first, then the groups in their order. */
export function allCards(scores: ScoresResponse): ScoreCard[] {
  const seen = new Set<string>();
  const out: ScoreCard[] = [];
  for (const card of [...scores.pinned, ...scores.groups.flatMap((group) => group.fixtures)]) {
    if (seen.has(card.id)) continue;
    seen.add(card.id);
    out.push(card);
  }
  return out;
}

/** The day a kick-off falls on in the reader's zone. */
const dayOf = (card: ScoreCard, timeZone: string): string =>
  dateIn(timeZone, new Date(card.kickoff_at));

/**
 * The day "key matches" are of: today when anything is played today, else
 * the first day after it that has a match (an international break, a quiet
 * Monday), else `null` -- nothing in the two weeks, which the page says.
 */
export function keyDay(scores: ScoresResponse, today: string, timeZone: string): string | null {
  const days = allCards(scores)
    .map((card) => dayOf(card, timeZone))
    .filter((day) => day >= today)
    .sort();
  return days[0] ?? null;
}

/**
 * The editor's note per featured match (T-1161, D-153), from
 * `GET /featured-matches`. An unreachable answer is no features: the homepage
 * is then as it was before T-1161, which is a true page, not a false one.
 */
export function featuredNotes(
  features: readonly { fixture_id: string; note: string }[] | null,
): Map<string, string> {
  return new Map((features ?? []).map((feature) => [feature.fixture_id, feature.note]));
}

/** The competition whose table the homepage shows: the first one in the answer's order. */
export function tableCompetition(scores: ScoresResponse): string | null {
  return scores.pinned[0]?.competition.id ?? scores.groups[0]?.competition.id ?? null;
}

const involves = (card: ScoreCard, teams: ReadonlySet<string>): boolean =>
  teams.has(card.home.id) || teams.has(card.away.id);

/**
 * How many competitions, in the answer's order (D-154), hold the big matches
 * when nobody follows a team in it and no editor features one: the Pro
 * League, the Champions League and the big leagues come first in that order.
 */
export const BIG_COMPETITIONS = 6;

/** Where the hero's match stands: in play, or the next big one and on which day. */
export type HeroSlot = 'live' | 'today' | 'tomorrow' | 'later';

export interface HeroMatch {
  card: ScoreCard;
  slot: HeroSlot;
}

/**
 * The big match the home opens on (D-263 point 4, D-270): a big match in play
 * takes the slot; when none is, the next big one. A match is big when it is a
 * followed team's (a member's own), one an editor features (D-153), or one of
 * the first `BIG_COMPETITIONS` competitions in the answer's order (D-154),
 * ranked in that order. The next big one is looked for today and tomorrow,
 * else on the first day with a match; there the tier ranks first, then the
 * day, the competitions' order and the earliest kick-off. A live match ranks
 * before a scheduled one of its tier, never before a bigger one. Finished and
 * called-off matches never lead; with nothing open there is no hero.
 */
export function heroMatch(
  scores: ScoresResponse,
  today: string,
  timeZone: string,
  followedTeams: ReadonlySet<string> = new Set(),
  featured: ReadonlySet<string> = new Set(),
  big = BIG_COMPETITIONS,
): HeroMatch | null {
  const order = new Map(scores.groups.map((group, index) => [group.competition.id, index]));
  const rank = (card: ScoreCard) => order.get(card.competition.id) ?? order.size;
  const tier = (card: ScoreCard) =>
    involves(card, followedTeams) ? 0 : featured.has(card.id) ? 1 : rank(card) < big ? 2 : 3;
  const cards = allCards(scores);
  const live = cards.filter((card) => card.status === 'live' && tier(card) < 3);
  const scheduled = cards.filter(
    (card) => card.status === 'scheduled' && dayOf(card, timeZone) >= today,
  );
  const days = [...new Set(scheduled.map((card) => dayOf(card, timeZone)))].sort();
  const soon = days.filter((day) => day <= shiftDate(today, 1));
  const window = new Set(soon.length > 0 ? soon : days.slice(0, 1));
  const [best] = [...live, ...scheduled.filter((card) => window.has(dayOf(card, timeZone)))].sort(
    (a, b) =>
      tier(a) - tier(b) ||
      Number(b.status === 'live') - Number(a.status === 'live') ||
      dayOf(a, timeZone).localeCompare(dayOf(b, timeZone)) ||
      rank(a) - rank(b) ||
      a.kickoff_at.localeCompare(b.kickoff_at) ||
      a.id.localeCompare(b.id),
  );
  if (best === undefined) return null;
  const day = dayOf(best, timeZone);
  const slot: HeroSlot =
    best.status === 'live'
      ? 'live'
      : day === today
        ? 'today'
        : day === shiftDate(today, 1)
          ? 'tomorrow'
          : 'later';
  return { card: best, slot };
}

/** How many live matches the strip shows before "all live matches". */
export const LIVE_STRIP = 8;

/** Every match in play, in the competitions' order (D-154), then by kick-off. */
export function liveCards(scores: ScoresResponse): ScoreCard[] {
  const order = new Map(scores.groups.map((group, index) => [group.competition.id, index]));
  return allCards(scores)
    .filter((card) => card.status === 'live')
    .sort(
      (a, b) =>
        (order.get(a.competition.id) ?? order.size) - (order.get(b.competition.id) ?? order.size) ||
        a.kickoff_at.localeCompare(b.kickoff_at) ||
        a.id.localeCompare(b.id),
    );
}

/**
 * When the live answer was last heard from: the newest of the live matches'
 * provider answers, else of their last changes (rule 4). `null` with none.
 */
export function liveCheckedAt(cards: readonly ScoreCard[]): string | null {
  return (
    cards
      .map((card) => card.live_answered_at ?? card.last_updated_at)
      .sort((a, b) => b.localeCompare(a))[0] ?? null
  );
}

/**
 * The version the hero reads its figures from: the match's last version
 * computed before kick-off, the one the bar shows and the evaluation scores
 * (D-031), never a later one. `null` when none was.
 */
export function heroVersion(
  versions: readonly ForecastVersion[] | null,
  kickoffAt: string,
): ForecastVersion | null {
  return (
    [...(versions ?? [])]
      .filter((version) => version.computed_at < kickoffAt)
      .sort((a, b) => b.version_number - a.version_number)[0] ?? null
  );
}

/** The factors that moved a version most, by size, at most `limit`. */
export function topFactors(version: ForecastVersion, limit = 3): ModelLeadingFactor[] {
  return [...(version.leading_factors ?? [])]
    .sort((a, b) => Math.abs(b.magnitude) - Math.abs(a.magnitude))
    .slice(0, limit);
}

/** The round every match of a group shares, for its heading; `null` when they differ or have none. */
export function sharedRound(cards: readonly ScoreCard[]): string | null {
  const rounds = new Set(cards.map((card) => card.round));
  const [round] = rounds;
  return rounds.size === 1 && round !== undefined ? round : null;
}

export interface KeyGroup {
  /** `yours`: the member's own teams' matches, before every competition. */
  kind: 'yours' | 'competition';
  competition: ScoresGroup['competition'] | null;
  /** In kick-off order, at most `KEY_ROWS`. */
  cards: ScoreCard[];
  /** How many more of this group's matches that day are on the scores page. */
  more: number;
}

/**
 * "Today's key matches" (D-200): every match of `day`, grouped by competition
 * in the answer's order (D-154), with a member's own teams' matches first in
 * a group of their own (each match listed once). At most `KEY_GROUPS`
 * competitions and `KEY_ROWS` matches each; what is left out is counted, and
 * the scores page has it.
 */
export function keyMatchGroups(
  scores: ScoresResponse,
  day: string,
  timeZone: string,
  followedTeams: ReadonlySet<string> = new Set(),
  limits: { groups: number; rows: number } = { groups: KEY_GROUPS, rows: KEY_ROWS },
): KeyGroup[] {
  const byKickoff = (a: ScoreCard, b: ScoreCard) =>
    a.kickoff_at.localeCompare(b.kickoff_at) || a.id.localeCompare(b.id);
  const cards = allCards(scores).filter((card) => dayOf(card, timeZone) === day);
  const yours = cards.filter((card) => involves(card, followedTeams)).sort(byKickoff);
  const groups = new Map<string, KeyGroup & { all: ScoreCard[] }>();
  for (const card of cards) {
    if (involves(card, followedTeams)) continue;
    const group = groups.get(card.competition.id) ?? {
      kind: 'competition' as const,
      competition: {
        id: card.competition.id,
        name: card.competition.name,
        short_name: card.competition.short_name,
        ...(card.competition.logo === undefined ? {} : { logo: card.competition.logo }),
      },
      cards: [],
      more: 0,
      all: [],
    };
    group.all.push(card);
    groups.set(card.competition.id, group);
  }
  const cut = (all: ScoreCard[]) => {
    const sorted = [...all].sort(byKickoff);
    return { cards: sorted.slice(0, limits.rows), more: Math.max(sorted.length - limits.rows, 0) };
  };
  const out: KeyGroup[] = [];
  if (yours.length > 0) out.push({ kind: 'yours', competition: null, ...cut(yours) });
  for (const { all, ...group } of [...groups.values()].slice(0, limits.groups)) {
    out.push({ ...group, ...cut(all) });
  }
  return out;
}

/** How many matches are played on `day`: the "All N matches" link's number. */
export function matchesOn(scores: ScoresResponse, day: string, timeZone: string): number {
  return allCards(scores).filter((card) => dayOf(card, timeZone) === day).length;
}

/** A team's row in a league table, for the lead card's "1st of 16 · 16 pts"; `null` when absent. */
export function tableRowOf(rows: readonly TableRow[] | null, teamId: string): TableRow | null {
  return rows?.find((row) => row.team.id === teamId) ?? null;
}

/**
 * The public accuracy figure the side column shows (T-1369, D-187): the
 * newest month of the overall series with at least one match scored. The
 * public answer is by calendar month only, so the home says which month
 * rather than "last week" (rule 3). `null`: nothing scored yet.
 */
export interface AccuracyFigure {
  /** `YYYY-MM` for a month, `YYYY-Www` for an ISO week. */
  period: string;
  /** What `period` is (T-1414): the home asks for weeks. */
  periodKind: AccuracyPeriod;
  /** The period's first day, `YYYY-MM-DD` (UTC): a week's Monday. */
  periodStart: string;
  metrics: AccuracyMetrics;
  modelVersions: string[];
  lastUpdatedAt: string | null;
  /**
   * Each competition's figures for the same period (T-1516), the favourite
   * winning most often first, at most `HOME_MONTH_LEAGUES`; one with no match
   * scored in it is left out, not shown as nought.
   */
  competitions: { id: string; name: string; metrics: AccuracyMetrics }[];
  /** Below this many matches a figure is `limited` (`ACCURACY_MINIMUM_MATCHES`). */
  minimumMatches: number;
}

export function accuracyFigure(answer: PublicModelAccuracyResponse): AccuracyFigure | null {
  const point = [...answer.overall.points]
    .reverse()
    .find((p) => p.coverage !== 'not_supplied' && p.rps !== null);
  if (point === undefined) return null;
  const competitions = answer.competitions
    .flatMap((series) => {
      const same = series.points.find((p) => p.period === point.period);
      return series.competition === null || same === undefined || same.accuracy === null
        ? []
        : [{ id: series.competition.id, name: series.competition.name, metrics: same }];
    })
    .sort(
      (a, b) =>
        (b.metrics.accuracy ?? 0) - (a.metrics.accuracy ?? 0) ||
        b.metrics.matches - a.metrics.matches ||
        a.name.localeCompare(b.name),
    )
    .slice(0, HOME_MONTH_LEAGUES);
  return {
    period: point.period,
    periodKind: answer.period,
    periodStart: point.period_start,
    metrics: point,
    modelVersions: answer.overall.model_versions,
    lastUpdatedAt: answer.last_updated_at,
    competitions,
    minimumMatches: answer.minimum_matches,
  };
}

/**
 * Today's live broadcasts (D-200), from one viewing request for the day's
 * matches in the reader's territory: the matches still to be played or in
 * play with at least one listing, by kick-off, each with its broadcasters;
 * the listings' sources by name and the newest check, said under the list
 * (rule 4). A listing is never inferred: no territory is an ask, no source
 * is "not supplied", and a source that lists nothing is "nothing listed".
 */
export type HomeBroadcasts =
  | { state: 'unreachable' }
  | { state: 'ask' }
  | {
      state: 'listed';
      territory: string;
      rows: { card: ScoreCard; options: ViewingOption[] }[];
      sources: string[];
      checkedAt: string | null;
    }
  /** The territory is chosen and no open match today has a listing. `supplied`: a source covers it. */
  | { state: 'none'; territory: string; supplied: boolean };

export function homeBroadcasts(
  cards: readonly ScoreCard[],
  viewing: readonly MatchViewing[] | null,
  territoryName: (code: { code: string; name: string }) => string,
): HomeBroadcasts {
  if (viewing === null) return { state: 'unreachable' };
  const chosen = viewing.find((entry) => entry.territory.state === 'chosen');
  if (chosen === undefined || chosen.territory.state !== 'chosen') return { state: 'ask' };
  const territory = territoryName(chosen.territory.territory);
  const byId = new Map(viewing.map((entry) => [entry.fixture_id, entry]));
  const rows: { card: ScoreCard; options: ViewingOption[] }[] = [];
  let supplied = false;
  for (const card of [...cards].sort((a, b) => a.kickoff_at.localeCompare(b.kickoff_at))) {
    if (!OPEN.has(card.status)) continue;
    const entry = byId.get(card.id);
    if (entry === undefined) continue;
    const state = optionsState(entry);
    if (state !== 'not_supplied' && state !== 'ask') supplied = true;
    if (state === 'listed' && entry.options.data !== null) {
      rows.push({ card, options: entry.options.data });
    }
  }
  if (rows.length === 0) return { state: 'none', territory, supplied };
  const options = rows.flatMap((row) => row.options);
  const checkedAt =
    options.map((option) => option.last_updated_at).sort((a, b) => b.localeCompare(a))[0] ?? null;
  return {
    state: 'listed',
    territory,
    rows,
    sources: [...new Set(options.map((option) => option.source.name))],
    checkedAt,
  };
}

/**
 * "4 Oct" in the reader's zone, beside a kick-off time in the same zone, in
 * the page's language (T-1302): "۱۳ مهر" on `/fa`.
 */
export function shortDay(locale: string, iso: string, timeZone: string): string {
  return formatDate(locale, iso, timeZone, { day: 'numeric', month: 'short' });
}

// ---------------------------------------------------------------------------
// The member's homepage (T-942, D-115)
// ---------------------------------------------------------------------------

/** How many of today's panels the homepage shows posts from. */
export const HOME_PANELS = 3;

/**
 * Today's matches in the reader's zone, for "on today's panels" and the
 * broadcasts: every match of the scores answer that kicks off on `today`,
 * whatever its state, at most one panel batch. Pinned first, as the scores
 * answer orders them.
 */
export function todayFixtureIds(scores: ScoresResponse, today: string, timeZone: string): string[] {
  const ids = [...scores.pinned, ...scores.groups.flatMap((group) => group.fixtures)]
    .filter((card) => dateIn(timeZone, new Date(card.kickoff_at)) === today)
    .map((card) => card.id);
  return [...new Set(ids)].slice(0, PANEL_LATEST_BATCH);
}

/**
 * The panels worth a line on the homepage: those with a post that stands,
 * the most recently written-on first. A panel with nothing in it is not
 * listed; the section says once that nothing was posted.
 */
export function homePanels(panels: PanelLatest[], limit = HOME_PANELS): PanelLatest[] {
  return panels
    .filter((panel) => panel.posts.length > 0)
    .sort((a, b) => (b.posts[0]?.created_at ?? '').localeCompare(a.posts[0]?.created_at ?? ''))
    .slice(0, limit);
}
