import type { PredictionHistoryItem, Prediction, ScoreCard } from '@fmip/contracts';

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
