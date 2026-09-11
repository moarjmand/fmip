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
