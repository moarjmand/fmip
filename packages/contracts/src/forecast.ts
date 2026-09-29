/**
 * The internal contract between `apps/api` and the model service (T-063).
 *
 * The Pydantic twin is `apps/model/fmip_model/service/contract.py`; the two
 * change together, and the contract test in `apps/api` validates the
 * service's real output against these shapes. Nothing here is served to the
 * browser as-is: the forecast boundary (T-064) stores versions and exposes
 * its own shapes.
 */

import type { CoverageState } from './coverage';

export interface ModelForecastRequest {
  /** Catalog fixture UUID; echoed back, never interpreted by the model. */
  fixture_id: string;
  home_team_id: string;
  away_team_id: string;
  /** football-data.co.uk division code the fixture belongs to, e.g. `E0`. */
  division: string;
  /** ISO 8601 with zone. The model uses only history before this. */
  kickoff_at: string;
  /**
   * Each side's XI strength before the kick-off (T-534): the mean season rating
   * of the announced XI, or else of the last XI less the players reported out
   * (D-081). Absent or null when either side cannot be measured; a version
   * that does not use it ignores it.
   */
  xi_strength?: ModelXiStrength | null;
}

export interface ModelXiStrength {
  home: number;
  away: number;
  /** Both XIs announced, rather than expected. */
  confirmed: boolean;
}

export interface ModelProbabilities {
  home: number;
  draw: number;
  away: number;
}

export interface ModelExpectedGoals {
  home: number;
  away: number;
}

export interface ModelScorelineProbability {
  home: number;
  away: number;
  probability: number;
}

export type ModelLeadingFactorKind = 'team_strength' | 'home_advantage' | 'attack_vs_defence';

export interface ModelLeadingFactor {
  factor: ModelLeadingFactorKind;
  favours: 'home' | 'away' | 'neither';
  /** Signed, on the log-expected-goals scale. */
  magnitude: number;
  note: string;
}

export interface ModelInputs {
  model_version: string;
  /** ISO date. History up to and including this day was used. */
  fit_date: string;
  matches_used: number;
  elo_used: boolean;
  history_from: string | null;
  /** Mirrors `CoverageState`: the fit had everything it wants, or not. */
  data_completeness: 'available' | 'limited';
}

export interface ModelForecastAvailable {
  fixture_id: string;
  status: 'available';
  /** ISO 8601. */
  computed_at: string;
  probabilities: ModelProbabilities;
  expected_goals: ModelExpectedGoals;
  most_likely_scorelines: ModelScorelineProbability[];
  leading_factors: ModelLeadingFactor[];
  inputs: ModelInputs;
}

export type ModelUnavailableReason = 'team_not_mapped' | 'no_history' | 'division_not_loaded';

export interface ModelForecastUnavailable {
  fixture_id: string;
  status: 'unavailable';
  computed_at: string;
  reason: ModelUnavailableReason;
  detail: string;
}

export type ModelForecastResponse = ModelForecastAvailable | ModelForecastUnavailable;

export interface ModelHealth {
  status: 'ok';
  service: 'model';
  model_version: string;
  checked_at: string;
  /** Club Elo as the training store recorded it (T-920); absent from an older service. */
  elo_source?: ModelEloSource | null;
  /** The versions in shadow, oldest first (T-1102); absent from an older service. */
  candidate_versions?: string[];
}

/**
 * One candidate the model service runs in shadow (T-1102, D-140), from
 * `GET /candidates`: the name its route takes (`<name>-<version>`) and the
 * model version its forecasts are stored under.
 */
export interface ModelCandidate {
  name: string;
  model_version: string;
}

/**
 * Club Elo's state (T-920, D-111): the newest load that succeeded and the
 * newest that failed. `unanswered_since` is the newest success, else the
 * oldest failure since, so days without an answer can be counted; null when
 * the source was never asked.
 */
export interface ModelEloSource {
  source: 'clubelo';
  /** Whether the service asks Club Elo itself each day (`MODEL_CLUBELO_REFRESH`). */
  refresh: boolean;
  state: 'recorded' | 'unreadable';
  /** ISO date of the newest snapshot that loaded. */
  last_succeeded_day: string | null;
  last_succeeded_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
  unanswered_since: string | null;
  detail: string | null;
}

// ---------------------------------------------------------------------------
// The forecast boundary's own shapes (T-064): what apps/api serves about
// stored forecast versions. Immutable rows, so a version is never edited;
// the list is how the match centre shows what changed between versions.
// ---------------------------------------------------------------------------

/** Why a version was computed (blueprint 6.4). */
export type ForecastKind = 'early' | 'lineups_predicted' | 'lineups_confirmed' | 'manual';

export type ForecastUnavailableReason =
  | ModelUnavailableReason
  | 'competition_not_mapped'
  /** Clubs of different leagues, as in a European cup: the model rates within one (T-503). */
  | 'cross_competition'
  | 'model_unreachable'
  | 'contract_violation';

export interface ForecastVersion {
  id: string;
  fixture_id: string;
  /** 1 for the first version of a fixture, then counting up. */
  version_number: number;
  kind: ForecastKind;
  /** name@semver, as the model reported it. */
  model_version: string;
  /** ISO 8601, when the model computed it. */
  computed_at: string;
  status: 'available' | 'unavailable';
  /** Present when available. The three total exactly 1 at four decimals. */
  probabilities: ModelProbabilities | null;
  expected_goals: ModelExpectedGoals | null;
  most_likely_scorelines: ModelScorelineProbability[] | null;
  leading_factors: ModelLeadingFactor[] | null;
  data_completeness: 'available' | 'limited' | null;
  /**
   * What the model was working from, verbatim, as it reported it (T-121).
   *
   * Stored with every version so that the difference between two versions can
   * be attributed to something rather than asserted. `null` when the model
   * could not answer and so reported no inputs.
   */
  inputs: ModelInputs | null;
  /** Present when unavailable. */
  unavailable_reason: ForecastUnavailableReason | null;
  unavailable_detail: string | null;
}

/** `GET /fixtures/:id/forecasts`. */
export interface ForecastVersionsResponse {
  fixture_id: string;
  coverage: CoverageState;
  /** ISO 8601 of the latest version, or null when none exists (rule 4). */
  last_updated_at: string | null;
  latest: ForecastVersion | null;
  /** Oldest first. */
  versions: ForecastVersion[];
}

// ---------------------------------------------------------------------------
// Post-match evaluation (T-066): one forecast version scored against the
// full-time score, and model performance per competition as a query over
// those records. Immutable rows; pre-kick-off versions only in the aggregates.
// ---------------------------------------------------------------------------

export type MatchOutcome = 'home' | 'draw' | 'away';

export interface ForecastEvaluation {
  id: string;
  forecast_id: string;
  fixture_id: string;
  version_number: number;
  kind: ForecastKind;
  model_version: string;
  computed_at: string;
  evaluated_at: string;
  /** The version was computed before kick-off. Only such versions count in aggregates. */
  pre_kickoff: boolean;
  actual: { home: number; away: number };
  outcome: MatchOutcome;
  /** Probability the version gave the outcome that happened. */
  p_outcome: number;
  /** -ln(p_outcome). Uniform is ln 3 ≈ 1.098612; lower is better. */
  log_loss: number;
  /** Squared error over the three outcome indicators. Uniform is 2/3; lower is better. */
  brier: number;
  correct: boolean;
  scoreline_hit: boolean;
}

export interface FixtureEvaluationsResponse {
  fixture_id: string;
  coverage: CoverageState;
  last_updated_at: string | null;
  /** Oldest version first. */
  evaluations: ForecastEvaluation[];
}

export interface ModelPerformanceRow {
  model_version: string;
  kind: ForecastKind;
  versions_evaluated: number;
  fixtures_evaluated: number;
  log_loss: number;
  brier: number;
  /** Share of versions whose most probable outcome happened. */
  accuracy: number;
  /** Share of versions whose most likely scoreline was the final score. */
  scoreline_accuracy: number;
}

export interface ModelPerformanceResponse {
  competition_id: string;
  season_id: string | null;
  /** `limited` when finished fixtures exist that no pre-kick-off version covers. */
  coverage: CoverageState;
  last_updated_at: string | null;
  finished_fixtures: number;
  fixtures_evaluated: number;
  /** Versions that answered `unavailable`: gaps, never scored. */
  unavailable_versions: number;
  /** Versions computed after kick-off: evaluated, but excluded from `rows`. */
  post_kickoff_versions: number;
  reference: { uniform_log_loss: number; uniform_brier: number };
  rows: ModelPerformanceRow[];
}

/**
 * `GET /forecasts?fixtures=<id>,<id>` — the latest model forecast for several
 * fixtures at once (T-136).
 *
 * Only the latest version: a list is for scanning, and the version history that
 * makes `GET /fixtures/:id/forecasts` worth reading belongs on the match centre
 * where there is room to explain it. `latest` is null when the model has no
 * answer for that fixture, which is a normal state and not an error.
 */
export interface ForecastListEntry {
  fixture_id: string;
  latest: ForecastVersion | null;
}

export interface ForecastListResponse {
  fixtures: ForecastListEntry[];
}

/** How many fixtures one request may ask about. */
export const MAX_FORECAST_FIXTURES = 50;

/**
 * `GET /forecasts/pre-kickoff?fixtures=<id>,<id>` — what the scores card
 * summarises (T-940, D-114).
 *
 * The latest published version **computed before kick-off**, for several
 * fixtures at once. Before a match that is simply the latest version; once it
 * has started, a version recomputed during or after it is not the forecast the
 * match was played against, so the card keeps showing the one that was (the
 * same line the evaluation draws, `pre_kickoff`, T-066).
 *
 * A summary, not a version: the probabilities and what a reader needs to know
 * whose they are and when they were made. The inputs, factors and scorelines
 * stay on the match centre, so a Saturday of fifty matches is a small answer.
 */
export interface ForecastSummary {
  version_number: number;
  kind: ForecastKind;
  /** name@semver, as the model reported it. */
  model_version: string;
  computed_at: string;
  status: 'available' | 'unavailable';
  /** Present when available. The three total exactly 1 at four decimals. */
  probabilities: ModelProbabilities | null;
  /** Present when unavailable. */
  unavailable_reason: ForecastUnavailableReason | null;
}

export interface ForecastSummaryEntry {
  fixture_id: string;
  /** Null when no version was computed before kick-off: the card says so. */
  pre_kickoff: ForecastSummary | null;
}

export interface ForecastSummaryListResponse {
  fixtures: ForecastSummaryEntry[];
}

/**
 * Pre-kick-off forecasts a candidate needs before its promotion can be
 * decided (D-082, T-535). Below it the console shows the count, never a verdict.
 */
export const PROMOTION_MINIMUM = 300;

/** A candidate against the published version on the same matches of one competition. */
export interface CandidateCompetitionRecord {
  competition: { id: string; name: string };
  /**
   * Pairs scored: a (fixture, forecast kind) where both the candidate and the
   * published version have a pre-kick-off evaluation (D-031), the latest of each.
   */
  pairs: number;
  /** The published version(s) the pairs were scored against. */
  published_versions: string[];
  candidate: { log_loss: number; brier: number };
  published: { log_loss: number; brier: number };
}

/** One candidate's shadow record (T-1103), from the stored evaluations (T-066). */
export interface CandidateRecord {
  model_version: string;
  /**
   * Whether the model service offers it now: false for a candidate that has
   * left shadow but whose record stays; null when the service did not answer.
   */
  in_shadow: boolean | null;
  /** Pre-kick-off forecasts evaluated after the match: the count toward the minimum. */
  pre_kickoff_evaluated: number;
  /** Pre-kick-off forecasts whose match has not been evaluated yet. */
  pre_kickoff_awaiting: number;
  /** Available forecasts computed after kick-off: never counted (D-031). */
  after_kickoff: number;
  /** The candidate's own refusals (`unavailable`), which are never scored. */
  unavailable: number;
  competitions: CandidateCompetitionRecord[];
}

/** `GET /admin/model/candidates` (T-1103). Administrators only. */
export interface CandidateRecordsResponse {
  minimum: number;
  /** Whether the model service answered its candidate list. */
  service: 'answered' | 'unreachable';
  candidates: CandidateRecord[];
  generated_at: string;
}
