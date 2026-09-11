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
