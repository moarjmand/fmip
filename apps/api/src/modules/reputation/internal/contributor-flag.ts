/**
 * A contributor below the threshold for a sustained period (blueprint 9.4,
 * T-1031, D-137). Pure: the store reads the stored ratings and the live
 * grants, and this decides which flags to raise and which to close.
 *
 * **Nothing here pauses anybody, and nothing can.** The outcome is a flag for
 * an administrator and a notification telling them about it; pausing stays
 * the existing audited act a person performs (T-250).
 *
 * **The threshold is the contributor threshold of D-059**
 * (`ELIGIBILITY_V1.minRating`), read from its one home rather than copied.
 */

/**
 * **The proposal, not a decision.** How long a contributor may stay below the
 * threshold before an administrator is asked to look is the maintainer's
 * policy (N-7 in `docs/04-tasks-phase-10.md`). D-137 records 30 consecutive
 * days as the proposal; `CONTRIBUTOR_FLAG_PERIOD_DAYS` overrides it without a
 * code change, and confirming or changing the number is the maintainer's.
 */
export const CONTRIBUTOR_FLAG_PROPOSED_PERIOD_DAYS = 30;

/** The rules a flag is raised under; a change to what the check decides changes this. */
export const CONTRIBUTOR_FLAG_RULES = 'contributor-flag@1.0.0';

const MAX_PERIOD_DAYS = 365;
const DAY_MS = 86_400_000;

/**
 * The period in force: `CONTRIBUTOR_FLAG_PERIOD_DAYS` when it is a whole number
 * of days from 1 to 365, else the proposal. A malformed value falls back
 * rather than failing the boot: the check is advisory, and a typo should not
 * take the API down.
 */
export function flagPeriodDays(env: NodeJS.ProcessEnv = process.env): number {
  const raw = (env.CONTRIBUTOR_FLAG_PERIOD_DAYS ?? '').trim();
  if (raw === '') return CONTRIBUTOR_FLAG_PROPOSED_PERIOD_DAYS;
  const days = Number(raw);
  return Number.isInteger(days) && days >= 1 && days <= MAX_PERIOD_DAYS
    ? days
    : CONTRIBUTOR_FLAG_PROPOSED_PERIOD_DAYS;
}

/** One stored rating (`rating_snapshot`). */
export interface RatingPoint {
  rating: number;
  at: Date;
}

/**
 * When the member's current stretch below the threshold began: the first
 * stored rating of the unbroken run of ratings below it that ends with the
 * newest one. Null when the newest rating is at or above the threshold, or
 * when there is none -- "not rated" is not "below".
 *
 * `points` is oldest first. A snapshot is stored only when the inputs change,
 * so a rating that sat unchanged below the threshold for forty days is one
 * point forty days old, and the stretch began then.
 */
export function belowSince(points: readonly RatingPoint[], threshold: number): Date | null {
  const newest = points.at(-1);
  if (newest === undefined || newest.rating >= threshold) return null;
  let start = newest.at;
  for (let i = points.length - 1; i >= 0; i -= 1) {
    const point = points[i];
    if (point === undefined || point.rating >= threshold) break;
    start = point.at;
  }
  return start;
}

/**
 * Whether a stretch has lasted the period **as a contributor**: counted from
 * the later of its start and the grant, because a member approved while below
 * the threshold (approval never consults the arithmetic, T-250) has been a
 * contributor below it only since the approval.
 */
export function stretchDue(since: Date, grantedAt: Date, now: Date, periodDays: number): boolean {
  const from = Math.max(since.getTime(), grantedAt.getTime());
  return now.getTime() - from >= periodDays * DAY_MS;
}

export interface LiveHolder {
  userId: string;
  grantId: string;
  grantedAt: Date;
}

export interface OpenFlag {
  id: string;
  userId: string;
  belowSince: Date;
}

export interface FlagToRaise {
  userId: string;
  grantId: string;
  belowSince: Date;
  rating: number;
}

export interface FlagPlan {
  close: { id: string; reason: 'recovered' | 'grant_not_live' }[];
  raise: FlagToRaise[];
}

/**
 * The daily check's decisions. Closures first: an open flag whose member no
 * longer holds a live grant closes as `grant_not_live` (a person paused or
 * withdrew it); one whose stretch ended -- the member is back at or above the
 * threshold, or the stretch it named is no longer the current one -- closes
 * as `recovered`. Then a flag for every live contributor whose current
 * stretch has lasted the period and has no open flag for it; one already
 * raised for that stretch, open or dismissed, is the store's to skip (one row
 * per stretch).
 */
export function planFlags(
  holders: readonly LiveHolder[],
  open: readonly OpenFlag[],
  ratings: ReadonlyMap<string, readonly RatingPoint[]>,
  threshold: number,
  periodDays: number,
  now: Date,
): FlagPlan {
  const live = new Map(holders.map((holder) => [holder.userId, holder]));
  const close: FlagPlan['close'] = [];
  const stillOpen = new Set<string>();

  for (const flag of open) {
    if (!live.has(flag.userId)) {
      close.push({ id: flag.id, reason: 'grant_not_live' });
      continue;
    }
    const since = belowSince(ratings.get(flag.userId) ?? [], threshold);
    if (since === null || since.getTime() !== flag.belowSince.getTime()) {
      close.push({ id: flag.id, reason: 'recovered' });
      continue;
    }
    stillOpen.add(flag.userId);
  }

  const raise: FlagToRaise[] = [];
  for (const holder of holders) {
    if (stillOpen.has(holder.userId)) continue;
    const points = ratings.get(holder.userId) ?? [];
    const since = belowSince(points, threshold);
    const newest = points.at(-1);
    if (since === null || newest === undefined) continue;
    if (!stretchDue(since, holder.grantedAt, now, periodDays)) continue;
    raise.push({
      userId: holder.userId,
      grantId: holder.grantId,
      belowSince: since,
      rating: newest.rating,
    });
  }
  return { close, raise };
}

export function flagKey(flagId: string): string {
  return `contributor_below_threshold:${flagId}`;
}
