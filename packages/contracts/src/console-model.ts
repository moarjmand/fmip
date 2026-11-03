import type { CoverageState } from './coverage';
import type { AccuracyPoint, AccuracyReference } from './forecast';

/**
 * The agents console's forecast-model page (T-1729, D-355): what the
 * published model version is, what is in shadow, and how accurate the
 * published version is now -- every figure from the stored pre-kick-off
 * evaluations (T-066), each match counted once by its last forecast before
 * kick-off (D-209), with its sample beside it. Read-only, console session.
 */

/** The fewest paired matches a promotion is judged on (D-031, D-082, D-336 "no worse"). */
export const CONSOLE_MODEL_PAIRED_MINIMUM = 300;
/** The fewest new-division matches D-336's "better than chance" is judged on. */
export const CONSOLE_MODEL_NEW_DIVISIONS_MINIMUM = 100;
/** D-336: the paired log-loss interval's upper end may not pass this. */
export const CONSOLE_MODEL_NO_WORSE_MARGIN = 0.002;
/** A calibration band is drawn from this many forecasts (the model watch's rule). */
export const CONSOLE_MODEL_CALIBRATION_MINIMUM = 20;

/**
 * A mean with its 95% interval: normal (mean ± 1.96 sd/√n) for a score,
 * Wilson for a share. The bounds are null below two matches.
 */
export interface ConsoleModelEstimate {
  mean: number;
  low: number | null;
  high: number | null;
}

/** One model version's record over a set of matches. */
export interface ConsoleModelRecord {
  /** Distinct matches, each by its last pre-kick-off forecast (D-209). */
  matches: number;
  coverage: CoverageState;
  /** Null with no match. */
  log_loss: ConsoleModelEstimate | null;
  brier: ConsoleModelEstimate | null;
  /** Share of matches whose most probable outcome happened. */
  accuracy: ConsoleModelEstimate | null;
  /** The first and last kick-off counted: the window the figures are over. */
  first_kickoff_at: string | null;
  last_kickoff_at: string | null;
}

export type ConsoleModelOutcome = 'home' | 'draw' | 'away';

/**
 * One ten-point band of one outcome's forecast probability: how often the
 * outcome happened against how likely the model said it was.
 */
export interface ConsoleModelCalibrationBand {
  outcome: ConsoleModelOutcome;
  /** 0..9: forecasts from `band * 10`% up to `band * 10 + 10`%. */
  band: number;
  forecasts: number;
  /** The mean probability the model gave, 0..1. */
  said: number;
  /** The share that happened, with its Wilson interval. */
  seen: ConsoleModelEstimate;
}

/** The published version's record in one competition. */
export interface ConsoleModelCompetition {
  competition: { id: string; name: string };
  record: ConsoleModelRecord;
}

/**
 * A shadow version against the published one (D-082, D-140, D-336). Below
 * a count, only the count is given (D-336's amendment, T-1720: one look per
 * condition, taken by the weekly watch); the figures appear once it is
 * reached, and are never a verdict.
 */
export interface ConsoleModelCandidate {
  model_version: string;
  /** Listed by the model service now; null when the service did not answer. */
  in_service: boolean | null;
  first_forecast_at: string | null;
  last_forecast_at: string | null;
  /** On its own matches, which differ from the published version's. */
  own: ConsoleModelRecord;
  /** The same matches, each side by its last pre-kick-off forecast. */
  paired: {
    matches: number;
    /** Matches on which both forecast exactly the same. */
    identical: number;
    /** Null below `CONSOLE_MODEL_PAIRED_MINIMUM`. */
    figures: {
      published_log_loss: number;
      candidate_log_loss: number;
      published_brier: number;
      candidate_brier: number;
      /** Candidate minus published; negative is better. */
      difference: ConsoleModelEstimate;
    } | null;
  };
  /** Matches it forecast that no published version did (its new divisions). */
  new_divisions: {
    matches: number;
    /** Null below `CONSOLE_MODEL_NEW_DIVISIONS_MINIMUM`. */
    log_loss: ConsoleModelEstimate | null;
  };
}

/** `GET /console/model` (T-1729). */
export interface ConsoleModelReport {
  /** Whether the model service answered; when silent, the versions are read from the store. */
  service: 'answered' | 'unreachable';
  /** Null when no published forecast exists at all. */
  published: {
    model_version: string;
    /** Its first stored published forecast. */
    since: string | null;
    record: ConsoleModelRecord;
  } | null;
  reference: AccuracyReference;
  /** A competition row below this many matches is `limited` and shows its count only. */
  minimum_matches: number;
  calibration: ConsoleModelCalibrationBand[];
  /** The published version by ISO week (the console's accuracy series, T-1369), oldest first. */
  trend: AccuracyPoint[];
  /** Ordered by log loss, best first; `limited` and empty ones last. */
  competitions: ConsoleModelCompetition[];
  candidates: ConsoleModelCandidate[];
  last_updated_at: string | null;
  generated_at: string;
}
