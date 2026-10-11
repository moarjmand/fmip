import {
  PANEL_LATEST_BATCH,
  type AccuracyMetrics,
  type MatchViewing,
  type NewsStoryCard,
  type PanelLatest,
  type PublicModelAccuracyResponse,
  type ScoreCard,
  type ScoresGroup,
  type ScoresResponse,
  type TableRow,
  type ViewingOption,
} from '@fmip/contracts';
import { formatDate } from '@/i18n/format';
import { dateIn } from './scores';
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
/** How many table rows the side column shows: the top five. */
export const HOME_TABLE_ROWS = 5;
/** How many competitions "Today's key matches" lists before "All competitions". */
export const KEY_GROUPS = 10;
/** How many matches of one competition it lists before "N more". */
export const KEY_ROWS = 6;
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
 * The day's biggest match, for the lead slot (D-200): the first day from
 * today with a match still to be played or in play, and on it the teams a
 * member follows first, then a match an editor features (D-153), then the
 * competitions' stated order (D-154, the answer's group order), then the
 * earliest kick-off. Finished and called-off matches never lead; with none
 * open in the two weeks there is no lead match.
 */
export function leadMatch(
  scores: ScoresResponse,
  today: string,
  timeZone: string,
  followedTeams: ReadonlySet<string> = new Set(),
  featured: ReadonlySet<string> = new Set(),
): ScoreCard | null {
  const order = new Map(scores.groups.map((group, index) => [group.competition.id, index]));
  const open = allCards(scores).filter(
    (card) => OPEN.has(card.status) && dayOf(card, timeZone) >= today,
  );
  const day = open.map((card) => dayOf(card, timeZone)).sort()[0];
  if (day === undefined) return null;
  const tier = (card: ScoreCard) =>
    involves(card, followedTeams) ? 0 : featured.has(card.id) ? 1 : 2;
  return (
    open
      .filter((card) => dayOf(card, timeZone) === day)
      .sort(
        (a, b) =>
          tier(a) - tier(b) ||
          (order.get(a.competition.id) ?? order.size) -
            (order.get(b.competition.id) ?? order.size) ||
          a.kickoff_at.localeCompare(b.kickoff_at) ||
          a.id.localeCompare(b.id),
      )[0] ?? null
  );
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

/** How many competitions play on `day`: the "All N competitions" link's number. */
export function competitionsOn(scores: ScoresResponse, day: string, timeZone: string): number {
  return new Set(
    allCards(scores)
      .filter((card) => dayOf(card, timeZone) === day)
      .map((card) => card.competition.id),
  ).size;
}

/** A team's row in a league table, for the lead card's "1st of 16 · 16 pts"; `null` when absent. */
export function tableRowOf(rows: readonly TableRow[] | null, teamId: string): TableRow | null {
  return rows?.find((row) => row.team.id === teamId) ?? null;
}

/**
 * The lead story (D-200): the newest story an editor has marked breaking and
 * whose mark is still in force (D-125). The API has no "lead" or "featured"
 * story of its own; the breaking mark is the one editorial act that puts a
 * story at the top, and it ends by itself. The rest stay in the strip.
 */
export function leadStory(stories: readonly NewsStoryCard[] | null): {
  lead: NewsStoryCard | null;
  rest: NewsStoryCard[];
} {
  const marked = (stories ?? []).filter((story) => story.breaking !== null);
  const lead =
    [...marked].sort((a, b) =>
      (b.breaking?.marked_at ?? '').localeCompare(a.breaking?.marked_at ?? ''),
    )[0] ?? null;
  return { lead, rest: marked.filter((story) => story !== lead) };
}

/**
 * The public accuracy figure the side column shows (T-1369, D-187): the
 * newest month of the overall series with at least one match scored. The
 * public answer is by calendar month only, so the home says which month
 * rather than "last week" (rule 3). `null`: nothing scored yet.
 */
export interface AccuracyFigure {
  /** `YYYY-MM`. */
  period: string;
  metrics: AccuracyMetrics;
  modelVersions: string[];
  lastUpdatedAt: string | null;
}

export function accuracyFigure(answer: PublicModelAccuracyResponse): AccuracyFigure | null {
  const point = [...answer.overall.points]
    .reverse()
    .find((p) => p.coverage !== 'not_supplied' && p.rps !== null);
  if (point === undefined) return null;
  return {
    period: point.period,
    metrics: point,
    modelVersions: answer.overall.model_versions,
    lastUpdatedAt: answer.last_updated_at,
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
