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
  /** The ranked probability score (D-187): lower is better. */
  rps: ConsoleModelEstimate | null;
  /**
   * What a one-third guess scores in RPS on these same results: it depends
   * on how many of them were draws, so it is the sample's own, not a constant.
   */
  uniform_rps: number | null;
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

/** One version's record in one competition. */
export interface ConsoleModelCompetition {
  competition: { id: string; name: string };
  record: ConsoleModelRecord;
}

/**
 * What a version is now (T-1752, D-371): the one on the site, one the model
 * service runs in shadow (or, the service silent, one that stored a shadow
 * forecast in the last week), or neither any more.
 */
export type ConsoleModelVersionState = 'published_now' | 'shadow_now' | 'earlier';

/** What a version stored in one role, counted as forecasts, not matches. */
export interface ConsoleModelVersionCounts {
  /** Forecasts with probabilities. */
  forecasts: number;
  /** Computed before kick-off and scored against the result. */
  evaluated: number;
  /** Computed before kick-off, not scored yet: the match is not over, or not settled. */
  awaiting: number;
  /** Computed after kick-off: stored, never counted in any figure. */
  after_kickoff: number;
  /** Refusals: the version said it could not forecast the match. */
  unavailable: number;
}

/**
 * One model version in one role (T-1752, D-371): everything it stored and
 * what that scored, each match once by its last forecast before kick-off
 * (D-209). A version that was in shadow and then published is two of these.
 */
export interface ConsoleModelVersion {
  model_version: string;
  role: 'published' | 'shadow';
  state: ConsoleModelVersionState;
  first_forecast_at: string | null;
  last_forecast_at: string | null;
  counts: ConsoleModelVersionCounts;
  record: ConsoleModelRecord;
  calibration: ConsoleModelCalibrationBand[];
  /** By ISO week of kick-off (the console's accuracy series, T-1369), oldest first. */
  trend: AccuracyPoint[];
  /**
   * Ordered by log loss, best first; `limited` ones last. For a version in
   * shadow now each row is its count alone, by name: its new divisions' rows
   * would add up to the very figure D-336 judges once.
   */
  competitions: ConsoleModelCompetition[];
}

/** One side of a comparison, on the shared matches only. */
export interface ConsoleModelPairSide {
  log_loss: number;
  brier: number;
  rps: number;
  accuracy: number;
}

/** A comparison's figures: each side on the same matches, and the paired difference. */
export interface ConsoleModelPairFigures {
  subject: ConsoleModelPairSide;
  reference: ConsoleModelPairSide;
  /** Subject minus reference in log loss, per match, with its interval; negative is better. */
  difference: ConsoleModelEstimate;
}

/**
 * Two versions on the same matches (T-1752, D-371): a pair is a fixture both
 * scored before kick-off, each side by its last such forecast. `judging` is
 * a pair with a version in shadow now: its figures are never given here,
 * overall or per competition, only the counts toward its promotion rule's
 * 300 (D-082, D-139, D-336 and its one look); the verdict is the ledger's.
 * A `record` pair is history whose verdict was taken long ago; it shows
 * figures from `minimum_matches` on.
 */
export interface ConsoleModelComparison {
  subject: { model_version: string; role: 'published' | 'shadow' };
  reference: { model_version: string; role: 'published' | 'shadow' };
  kind: 'judging' | 'record';
  matches: number;
  /** Matches on which both gave exactly the same three probabilities. */
  identical: number;
  /** `record`: the count below which `figures` is null. `judging`: the count its verdict needs. */
  minimum: number;
  /** Always null for `judging`. */
  figures: ConsoleModelPairFigures | null;
  /** By shared matches, most first. Figures only where the pair has them and the competition has `minimum_matches`. */
  competitions: {
    competition: { id: string; name: string };
    matches: number;
    identical: number;
    figures: ConsoleModelPairFigures | null;
  }[];
}

/** The inputs a version can read, as data in the store (T-1752). */
export const CONSOLE_MODEL_INPUT_KEYS = [
  'results',
  'own_elo',
  'cross_league',
  'expected_goals',
  'lineups',
  'absences',
] as const;
export type ConsoleModelInputKey = (typeof CONSOLE_MODEL_INPUT_KEYS)[number];

/**
 * How much of one input the store holds now and how fresh it is (rules 3
 * and 4): counted, never estimated. `share` is the part of `of` that has
 * the input, where that is the honest way to state its coverage.
 */
export interface ConsoleModelInputState {
  key: ConsoleModelInputKey;
  coverage: CoverageState;
  /** Rows of the input: matches with a result, ratings, matches with xG, ... */
  count: number;
  /** What `count` is a part of (e.g. finished matches in the fit window), or null. */
  of: number | null;
  /** How many divisions or competitions it spans, or null where that is not counted. */
  groups: number | null;
  /** The newest row's own time (a kick-off, a rating date). */
  newest_at: string | null;
}

/**
 * A shadow version against the published one (D-082, D-140, D-336): how far
 * each of its promotion conditions' counts has come, and nothing else.
 * D-336's amendment (T-1720) gives each condition one look, taken by the
 * weekly watch; a page that recomputed the figures on every visit would be
 * a look on every visit, so this answer never carries them (T-1752, D-371).
 * The verdict, with the figures of the day it was taken, is the model lab
 * ledger's (`ConsoleModelLab.judgements`).
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
  };
  /** Matches it forecast that no published version did (its new divisions). */
  new_divisions: { matches: number };
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
  /**
   * Every version that stored a forecast, in each role (T-1752): the one on
   * the site first, then those in shadow now, then the earlier ones, newest
   * first. Calibration, trend and competitions are each version's own.
   */
  versions: ConsoleModelVersion[];
  /** Every two of them that scored the same matches, the pair with a shadow version now first. */
  comparisons: ConsoleModelComparison[];
  candidates: ConsoleModelCandidate[];
  /** What the store holds of each input now; empty when it could not be counted. */
  inputs: ConsoleModelInputState[];
  last_updated_at: string | null;
  generated_at: string;
}
