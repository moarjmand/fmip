import {
  PANEL_LATEST_BATCH,
  type ForecastListEntry,
  type MatchViewing,
  type ModelProbabilities,
  type PanelLatest,
  type ScoreCard,
  type ScoresResponse,
} from '@fmip/contracts';
import { percentages } from './forecast';
import { dateIn } from './scores';
import { type CardViewing, cardViewing } from './score-card-products';

/**
 * What the homepage shows (blueprint 2.3, T-526), chosen from answers the
 * product already gives. Pure, so the choices are tested without a page.
 *
 * The scores answer is already ordered the way a reader should meet it: a
 * member's favourites pinned, then the competitions they follow, then each
 * competition's stated place (T-504). The homepage keeps that order rather
 * than inventing another, and takes its table from the first competition in
 * it -- a guest sees the most prominent competition playing soon, a member one
 * they follow.
 */

/**
 * How many days ahead the homepage looks: two weeks, the most one scores
 * request may span, so the first matches after an international break are
 * already on it (T-505 keeps the season's schedule).
 */
export const HOME_DAYS = 14;
/** How many matches the homepage lists before "All scores". */
export const HOME_MATCHES = 8;
/** How many of those it shows the model's forecast for. */
export const HOME_FORECASTS = 4;
/** How many table rows it shows. */
export const HOME_TABLE_ROWS = 6;

const OPEN: ReadonlySet<ScoreCard['status']> = new Set(['live', 'scheduled']);

/**
 * Live and upcoming matches, favourites first: the pinned cards, then every
 * other live match, then the soonest scheduled ones. A finished or called-off
 * match is not "live and upcoming" and is left to the scores page.
 */
export function homeMatches(scores: ScoresResponse, limit = HOME_MATCHES): ScoreCard[] {
  const pinned = scores.pinned.filter((card) => OPEN.has(card.status));
  const seen = new Set(pinned.map((card) => card.id));
  const rest = scores.groups
    .flatMap((group) => group.fixtures)
    .filter((card) => OPEN.has(card.status) && !seen.has(card.id));
  const live = rest.filter((card) => card.status === 'live');
  const upcoming = rest
    .filter((card) => card.status === 'scheduled')
    .sort((a, b) => a.kickoff_at.localeCompare(b.kickoff_at));
  return [...pinned, ...live, ...upcoming].slice(0, limit);
}

/** The competition whose table the homepage shows: the first one in the reader's order. */
export function tableCompetition(scores: ScoresResponse): string | null {
  return scores.pinned[0]?.competition.id ?? scores.groups[0]?.competition.id ?? null;
}

export interface HomeForecast {
  card: ScoreCard;
  /** Percentages totalling 100, as the match centre shows them. */
  percent: ModelProbabilities;
  modelVersion: string;
}

/**
 * The statistical model's view of the first upcoming matches that have one
 * (blueprint 2.3, "important-match model forecasts"). Only available versions,
 * each named as the model's; a match with no forecast is simply not listed.
 */
export function homeForecasts(
  cards: ScoreCard[],
  entries: ForecastListEntry[],
  limit = HOME_FORECASTS,
): HomeForecast[] {
  const byFixture = new Map(entries.map((entry) => [entry.fixture_id, entry.latest]));
  return cards
    .filter((card) => card.status === 'scheduled')
    .flatMap((card) => {
      const latest = byFixture.get(card.id);
      return latest?.status === 'available' && latest.probabilities !== null
        ? [
            {
              card,
              percent: percentages(latest.probabilities),
              modelVersion: latest.model_version,
            },
          ]
        : [];
    })
    .slice(0, limit);
}

/** "4 Oct" in the reader's zone, beside a kick-off time in the same zone. */
export function shortDay(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone }).format(
    new Date(iso),
  );
}

// ---------------------------------------------------------------------------
// The member's homepage (T-942, D-115)
// ---------------------------------------------------------------------------

/** How many of today's panels the homepage shows posts from. */
export const HOME_PANELS = 3;

/**
 * Today's matches in the reader's zone, for "on today's panels": every match
 * of the scores answer that kicks off on `today`, whatever its state, at most
 * one panel batch. Pinned first, as the scores answer orders them.
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

/**
 * Where each listed match can be watched, for a member (T-942): the scores
 * card's line per match (D-114), or -- when no territory is chosen, which is
 * true of every match at once -- a single `ask` instead of the same question
 * on every line. `null` means the viewing answer could not be had.
 */
export type HomeViewing =
  | { state: 'ask' }
  | { state: 'unreachable' }
  | { state: 'lines'; byFixture: Map<string, CardViewing> };

export function homeViewing(cards: ScoreCard[], viewing: MatchViewing[] | null): HomeViewing {
  if (viewing === null) return { state: 'unreachable' };
  const byId = new Map(viewing.map((entry) => [entry.fixture_id, entry]));
  const lines = new Map(cards.map((card) => [card.id, cardViewing(byId.get(card.id))]));
  if ([...lines.values()].every((line) => line.state === 'ask')) return { state: 'ask' };
  return { state: 'lines', byFixture: lines };
}
