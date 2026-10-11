import type { PredictionHistoryItem, Prediction, ScoreCard, ScoresResponse } from '@fmip/contracts';
import { dateIn, shiftDate } from './scores';

/**
 * The Predictions page's match list, by day (T-1383, D-201): today first,
 * then the following days, each day grouped by competition in the order the
 * scores answer gives them (D-154's `display_order` when asked without a
 * session). Pure, so the order, the filter and the cap are unit-tested.
 */

/** Today and the two days after it: the board's Today, Tomorrow and the day after. */
export const PREDICTION_DAYS = 3;

/**
 * Of the matches listed, at most this many get their version history asked
 * for one by one (`GET /fixtures/:id/forecasts`); the rest say where their
 * earlier versions are kept. A match with one version needs no request.
 */
export const HISTORY_LOOKUPS = 16;

export interface PredictionCompetition {
  id: string;
  name: string;
  fixtures: ScoreCard[];
}

export interface PredictionDay {
  /** YYYY-MM-DD in the reader's zone. */
  date: string;
  competitions: PredictionCompetition[];
  /** Matches listed under this day. */
  count: number;
}

export interface PredictionDays {
  days: PredictionDay[];
  /** Every listed match, in page order. */
  shown: ScoreCard[];
  /** Matches in the window that the cap left out (rule 3: said, not hidden). */
  omitted: number;
  /** The competitions in the window, in the answer's order, for the filter. */
  competitions: { id: string; name: string }[];
}

/**
 * Buckets the scores answer for `from` .. `from + PREDICTION_DAYS - 1` into
 * days and competitions. `competition` keeps one competition; `limit` caps
 * the list in page order (the list endpoints take at most fifty ids).
 */
export function predictionDays(
  scores: ScoresResponse,
  options: { from: string; timeZone: string; competition: string | null; limit: number },
): PredictionDays {
  const { from, timeZone, competition, limit } = options;
  const dates = Array.from({ length: PREDICTION_DAYS }, (_, i) => shiftDate(from, i));

  // The competitions in the answer's order; a pinned card (a member's
  // favourite, only with a session) joins its own competition's group.
  const order = new Map<string, PredictionCompetition>();
  const see = (card: ScoreCard): void => {
    let group = order.get(card.competition.id);
    if (group === undefined) {
      group = { id: card.competition.id, name: card.competition.name, fixtures: [] };
      order.set(card.competition.id, group);
    }
    if (!group.fixtures.some((c) => c.id === card.id)) group.fixtures.push(card);
  };
  for (const group of scores.groups) group.fixtures.forEach(see);
  scores.pinned.forEach(see);

  const competitions = [...order.values()]
    .filter((g) => g.fixtures.length > 0)
    .map(({ id, name }) => ({ id, name }));

  const days: PredictionDay[] = [];
  const shown: ScoreCard[] = [];
  let omitted = 0;
  for (const date of dates) {
    const day: PredictionDay = { date, competitions: [], count: 0 };
    for (const group of order.values()) {
      if (competition !== null && group.id.toLowerCase() !== competition) continue;
      const fixtures = group.fixtures
        .filter((card) => dateIn(timeZone, new Date(card.kickoff_at)) === date)
        .sort((a, b) => Date.parse(a.kickoff_at) - Date.parse(b.kickoff_at));
      const kept: ScoreCard[] = [];
      for (const card of fixtures) {
        if (shown.length < limit) {
          kept.push(card);
          shown.push(card);
        } else omitted += 1;
      }
      if (kept.length > 0) {
        day.competitions.push({ id: group.id, name: group.name, fixtures: kept });
        day.count += kept.length;
      }
    }
    if (day.count > 0) days.push(day);
  }
  return { days, shown, omitted, competitions };
}

/** "today", "tomorrow" or another day, for the day's heading. */
export function dayKind(date: string, today: string): 'today' | 'tomorrow' | 'other' {
  if (date === today) return 'today';
  if (date === shiftDate(today, 1)) return 'tomorrow';
  return 'other';
}

/**
 * The member's own predictions on the listed matches, from one page of
 * `GET /me/predictions` (newest kick-off first). `missing` names the listed
 * matches that page cannot answer for: only when the page was full and its
 * oldest kick-off is later than the match, so a further prediction could
 * exist beyond it. Everything else not found is simply not predicted.
 */
export function ownPredictions(
  items: PredictionHistoryItem[],
  pageFull: boolean,
  fixtures: readonly Pick<ScoreCard, 'id' | 'kickoff_at'>[],
): { found: Map<string, Prediction>; missing: string[] } {
  const found = new Map<string, Prediction>();
  for (const item of items) found.set(item.prediction.fixture_id, item.prediction);
  const oldest = items.reduce<number>(
    (min, item) => Math.min(min, Date.parse(item.fixture.kickoff_at)),
    Number.POSITIVE_INFINITY,
  );
  const missing = pageFull
    ? fixtures.filter((f) => !found.has(f.id) && Date.parse(f.kickoff_at) < oldest).map((f) => f.id)
    : [];
  return { found, missing };
}
