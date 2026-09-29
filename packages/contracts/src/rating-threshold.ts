/**
 * Rating thresholds as versioned rows (T-1160, D-152, D-164).
 *
 * The numbers a rating and a contributor eligibility are judged by -- when a
 * rating stops being provisional and becomes established, the contributor
 * thresholds of D-059 and D-137's sustained period -- are rows an
 * administrator supersedes from the console with a reason and a start. The
 * formula itself is never a setting: it changes only by a new formula
 * version. No row is edited; a new one supersedes, so a rating or an
 * eligibility can always be recomputed under the version in force when it
 * was computed (rule 8).
 */
export interface RatingThresholdValues {
  /** A rating over fewer settled predictions than this is provisional. */
  provisional_below: number;
  /** A rating over at least this many settled predictions is established. */
  established_at: number;
  /** The contributor rating threshold (D-059), one decimal place at most. */
  contributor_min_rating: number;
  /** Settled predictions a contributor needs (D-059). */
  contributor_min_settled: number;
  /** How far back a moderation decision still counts against eligibility, in days. */
  conduct_window_days: number;
  /** Consecutive days below the contributor threshold before a flag (D-137, D-169). */
  flag_period_days: number;
}

/** The six values, in the order the console shows them. */
export const RATING_THRESHOLD_FIELDS = [
  'provisional_below',
  'established_at',
  'contributor_min_rating',
  'contributor_min_settled',
  'conduct_window_days',
  'flag_period_days',
] as const satisfies readonly (keyof RatingThresholdValues)[];

/** The bounds a value must stay within, inclusive. */
export const RATING_THRESHOLD_BOUNDS: Record<
  keyof RatingThresholdValues,
  { min: number; max: number; integer: boolean }
> = {
  provisional_below: { min: 1, max: 1000, integer: true },
  established_at: { min: 1, max: 1000, integer: true },
  contributor_min_rating: { min: 0, max: 100, integer: false },
  contributor_min_settled: { min: 1, max: 10000, integer: true },
  conduct_window_days: { min: 1, max: 3650, integer: true },
  flag_period_days: { min: 1, max: 365, integer: true },
};

/** How far ahead a new version may start. */
export const RATING_THRESHOLD_MAX_LEAD_DAYS = 366;

export interface RatingThresholdVersion extends RatingThresholdValues {
  version: number;
  /** ISO 8601: in force from here until a later version's start. */
  effective_from: string;
  /** The administrator's username; null for version 1, which the migration wrote. */
  set_by: string | null;
  reason: string;
  /** ISO 8601: when the row was written. */
  recorded_at: string;
}

/** `GET /admin/rating-thresholds`: every version, newest first. */
export interface RatingThresholdListResponse {
  generated_at: string;
  /** The version in force now. */
  in_force: number;
  versions: RatingThresholdVersion[];
}

/** `POST /admin/rating-thresholds`: a new version, all six values stated. */
export interface SetRatingThresholdsRequest extends RatingThresholdValues {
  /** ISO 8601 with a zone; omitted or null means now. Never in the past. */
  effective_from?: string | null;
  reason: string;
}
