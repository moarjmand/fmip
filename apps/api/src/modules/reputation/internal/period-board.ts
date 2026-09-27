import {
  RATING_FORMULA_V1,
  type RatingFormula,
  type RatingInput,
  type RatingResult,
  computeRating,
} from './formula';

/** A settled prediction as the formula sees it, plus whose it is. */
export interface PeriodInput extends RatingInput {
  userId: string;
}

export interface PeriodBoardRow {
  rank: number;
  userId: string;
  username: string;
  result: RatingResult;
}

/**
 * A month or season board (blueprint 9.3, T-641), pure.
 *
 * Each member's rating is `computeRating` over **that period's settlements
 * only** -- the same function, the same version, the same window a recompute
 * uses, so there is no second formula and the number is recomputable from the
 * stored settlements and forecasts alone (rule 8). The minimum-sample filter
 * is the global board's, applied to the same `settledCount` the snapshots
 * store, so a month with a handful of lucky picks ranks nobody (D-037); a
 * short period is not a reason to lower the floor (D-060).
 *
 * `members` is the population, already decided by the caller: the scope
 * (everyone, friends, a group), active accounts, and the privacy rule. A
 * settlement whose member is not in it is ignored, and ranks are computed
 * inside it. Ordering is the global board's: rating, then sample, then
 * username, so ranks are unique.
 */
export function periodBoard(
  inputs: readonly PeriodInput[],
  members: ReadonlyMap<string, string>,
  minSettled: number,
  formula: RatingFormula = RATING_FORMULA_V1,
): PeriodBoardRow[] {
  const byMember = new Map<string, PeriodInput[]>();
  for (const input of inputs) {
    if (!members.has(input.userId)) continue;
    const rows = byMember.get(input.userId);
    if (rows === undefined) byMember.set(input.userId, [input]);
    else rows.push(input);
  }

  const ranked: Omit<PeriodBoardRow, 'rank'>[] = [];
  for (const [userId, rows] of byMember) {
    const result = computeRating(rows, formula);
    if (result === null || result.settledCount < minSettled) continue;
    ranked.push({ userId, username: members.get(userId) ?? '', result });
  }
  ranked.sort(
    (a, b) =>
      b.result.rating - a.result.rating ||
      b.result.settledCount - a.result.settledCount ||
      (a.username < b.username ? -1 : a.username > b.username ? 1 : 0),
  );
  return ranked.map((row, index) => ({ rank: index + 1, ...row }));
}
