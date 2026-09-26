import type {
  ForecastListEntry,
  ModelProbabilities,
  ScoreCard,
  ScoresResponse,
} from '@fmip/contracts';
import { percentages } from './forecast';

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
