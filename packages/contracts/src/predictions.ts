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

// ---------------------------------------------------------------------------
// Friends' recent predictions on the member's homepage (blueprint 2.3, T-942)
// ---------------------------------------------------------------------------

/** How far back the homepage looks for a friend's prediction, in days (D-115). */
export const FRIEND_PREDICTIONS_DAYS = 7;
/** The most friends' predictions one answer carries (D-115). */
export const FRIEND_PREDICTIONS_LIMIT = 10;

/**
 * One friend's standing call on one match, as the viewer may see it.
 *
 * Only a friend whose `prediction_history_visibility` lets this viewer read
 * their history is ever in the answer (D-063, D-115): the same rule as their
 * profile, asked of the profile boundary, never a second one. `settlement` is
 * the stored one (T-052), read and never recomputed.
 */
export interface FriendPrediction {
  username: string;
  display_name: string;
  fixture: PredictionHistoryFixture;
  /** The version that stands: the latest one submitted. */
  version: PredictionVersion;
  revisions: number;
  settlement: Settlement | null;
}

/** `GET /me/friends/predictions` (T-942). Newest call first. */
export interface FriendPredictionsResponse {
  predictions: FriendPrediction[];
  /** ISO 8601: the start of the window the answer covers. */
  since: string;
}

// ---------------------------------------------------------------------------
// A public link to one correct prediction's card (T-1723, D-351)
// ---------------------------------------------------------------------------

/** A share token: 128 random bits, base64url without padding. */
export const PREDICTION_SHARE_TOKEN = /^[A-Za-z0-9_-]{22}$/;

/**
 * What the "called it" card draws, and nothing else: the member's own pick
 * from the version that was settled, when they made it, and the score it was
 * settled against. No rating, no model, no other prediction (rule 6). Only a
 * prediction whose current settlement is `settled` with the outcome right has
 * one.
 */
export interface CalledItCard {
  fixture_id: string;
  /** Canonical (English) names: the card's words stay English (T-1309, T-1506). */
  competition: string;
  round: string | null;
  home: { name: string; short_name: string | null };
  away: { name: string; short_name: string | null };
  /** The score the prediction was settled against (`Settlement.actual`). */
  actual: { home: number; away: number };
  /** From the settled version (`Settlement.version_number`). */
  pick: { outcome: PredictionOutcome; score: { home: number; away: number } | null };
  /** The settled version carried an exact score and it was right. */
  exact: boolean;
  /** ISO 8601: when the settled version was submitted. */
  picked_at: string;
  /** ISO 8601 of the kick-off, for "N days before kick-off". */
  kickoff_at: string;
  /** The handle, never the display name (a card's words stay English, T-1309). */
  username: string;
}

/** One live public link. */
export interface PredictionShare {
  token: string;
  created_at: string;
}

/**
 * `GET /me/predictions/:predictionId/share`, the owner only: the card and the
 * live link, if there is one, or why there is no card.
 */
export type OwnPredictionShareResponse =
  | { kind: 'called'; card: CalledItCard; share: PredictionShare | null }
  | { kind: 'not_called'; reason: 'open' | 'void' | 'wrong' };

/** `POST /me/predictions/:predictionId/share`: the live link, made now or already standing. */
export interface PredictionShareResponse {
  share: PredictionShare;
}

/** `GET /prediction-shares/:token`, public: the card a live link shows. 404 otherwise. */
export interface PublicPredictionShareResponse {
  card: CalledItCard;
}

// ---------------------------------------------------------------------------
// A pick saved before the e-mail address is confirmed (T-1740, D-361)
// ---------------------------------------------------------------------------

/**
 * The confidence a pick made by one tap carries (T-1738): the middle of 1 to
 * 5. A prediction always has one (blueprint 6.6); a pick that names only an
 * outcome -- the control's one tap, and a pending pick when it becomes a
 * prediction (D-361) -- is written with this, and the member changes it under
 * "Add detail".
 */
export const DEFAULT_PICK_CONFIDENCE = 3;

/**
 * What became of a pending pick. `pending`: saved, waiting for the member to
 * confirm their e-mail address before kick-off. `converted`: confirmed in
 * time, and written as an ordinary prediction at the moment of confirmation.
 * `expired`: kick-off came first -- saved, not counted. `replaced`: the
 * member chose again before confirming. `withdrawn`: the member took it back.
 */
export type PendingPickStatus = 'pending' | 'converted' | 'expired' | 'replaced' | 'withdrawn';

/**
 * A pick made before the member confirmed their e-mail address (D-361). **Not
 * a prediction**: it is in no consensus, is never settled and never touches a
 * rating; it is shown to its owner and to nobody else. It carries the outcome
 * and nothing more (no score, confidence or reasons).
 */
export interface PendingPick {
  id: string;
  fixture_id: string;
  outcome: PredictionOutcome;
  /** As the server's clock has it now: a pick still waiting at kick-off reads `expired`. */
  status: PendingPickStatus;
  /** ISO 8601: when the member chose it. */
  saved_at: string;
  /** ISO 8601: when it stopped waiting (converted, expired, replaced or withdrawn), else null. */
  resolved_at: string | null;
  /** ISO 8601, the kick-off: it counts only if the e-mail address is confirmed before this. */
  counts_before: string;
}

/** `PUT /fixtures/:fixtureId/pending-pick`: the outcome, and nothing else. */
export interface SavePendingPickRequest {
  outcome: PredictionOutcome;
}

/**
 * `GET`/`PUT /fixtures/:fixtureId/pending-pick`, the signed-in member's own:
 * the newest pending pick they made on the match, whatever became of it, or
 * null when they made none.
 */
export interface PendingPickResponse {
  pending_pick: PendingPick | null;
}
