import {
  ACCURACY_MINIMUM_MATCHES,
  CONSOLE_MODEL_NEW_DIVISIONS_MINIMUM,
  CONSOLE_MODEL_PAIRED_MINIMUM,
  type AccuracyPoint,
  type ConsoleModelCalibrationBand,
  type ConsoleModelCandidate,
  type ConsoleModelCompetition,
  type ConsoleModelEstimate,
  type ConsoleModelRecord,
  type ConsoleModelReport,
} from '@fmip/contracts';
import type { CalibrationRow, ModelRecordRow, PairedRow } from './evaluation-store';
import { ACCURACY_REFERENCE, accuracyCoverage } from './model-accuracy';

/**
 * The console's model page (T-1729, D-355), as pure arithmetic over the rows
 * `PostgresEvaluationStore` reads. The intervals are the model watch's
 * (`.claude/skills/model-watch/model-watch.sql`): normal for a mean score,
 * and for a share the Wilson interval, which stays inside 0..1 on a small
 * band. Nothing here judges a version: below D-336's counts only the count
 * is given (T-1720), and above them the figures are a record, not a verdict.
 */

const Z = 1.96;

const round = (value: number, digits: number): number => {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
};

/** A mean and its normal 95% interval; no bounds below two matches. */
export function normalEstimate(
  mean: number,
  sd: number | null,
  n: number,
  digits = 6,
): ConsoleModelEstimate {
  if (n < 2 || sd === null) return { mean: round(mean, digits), low: null, high: null };
  const half = (Z * sd) / Math.sqrt(n);
  return {
    mean: round(mean, digits),
    low: round(mean - half, digits),
    high: round(mean + half, digits),
  };
}

/** A share of `n` and its Wilson 95% interval; no bounds below two. */
export function wilsonEstimate(successes: number, n: number, digits = 4): ConsoleModelEstimate {
  const p = successes / n;
  if (n < 2) return { mean: round(p, digits), low: null, high: null };
  const z2 = Z * Z;
  const centre = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = (Z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
  return {
    mean: round(p, digits),
    low: round(Math.max(0, centre - half), digits),
    high: round(Math.min(1, centre + half), digits),
  };
}

export function modelRecord(row: ModelRecordRow | undefined): ConsoleModelRecord {
  const n = row?.matches ?? 0;
  if (row === undefined || n === 0) {
    return {
      matches: 0,
      coverage: accuracyCoverage(0),
      log_loss: null,
      brier: null,
      accuracy: null,
      first_kickoff_at: null,
      last_kickoff_at: null,
    };
  }
  return {
    matches: n,
    coverage: accuracyCoverage(n),
    log_loss: row.logLoss === null ? null : normalEstimate(row.logLoss, row.logLossSd, n),
    brier: row.brier === null ? null : normalEstimate(row.brier, row.brierSd, n),
    accuracy: wilsonEstimate(row.correct, n),
    first_kickoff_at: row.firstKickoffAt?.toISOString() ?? null,
    last_kickoff_at: row.lastKickoffAt?.toISOString() ?? null,
  };
}

export function calibrationBands(rows: readonly CalibrationRow[]): ConsoleModelCalibrationBand[] {
  const order = { home: 0, draw: 1, away: 2 } as const;
  return rows
    .filter((row) => row.forecasts > 0)
    .map((row) => ({
      outcome: row.outcome,
      band: row.band,
      forecasts: row.forecasts,
      said: round(row.said, 4),
      seen: wilsonEstimate(row.seen, row.forecasts),
    }))
    .sort((a, b) => order[a.outcome] - order[b.outcome] || a.band - b.band);
}

/**
 * Competitions best first by log loss; those under the minimum (their
 * figures rest on too few matches to rank) after, by name.
 */
export function competitionRecords(rows: readonly ModelRecordRow[]): ConsoleModelCompetition[] {
  const out = rows
    .filter((row) => row.competition !== null)
    .map((row) => ({
      competition: row.competition as { id: string; name: string },
      record: modelRecord(row),
    }));
  const ranked = (c: ConsoleModelCompetition) =>
    c.record.matches >= ACCURACY_MINIMUM_MATCHES && c.record.log_loss !== null;
  return [
    ...out
      .filter(ranked)
      .sort(
        (a, b) =>
          (a.record.log_loss?.mean ?? 0) - (b.record.log_loss?.mean ?? 0) ||
          a.competition.name.localeCompare(b.competition.name),
      ),
    ...out
      .filter((c) => !ranked(c))
      .sort((a, b) => a.competition.name.localeCompare(b.competition.name)),
  ];
}

export interface CandidateInput {
  modelVersion: string;
  inService: boolean | null;
  span: { first: Date | null; last: Date | null };
  own: ModelRecordRow | undefined;
  paired: PairedRow;
  newDivisions: ModelRecordRow;
}

/** One shadow version: the count alone below D-336's thresholds (T-1720), figures above. */
export function candidateRecord(input: CandidateInput): ConsoleModelCandidate {
  const { paired, newDivisions } = input;
  const pairedReached =
    paired.matches >= CONSOLE_MODEL_PAIRED_MINIMUM &&
    paired.difference !== null &&
    paired.publishedLogLoss !== null &&
    paired.candidateLogLoss !== null &&
    paired.publishedBrier !== null &&
    paired.candidateBrier !== null;
  const newReached =
    newDivisions.matches >= CONSOLE_MODEL_NEW_DIVISIONS_MINIMUM && newDivisions.logLoss !== null;
  return {
    model_version: input.modelVersion,
    in_service: input.inService,
    first_forecast_at: input.span.first?.toISOString() ?? null,
    last_forecast_at: input.span.last?.toISOString() ?? null,
    own: modelRecord(input.own),
    paired: {
      matches: paired.matches,
      identical: paired.identical,
      figures: pairedReached
        ? {
            published_log_loss: round(paired.publishedLogLoss as number, 6),
            candidate_log_loss: round(paired.candidateLogLoss as number, 6),
            published_brier: round(paired.publishedBrier as number, 6),
            candidate_brier: round(paired.candidateBrier as number, 6),
            difference: normalEstimate(
              paired.difference as number,
              paired.differenceSd,
              paired.matches,
            ),
          }
        : null,
    },
    new_divisions: {
      matches: newDivisions.matches,
      log_loss: newReached
        ? normalEstimate(
            newDivisions.logLoss as number,
            newDivisions.logLossSd,
            newDivisions.matches,
          )
        : null,
    },
  };
}

export interface ReportInput {
  service: 'answered' | 'unreachable';
  published: {
    modelVersion: string;
    since: Date | null;
    records: readonly ModelRecordRow[];
    calibration: readonly CalibrationRow[];
    trend: readonly AccuracyPoint[];
  } | null;
  candidates: readonly CandidateInput[];
  now: Date;
}

export function consoleModelReport(input: ReportInput): ConsoleModelReport {
  const published = input.published;
  const overall = published?.records.find((row) => row.competition === null);
  return {
    service: input.service,
    published:
      published === null
        ? null
        : {
            model_version: published.modelVersion,
            since: published.since?.toISOString() ?? null,
            record: modelRecord(overall),
          },
    reference: ACCURACY_REFERENCE,
    minimum_matches: ACCURACY_MINIMUM_MATCHES,
    calibration: published === null ? [] : calibrationBands(published.calibration),
    trend: published === null ? [] : [...published.trend],
    competitions: published === null ? [] : competitionRecords(published.records),
    candidates: input.candidates.map(candidateRecord),
    last_updated_at: overall?.lastEvaluatedAt?.toISOString() ?? null,
    generated_at: input.now.toISOString(),
  };
}
