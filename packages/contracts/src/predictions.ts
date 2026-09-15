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

// ---------------------------------------------------------------------------
// Prediction history (blueprint 7.2, T-056): every prediction a member made,
// newest kick-off first, with the version that stands and how it settled.
// Visibility follows the member's `prediction_history_visibility`.
// ---------------------------------------------------------------------------

export interface PredictionHistoryFixture {
  id: string;
  kickoff_at: string;
  status: string;
  competition: { id: string; name: string };
  home: { id: string; name: string; short_name: string | null };
  away: { id: string; name: string; short_name: string | null };
  /** Full time when known, else the current score, else null. */
  score: { home: number; away: number } | null;
}

export interface PredictionHistoryItem {
  fixture: PredictionHistoryFixture;
  prediction: Prediction;
}

/** `GET /users/:username/predictions?limit=&offset=`, `GET /me/predictions`. */
export type PredictionHistoryResponse =
  | {
      kind: 'visible';
      username: string;
      is_self: boolean;
      /** Predictions in the whole history, before paging. */
      total: number;
      limit: number;
      offset: number;
      items: PredictionHistoryItem[];
    }
  | {
      kind: 'restricted';
      username: string;
      visibility: Exclude<'public' | 'friends' | 'private', 'public'>;
    };

// ---------------------------------------------------------------------------
// Prediction comparison inside a group (blueprint 8.2, T-246)
// ---------------------------------------------------------------------------

/**
 * One member's call on a fixture, as their group sees it.
 *
 * `settlement` is the **stored** settlement (T-052), read and never recomputed.
 * A comparison that scored the calls itself would be a second settlement, and
 * the day it disagreed with the first one there would be no way to say which
 * was the product's answer (rule 8).
 */
export interface GroupPredictionCall {
  username: string;
  display_name: string;
  /** The version that stands: the last one submitted before the lock. */
  version: PredictionVersion;
  /** How many versions there are, so a call changed four times says so. */
  revisions: number;
  settlement: Settlement | null;
}

/** `GET /groups/:slug/fixtures/:fixtureId/predictions`. */
export interface GroupPredictionComparison {
  fixture_id: string;
  /** ISO 8601. Nothing may change after this (T-051). */
  kickoff_at: string;
  locked: boolean;
  /** Ordered by confidence, then by who called it first. */
  calls: GroupPredictionCall[];
  /** Members of the group with no prediction for this fixture. */
  silent: number;
  /**
   * Members whose prediction history this viewer may not see (T-056).
   *
   * Counted and stated rather than dropped, because a comparison that quietly
   * omitted them would report a smaller group than the one that exists, and a
   * reader would take the calls shown for all of them (rule 3).
   */
  withheld: number;
}

export interface GroupPredictionComparisonResponse {
  comparison: GroupPredictionComparison;
}
