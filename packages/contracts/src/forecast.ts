/**
 * The internal contract between `apps/api` and the model service (T-063).
 *
 * The Pydantic twin is `apps/model/fmip_model/service/contract.py`; the two
 * change together, and the contract test in `apps/api` validates the
 * service's real output against these shapes. Nothing here is served to the
 * browser as-is: the forecast boundary (T-064) stores versions and exposes
 * its own shapes.
 */

export interface ModelForecastRequest {
  /** Catalog fixture UUID; echoed back, never interpreted by the model. */
  fixture_id: string;
  home_team_id: string;
  away_team_id: string;
  /** football-data.co.uk division code the fixture belongs to, e.g. `E0`. */
  division: string;
  /** ISO 8601 with zone. The model uses only history before this. */
  kickoff_at: string;
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
}
