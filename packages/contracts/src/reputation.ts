/**
 * Performance Rating (blueprint 9.1, T-053): a 0–100 measure of prediction
 * quality, provisional until 30 settled predictions and established at 50.
 * Every rating names the formula version that produced it and shows its
 * components, so "why is my rating this number" has an answer.
 */

export type RatingTier = 'bronze' | 'silver' | 'gold' | 'platinum' | 'elite';

/** Each component in [0, 1] before weighting; the weights are in the formula config. */
export interface RatingComponents {
  /** Result-prediction performance, adjusted for the difficulty of the correct selection. */
  result: number;
  /** Exact-score performance. */
  exact_score: number;
  /** Consistency across the most recent settled predictions. */
  consistency: number;
  /** Appropriate use of confidence. */
  confidence: number;
}

export interface Rating {
  username: string;
  /** 0–100, one decimal. */
  rating: number;
  tier: RatingTier;
  /** Fewer than the formula's provisional threshold of settled predictions. */
  provisional: boolean;
  /** At or above the formula's eligibility threshold. */
  established: boolean;
  settled_count: number;
  components: RatingComponents;
  /** name@semver of the formula configuration that produced this rating. */
  formula_version: string;
  /** ISO 8601, when this snapshot was computed. */
  computed_at: string;
}

/** `GET /me/rating`, `GET /users/:username/rating`. `rating` is null until the first settled prediction. */
export interface RatingResponse {
  username: string;
  rating: Rating | null;
}

// ---------------------------------------------------------------------------
// Rating over time, by competition, and the highest (blueprint 9.3, T-640).
// Every number is recomputed from the member's current stored settlements
// under the formula in force (rule 8); nothing here is read from a second
// store or produced by a second formula.
// ---------------------------------------------------------------------------

/** The rating as it stood at the end of one UTC day on which something settled. */
export interface RatingHistoryPoint {
  /** YYYY-MM-DD, UTC. */
  date: string;
  /** ISO 8601, the last settlement counted in this point. */
  settled_at: string;
  rating: number;
  /** Every settled prediction up to and including this point (not only the formula's window). */
  settled_total: number;
  provisional: boolean;
}

/** One competition's settled predictions, rated on their own under the same formula. */
export interface CompetitionRating {
  competition: { id: string; name: string };
  settled_count: number;
  outcome_correct: number;
  score_correct: number;
  rating: number;
  provisional: boolean;
}

export interface RatingHistory {
  formula_version: string;
  /** Every settled prediction; equals the sum of `by_competition[].settled_count`. */
  settled_total: number;
  /** Oldest first, one point per UTC day with a settlement. */
  points: RatingHistoryPoint[];
  /** The highest rating after any single settlement, and when it was first reached. */
  highest: { rating: number; date: string; settled_at: string; provisional: boolean };
  /** Most settled first, then by name. */
  by_competition: CompetitionRating[];
  /** ISO 8601, when this was computed. */
  computed_at: string;
}

/**
 * `GET /users/:username/rating/history`, `GET /me/rating/history`. Follows the
 * member's prediction-history visibility, because a trajectory and a
 * per-competition breakdown say when and where they predicted. `history` is
 * null until the first settled prediction.
 */
export type RatingHistoryResponse =
  | { kind: 'visible'; username: string; is_self: boolean; history: RatingHistory | null }
  | { kind: 'restricted'; username: string; visibility: 'friends' | 'private' };

// ---------------------------------------------------------------------------
// Career Points (blueprint 9.2, T-054): participation and achievement as a
// ledger, kept apart from the rating and never an input to privileges.
// ---------------------------------------------------------------------------

export type PointsReason = 'settled' | 'correct_outcome' | 'exact_score' | 'streak_5' | 'streak_10';

export interface PointsTransaction {
  id: string;
  settlement_id: string;
  reason: PointsReason;
  points: number;
  rule_version: string;
  awarded_at: string;
}

export interface CareerPoints {
  username: string;
  total: number;
  settled_predictions: number;
  correct_outcomes: number;
  exact_scores: number;
  /** Consecutive correct outcomes at the end of the settled history. */
  current_streak: number;
  rules_version: string;
  /** Newest first. */
  recent: PointsTransaction[];
}

/** `GET /me/points`, `GET /users/:username/points`, `POST /me/points/award` (adds `added`). */
export interface CareerPointsResponse {
  username: string;
  points: CareerPoints;
  /** Only on the award call: how many ledger rows the pass wrote. */
  added?: number;
}

// ---------------------------------------------------------------------------
// Leaderboards (blueprint 9.3, T-055): members ranked by their current
// rating, behind a minimum-sample filter so one lucky result cannot rank
// above established performers.
// ---------------------------------------------------------------------------

export interface LeaderboardEntry {
  /** 1-based; members with the same rating, sample and name share none. */
  rank: number;
  username: string;
  rating: number;
  tier: RatingTier;
  settled_count: number;
  provisional: boolean;
  established: boolean;
  formula_version: string;
  /**
   * ISO 8601: when this member's current snapshot was computed, or, on a
   * month or season board, when the period rating was computed (on read).
   */
  computed_at: string;
}

/**
 * Who a board is drawn from (T-641): every member, or the signed-in viewer
 * and their accepted friends. `group` is the group board (T-243), which has
 * its own route.
 */
export const LEADERBOARD_SCOPES = ['everyone', 'friends'] as const;
export type LeaderboardScope = (typeof LEADERBOARD_SCOPES)[number];

export const LEADERBOARD_PERIOD_KINDS = ['all', 'month', 'season'] as const;
export type LeaderboardPeriodKind = (typeof LEADERBOARD_PERIOD_KINDS)[number];

/**
 * Which settlements a board ranks (T-641).
 *
 * - `all`: the current rating, from the stored snapshots.
 * - `month`: the rating computed over the settlements made in one calendar
 *   month, UTC (`from` inclusive, `to` exclusive).
 * - `season`: the rating computed over the settlements of fixtures in every
 *   competition's season with this label (e.g. `2025/26`); `null` when no
 *   season has a settled prediction yet.
 */
export type LeaderboardPeriod =
  | { kind: 'all' }
  | { kind: 'month'; month: string; from: string; to: string }
  | { kind: 'season'; label: string | null };

/** `GET /leaderboard?scope=&period=&month=&season=&min_settled=&limit=&offset=`. */
export interface LeaderboardResponse {
  scope: LeaderboardScope | 'group';
  period: LeaderboardPeriod;
  /** Months (`YYYY-MM`) and season labels with settled predictions, newest first: the pickers. */
  available_periods: { months: string[]; seasons: string[] };
  /** name@semver of the leaderboard rules (floor, presets, page sizes). */
  rules_version: string;
  /** The filter applied: at least this many settled predictions to be ranked. */
  min_settled: number;
  /** The lowest `min_settled` the board accepts; the rating is provisional below it. */
  floor: number;
  /** Suggested filter values for the UI. */
  presets: number[];
  /** Members ranked under this filter, before paging. */
  total: number;
  limit: number;
  offset: number;
  /** ISO 8601, when this page was assembled. */
  generated_at: string;
  entries: LeaderboardEntry[];
}

/** Blueprint 9.4: eligibility for high-rating privileges. Career Points are not an input. */
export interface PrivilegeEligibility {
  eligible: boolean;
  /** What is missing; empty when eligible. */
  reasons: string[];
  rules_version: string;
}

/** `GET /me/eligibility`. */
export interface EligibilityResponse {
  username: string;
  eligibility: PrivilegeEligibility;
}
