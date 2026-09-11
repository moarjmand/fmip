/**
 * Registered-user predictions (blueprint 6.6, T-050). A member's prediction
 * on a fixture is a series of immutable versions; the latest counts, every
 * one is kept. Only signed-in members with a verified e-mail may submit, and
 * nothing may be written after kick-off (T-051).
 */

export type PredictionOutcome = 'home' | 'draw' | 'away';

export const PREDICTION_REASON_TAGS = [
  'form',
  'lineup',
  'home_advantage',
  'injuries',
  'tactics',
  'fatigue',
  'competition_importance',
  'head_to_head',
  'motivation',
] as const;
export type PredictionReasonTag = (typeof PREDICTION_REASON_TAGS)[number];

export const MAX_REASON_TAGS = 3;
export const MAX_EXPLANATION_LENGTH = 280;

/** `PUT /fixtures/:id/prediction`. */
export interface SubmitPredictionRequest {
  outcome: PredictionOutcome;
  /** Optional exact score; must agree with `outcome`. */
  score?: { home: number; away: number } | null;
  /** 1 (low) to 5 (high). */
  confidence: number;
  /** At most three, from `PREDICTION_REASON_TAGS`. */
  reason_tags?: PredictionReasonTag[];
  /** Up to 280 characters; blank is treated as none. */
  explanation?: string | null;
}

export interface PredictionVersion {
  id: string;
  version_number: number;
  outcome: PredictionOutcome;
  score: { home: number; away: number } | null;
  confidence: number;
  reason_tags: PredictionReasonTag[];
  explanation: string | null;
  /** ISO 8601. */
  submitted_at: string;
}

export type SettlementVoidReason = 'postponed' | 'abandoned' | 'cancelled' | 'awarded';

/**
 * How a prediction was settled (T-052). `settled` judges the version that
 * stood at kick-off against the full-time score; `void` names why the match
 * produced no result. Immutable: a later real result adds a new row.
 */
export interface Settlement {
  id: string;
  status: 'settled' | 'void';
  void_reason: SettlementVoidReason | null;
  actual: { home: number; away: number } | null;
  /** Null when void. */
  outcome_correct: boolean | null;
  /** Whether the settled version carried an exact score at all. */
  score_predicted: boolean;
  /** Null when void or when no exact score was predicted. */
  score_correct: boolean | null;
  confidence: number;
  settled_at: string;
  /** The version that was settled. */
  version_number: number;
}

export interface Prediction {
  id: string;
  fixture_id: string;
  /** ISO 8601 of the fixture's kick-off: after this nothing may change (T-051). */
  locks_at: string;
  locked: boolean;
  latest: PredictionVersion;
  /** Oldest first. */
  versions: PredictionVersion[];
  /** The current settlement, or null while the match is open or not yet settled. */
  settlement: Settlement | null;
}

/** `GET`/`PUT /fixtures/:id/prediction`: the member's own prediction. */
export interface PredictionResponse {
  prediction: Prediction;
}

/** `GET /fixtures/:id/settlements`: how the crowd's predictions on a fixture were settled. */
export interface FixtureSettlementsResponse {
  fixture_id: string;
  fixture_status: string;
  /** Predictions with a current settlement row. */
  predictions: number;
  settled: number;
  void: number;
  outcome_correct: number;
  score_correct: number;
  last_settled_at: string | null;
}

/** `POST /fixtures/:id/settle` (admin): what one run wrote. */
export interface SettlementRunResponse {
  run_id: string;
  settled: number;
  void: number;
  unchanged: number;
}
