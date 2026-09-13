/**
 * Turning a fixture's standing predictions into the two distributions blueprint
 * 6.6 asks for (T-134). Pure, so the arithmetic is testable without a database.
 */

import type {
  ConsensusOutcome,
  ConsensusShares,
  CrowdDistribution,
  WeightedDistribution,
} from '@fmip/contracts';

export const OUTCOMES: readonly ConsensusOutcome[] = ['home', 'draw', 'away'];

export interface Vote {
  outcome: ConsensusOutcome;
  /**
   * The member's **established** Performance Rating, or `null` when they have
   * none. A provisional rating arrives here as `null` on purpose: the store
   * does not pass one through, because a number that means "we do not know yet"
   * must not become a weight (D-052).
   */
  rating: number | null;
}

/** Four decimal places: finer than any percentage a page will show. */
const PLACES = 4;
const SCALE = 10 ** PLACES;

/**
 * Shares that sum to exactly 1.
 *
 * Rounding each of three numbers independently gives totals like 0.9999, which
 * a page renders as "100%" one day and "99.99%" the next depending on the
 * numbers. The largest-remainder method hands the leftover units to the
 * outcomes with the largest fractional parts, which is the standard fix and
 * keeps the ordering of the three intact.
 *
 * The caller guarantees `total > 0`; there is no honest share of nothing.
 */
function shares(mass: Record<ConsensusOutcome, number>): ConsensusShares {
  const total = OUTCOMES.reduce((sum, outcome) => sum + mass[outcome], 0);
  const exact = OUTCOMES.map((outcome) => (mass[outcome] / total) * SCALE);
  const units = exact.map((value) => Math.floor(value));

  let left = SCALE - units.reduce((sum, unit) => sum + unit, 0);
  const byRemainder = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction);
  for (let i = 0; left > 0; i = (i + 1) % byRemainder.length, left -= 1) {
    const slot = byRemainder[i % byRemainder.length];
    if (slot !== undefined) units[slot.index] = (units[slot.index] ?? 0) + 1;
  }

  return {
    home: (units[0] ?? 0) / SCALE,
    draw: (units[1] ?? 0) / SCALE,
    away: (units[2] ?? 0) / SCALE,
  };
}

function tally(votes: Vote[], weight: (vote: Vote) => number): Record<ConsensusOutcome, number> {
  const mass: Record<ConsensusOutcome, number> = { home: 0, draw: 0, away: 0 };
  for (const vote of votes) mass[vote.outcome] += weight(vote);
  return mass;
}

/** One member, one vote. The caller guarantees at least one. */
export function crowd(votes: Vote[]): CrowdDistribution {
  const counts = tally(votes, () => 1);
  return { counts, shares: shares(counts) };
}

/**
 * The same crowd weighted by rating, or `null` when there is nothing to weight.
 *
 * `null` happens in two ways and both are honest: no established rater has
 * predicted this fixture, or every one who has carries a rating of 0. The
 * second is not a rounding edge — a rating of 0 is the system's verdict that a
 * member's calls have been worthless, and a distribution over zero total weight
 * has no meaning at all. Neither case may fall back to the crowd distribution:
 * blueprint 6.6 wants two answers, and giving the same one twice under two
 * labels is the disguise it forbids.
 */
export function weighted(votes: Vote[]): WeightedDistribution | null {
  const rated = votes.filter((vote) => vote.rating !== null);
  if (rated.length === 0) return null;

  const mass = tally(rated, (vote) => vote.rating ?? 0);
  const total = OUTCOMES.reduce((sum, outcome) => sum + mass[outcome], 0);
  if (total <= 0) return null;

  return { shares: shares(mass), raters: rated.length };
}
