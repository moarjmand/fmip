import type { ContributorFlag } from '@fmip/contracts';

/**
 * The words for a contributor flag on the console (T-1031, D-137). Pure, so
 * every sentence is covered by `contributor-flags.spec.ts`.
 */

const DAY_MS = 86_400_000;

/** Whole days from `since` to `now`, never negative. */
export function daysSince(since: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - Date.parse(since)) / DAY_MS));
}

/** The one line an approver reads first: who, how long, how far below. */
export function flagSummary(flag: ContributorFlag, now: Date): string {
  const days = daysSince(flag.below_since, now);
  const rating = flag.rating_now ?? flag.rating_at_flag;
  return `Below the contributor threshold of ${flag.threshold} for ${days} ${
    days === 1 ? 'day' : 'days'
  } (rating ${rating}; flagged after ${flag.period_days}).`;
}

/** What the flag did and did not do, said every time, because the answer is always the same. */
export const FLAG_NOTHING_PAUSED =
  'Nothing was paused. Pause the grant below if that is your decision, or dismiss this flag with a reason.';

/** The period line under the heading: in force, and whose number it is. */
export function periodLine(periodDays: number, threshold: number): string {
  return `A contributor is flagged after ${periodDays} consecutive days below a rating of ${threshold}. The period is a proposal until the maintainer confirms it (D-137).`;
}
