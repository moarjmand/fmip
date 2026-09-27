import type { CompetitionRating, RatingHistory, RatingHistoryPoint } from '@fmip/contracts';
import {
  RATING_FORMULA_V1,
  type RatingFormula,
  type RatingInput,
  computeRating,
  ratingTrajectory,
} from './formula';

/** A settled prediction as the formula sees it, plus where it was played. */
export interface HistoryInput extends RatingInput {
  competition: { id: string; name: string };
}

/**
 * A member's rating over time, by competition, and their highest (blueprint
 * 9.3, T-640). Pure, and built only from `computeRating`: the trajectory is
 * the formula replayed over each prefix of the stored settlements, and each
 * competition is the formula over that competition's settlements alone. So
 * the last point is the rating a recompute stores today (rule 8), and the
 * per-competition settled counts add up to the whole.
 *
 * Null with nothing settled: an empty trajectory would look like a flat line.
 */
export function ratingHistory(
  inputs: readonly HistoryInput[],
  computedAt: string,
  formula: RatingFormula = RATING_FORMULA_V1,
): RatingHistory | null {
  const steps = ratingTrajectory(inputs, formula);
  const first = steps[0];
  if (first === undefined) return null;

  // One point per UTC day: the rating as it stood after that day's last settlement.
  const points: RatingHistoryPoint[] = [];
  for (const step of steps) {
    const point: RatingHistoryPoint = {
      date: utcDate(step.input.settledAt),
      settled_at: step.input.settledAt,
      rating: step.result.rating,
      settled_total: step.settledTotal,
      provisional: step.result.provisional,
    };
    if (points.at(-1)?.date === point.date) points[points.length - 1] = point;
    else points.push(point);
  }

  // Highest after any single settlement, even one a day's later settlements
  // took back; the first time it was reached.
  let peak = first;
  for (const step of steps) if (step.result.rating > peak.result.rating) peak = step;

  const groups = new Map<string, HistoryInput[]>();
  for (const input of inputs) {
    const group = groups.get(input.competition.id);
    if (group === undefined) groups.set(input.competition.id, [input]);
    else group.push(input);
  }
  const byCompetition: CompetitionRating[] = [];
  for (const group of groups.values()) {
    const result = computeRating(group, formula);
    const { competition } = group[0] ?? {};
    if (result === null || competition === undefined) continue;
    byCompetition.push({
      competition: { id: competition.id, name: competition.name },
      settled_count: group.length,
      outcome_correct: group.filter((i) => i.correct).length,
      score_correct: group.filter((i) => i.scoreCorrect === true).length,
      rating: result.rating,
      provisional: result.provisional,
    });
  }
  byCompetition.sort(
    (a, b) =>
      b.settled_count - a.settled_count ||
      a.competition.name.localeCompare(b.competition.name) ||
      a.competition.id.localeCompare(b.competition.id),
  );

  return {
    formula_version: formula.version,
    settled_total: steps.length,
    points,
    highest: {
      rating: peak.result.rating,
      date: utcDate(peak.input.settledAt),
      settled_at: peak.input.settledAt,
      provisional: peak.result.provisional,
    },
    by_competition: byCompetition,
    computed_at: computedAt,
  };
}

function utcDate(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}
