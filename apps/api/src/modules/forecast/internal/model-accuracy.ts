import {
  ACCURACY_MINIMUM_MATCHES,
  CALIBRATION_MINIMUM_FORECASTS,
  CALIBRATION_STEPS,
  type AccuracyCalibration,
  type AccuracyMetrics,
  type AccuracyPeriod,
  type AccuracyPoint,
  type AccuracyReference,
  type AdminAccuracySeries,
  type AdminModelAccuracyResponse,
  type CalibrationBin,
  type CoverageState,
  type PublicAccuracyPoint,
  type PublicAccuracySeries,
  type PublicModelAccuracyResponse,
  type PublicVersionSeries,
} from '@fmip/contracts';
import type { CalibrationSumRow } from './evaluation-store';
import { UNIFORM_ACCURACY, UNIFORM_BRIER, UNIFORM_LOG_LOSS } from './scoring';

/**
 * Model accuracy over time (T-1369, D-187), as pure arithmetic over the sums
 * `PostgresEvaluationStore.accuracySums` reads: one row per competition and
 * week or month (and, for the console, per model version and role). This
 * file adds them up into each series, overall and per competition, divides
 * once, and states each row's coverage from its match count. Nothing here
 * says which model is better: the console decides nothing (D-082).
 */

/**
 * One group of pre-kick-off evaluations, summed (not averaged): every sum is
 * over each match's own forecast (one per match), `forecasts` counts every
 * version (D-209).
 */
export interface AccuracySumRow {
  /** Null on the public read, which takes every published version together. */
  role: 'published' | 'shadow' | null;
  modelVersion: string | null;
  modelVersions: string[];
  competition: { id: string; name: string };
  /** The period's first day, `YYYY-MM-DD`, UTC. */
  periodStart: string;
  forecasts: number;
  matches: number;
  logLoss: number;
  brier: number;
  rps: number;
  uniformRps: number;
  correct: number;
  lastEvaluatedAt: Date;
}

type Sums = Pick<
  AccuracySumRow,
  'forecasts' | 'matches' | 'logLoss' | 'brier' | 'rps' | 'uniformRps' | 'correct'
>;

const ZERO: Sums = {
  forecasts: 0,
  matches: 0,
  logLoss: 0,
  brier: 0,
  rps: 0,
  uniformRps: 0,
  correct: 0,
};

const add = (a: Sums, b: Sums): Sums => ({
  forecasts: a.forecasts + b.forecasts,
  matches: a.matches + b.matches,
  logLoss: a.logLoss + b.logLoss,
  brier: a.brier + b.brier,
  rps: a.rps + b.rps,
  uniformRps: a.uniformRps + b.uniformRps,
  correct: a.correct + b.correct,
});

const round = (value: number, digits: number): number => {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
};

export const ACCURACY_REFERENCE: AccuracyReference = {
  uniform_log_loss: UNIFORM_LOG_LOSS,
  uniform_brier: UNIFORM_BRIER,
  uniform_accuracy: UNIFORM_ACCURACY,
};

/** `not_supplied` with no match, `limited` below the minimum, else `available` (rule 3). */
export function accuracyCoverage(matches: number): CoverageState {
  if (matches <= 0) return 'not_supplied';
  return matches < ACCURACY_MINIMUM_MATCHES ? 'limited' : 'available';
}

/**
 * The means, divided once by the matches; null figures when there is nothing
 * to average. The sums are each match's own forecast only (D-209), so the
 * sample a figure is over is the count shown beside it.
 */
export function accuracyMetrics(sums: Sums): AccuracyMetrics {
  const n = sums.matches;
  const mean = (total: number, digits: number) => (n === 0 ? null : round(total / n, digits));
  return {
    forecasts: sums.forecasts,
    matches: n,
    coverage: accuracyCoverage(n),
    log_loss: mean(sums.logLoss, 6),
    brier: mean(sums.brier, 6),
    rps: mean(sums.rps, 6),
    accuracy: mean(sums.correct, 4),
    uniform_rps: mean(sums.uniformRps, 6),
  };
}

/**
 * The ISO 8601 week a Monday starts, `2026-W41`: the week belongs to the
 * year its Thursday is in, so 2024-12-30 starts `2025-W01`.
 */
export function isoWeekLabel(monday: string): string {
  const thursday = new Date(`${monday}T00:00:00Z`);
  thursday.setUTCDate(thursday.getUTCDate() + 3);
  const year = thursday.getUTCFullYear();
  const dayOfYear = Math.floor((thursday.getTime() - Date.UTC(year, 0, 1)) / 86_400_000);
  const week = Math.floor(dayOfYear / 7) + 1;
  return `${year}-W${String(week).padStart(2, '0')}`;
}

export function periodLabel(periodStart: string, period: AccuracyPeriod): string {
  return period === 'week' ? isoWeekLabel(periodStart) : periodStart.slice(0, 7);
}

/** Rows of one series, summed per period (oldest first) and in total. */
function series(rows: readonly AccuracySumRow[], period: AccuracyPeriod) {
  const byPeriod = new Map<string, Sums>();
  let total = ZERO;
  for (const row of rows) {
    byPeriod.set(row.periodStart, add(byPeriod.get(row.periodStart) ?? ZERO, row));
    total = add(total, row);
  }
  const points: AccuracyPoint[] = [...byPeriod.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([start, sums]) => ({
      period: periodLabel(start, period),
      period_start: start,
      ...accuracyMetrics(sums),
    }));
  return { total: accuracyMetrics(total), points };
}

function lastEvaluated(rows: readonly AccuracySumRow[]): string | null {
  let last: Date | null = null;
  for (const row of rows)
    if (last === null || row.lastEvaluatedAt > last) last = row.lastEvaluatedAt;
  return last?.toISOString() ?? null;
}

const byName = (a: { name: string; id: string }, b: { name: string; id: string }) =>
  a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

/** Rows grouped by competition id, the competitions in name order. */
function competitionsOf(rows: readonly AccuracySumRow[]) {
  const groups = new Map<
    string,
    { competition: { id: string; name: string }; rows: AccuracySumRow[] }
  >();
  for (const row of rows) {
    const group = groups.get(row.competition.id) ?? { competition: row.competition, rows: [] };
    group.rows.push(row);
    groups.set(row.competition.id, group);
  }
  return [...groups.values()].sort((a, b) => byName(a.competition, b.competition));
}

/**
 * The console's series (T-1369): every model version in each role it was
 * stored under -- published first, then shadow -- each overall and then per
 * competition.
 */
/** Counts only: the metrics of a version being judged (T-1771). */
const countsOnly = (m: AccuracyMetrics): AccuracyMetrics => ({
  ...m,
  log_loss: null,
  brier: null,
  rps: null,
  accuracy: null,
  uniform_rps: null,
});

export function adminAccuracy(
  rows: readonly AccuracySumRow[],
  period: AccuracyPeriod,
  now: Date,
  /** Shadow versions being judged: their series give counts only (T-1771, D-380). */
  withheld: ReadonlySet<string> = new Set(),
): AdminModelAccuracyResponse {
  const models = new Map<string, AccuracySumRow[]>();
  for (const row of rows) {
    if (row.role === null || row.modelVersion === null) continue;
    const key = `${row.role}\u0000${row.modelVersion}`;
    models.set(key, [...(models.get(key) ?? []), row]);
  }
  const order = (key: string) => (key.startsWith('published') ? 0 : 1);
  const out: AdminAccuracySeries[] = [];
  for (const key of [...models.keys()].sort((a, b) => order(a) - order(b) || a.localeCompare(b))) {
    const own = models.get(key) ?? [];
    const [role, modelVersion] = key.split('\u0000') as ['published' | 'shadow', string];
    const hide = role === 'shadow' && withheld.has(modelVersion);
    const shown = (s: ReturnType<typeof series>) =>
      hide
        ? {
            total: countsOnly(s.total),
            points: s.points.map((p) => ({ ...p, ...countsOnly(p) })),
            withheld: true,
          }
        : s;
    out.push({
      role,
      model_version: modelVersion,
      competition: null,
      ...shown(series(own, period)),
    });
    for (const group of competitionsOf(own)) {
      out.push({
        role,
        model_version: modelVersion,
        competition: group.competition,
        ...shown(series(group.rows, period)),
      });
    }
  }
  return {
    period,
    minimum_matches: ACCURACY_MINIMUM_MATCHES,
    reference: ACCURACY_REFERENCE,
    series: out,
    last_updated_at: lastEvaluated(rows),
    generated_at: now.toISOString(),
  };
}

const versionsOf = (rows: readonly AccuracySumRow[]): string[] =>
  [...new Set(rows.flatMap((row) => row.modelVersions))].sort();

/** The first day after a week or month, `YYYY-MM-DD` (UTC): its end, exclusive. */
export function periodEnd(periodStart: string, period: AccuracyPeriod): string {
  const day = new Date(`${periodStart}T00:00:00Z`);
  if (period === 'week') day.setUTCDate(day.getUTCDate() + 7);
  else day.setUTCMonth(day.getUTCMonth() + 1, 1);
  return day.toISOString().slice(0, 10);
}

/**
 * A week or month is complete once its end has passed and none of its
 * matches is still waiting for a score (T-1751, D-408): `waiting` holds the
 * period starts with such a match (`PostgresEvaluationStore.pendingPeriods`).
 */
export function periodComplete(
  periodStart: string,
  period: AccuracyPeriod,
  now: Date,
  waiting: ReadonlySet<string>,
): boolean {
  const end = Date.parse(`${periodEnd(periodStart, period)}T00:00:00Z`);
  return now.getTime() >= end && !waiting.has(periodStart);
}

/** A series' points with their ends and whether each is over. */
function publicSeries(
  rows: readonly AccuracySumRow[],
  period: AccuracyPeriod,
  now: Date,
  waiting: ReadonlySet<string>,
): { total: AccuracyMetrics; points: PublicAccuracyPoint[] } {
  const own = series(rows, period);
  return {
    total: own.total,
    points: own.points.map((point) => ({
      ...point,
      period_end: periodEnd(point.period_start, period),
      complete: periodComplete(point.period_start, period, now, waiting),
    })),
  };
}

/**
 * The calibration of a set of sums (T-1751, D-408): always ten steps, a step
 * with no forecast at zero with no mean. `available` when a step reaches the
 * minimum, `limited` when none does, `not_supplied` with no forecast at all.
 */
export function calibrationOf(rows: readonly CalibrationSumRow[]): AccuracyCalibration {
  const sums = Array.from({ length: CALIBRATION_STEPS }, () => ({
    forecasts: 0,
    happened: 0,
    said: 0,
  }));
  for (const row of rows) {
    const step = sums[Math.min(Math.max(row.bin, 0), CALIBRATION_STEPS - 1)];
    if (step === undefined) continue;
    step.forecasts += row.forecasts;
    step.happened += row.happened;
    step.said += row.said;
  }
  const bins: CalibrationBin[] = sums.map((step, index) => ({
    from: index / CALIBRATION_STEPS,
    to: (index + 1) / CALIBRATION_STEPS,
    forecasts: step.forecasts,
    happened: step.happened,
    said: step.forecasts === 0 ? null : round(step.said / step.forecasts, 4),
  }));
  const forecasts = bins.reduce((sum, bin) => sum + bin.forecasts, 0);
  const coverage: CoverageState =
    forecasts === 0
      ? 'not_supplied'
      : bins.some((bin) => bin.forecasts >= CALIBRATION_MINIMUM_FORECASTS)
        ? 'available'
        : 'limited';
  return { minimum_forecasts: CALIBRATION_MINIMUM_FORECASTS, coverage, bins };
}

/** What the public answer reads besides the accuracy sums (T-1751). */
export interface PublicAccuracyExtras {
  /**
   * The calibration sums, per published version; null when the request left
   * the calibration out (`calibration=omit`), and then the answer has none.
   */
  calibration: readonly CalibrationSumRow[] | null;
  /** The periods with a match still waiting for its score, per competition. */
  pending: readonly { competitionId: string; periodStart: string }[];
  now: Date;
}

// Without the time, no period can be shown to be over: every one is running.
const NO_EXTRAS: PublicAccuracyExtras = { calibration: [], pending: [], now: new Date(0) };

/**
 * The public page's figures (T-1369): published forecasts only, by month,
 * overall and for each competition the model has published a pre-kick-off
 * forecast for -- one with nothing evaluated yet is listed as `not_supplied`.
 * T-1751 (D-370, D-408): the overall calibration, each published version on
 * its own (a match under the version of its counted forecast, with that
 * version's calibration), and whether each period is over.
 */
export function publicAccuracy(
  rows: readonly AccuracySumRow[],
  forecastCompetitions: readonly { id: string; name: string }[],
  period: AccuracyPeriod = 'month',
  extras: PublicAccuracyExtras = NO_EXTRAS,
): PublicModelAccuracyResponse {
  const published = rows.filter((row) => row.role === null || row.role === 'published');
  const grouped = new Map(competitionsOf(published).map((g) => [g.competition.id, g]));
  const named = new Map(forecastCompetitions.map((c) => [c.id, c]));
  for (const group of grouped.values()) named.set(group.competition.id, group.competition);

  const { now, calibration } = extras;
  const anyWaiting = new Set(extras.pending.map((p) => p.periodStart));
  const waitingIn = (competitionId: string) =>
    new Set(
      extras.pending.filter((p) => p.competitionId === competitionId).map((p) => p.periodStart),
    );

  const competitions: PublicAccuracySeries[] = [...named.values()].sort(byName).map((c) => {
    const own = grouped.get(c.id)?.rows ?? [];
    return {
      competition: c,
      model_versions: versionsOf(own),
      ...publicSeries(own, period, now, waitingIn(c.id)),
    };
  });

  // Each published version on its own: the rows are already grouped by the
  // version of each match's counted forecast. A row without one (a shadow's,
  // which `published` has dropped, or a caller that did not split) is not here.
  const byVersion = new Map<string, AccuracySumRow[]>();
  for (const row of published) {
    if (row.modelVersion === null) continue;
    byVersion.set(row.modelVersion, [...(byVersion.get(row.modelVersion) ?? []), row]);
  }
  const latest = (own: readonly AccuracySumRow[]) =>
    own.reduce((last, row) => (row.periodStart > last ? row.periodStart : last), '');
  const versions: PublicVersionSeries[] = [...byVersion.entries()]
    // Latest kick-off first; a tie by the version's own number, newest first
    // ("1.10.0" after "1.9.0", not before it).
    .sort(
      ([a, ownA], [b, ownB]) =>
        latest(ownB).localeCompare(latest(ownA)) || b.localeCompare(a, 'en', { numeric: true }),
    )
    .map(([version, own]) => ({
      model_version: version,
      ...publicSeries(own, period, now, anyWaiting),
      ...(calibration === null
        ? {}
        : { calibration: calibrationOf(calibration.filter((r) => r.modelVersion === version)) }),
    }));

  return {
    period,
    minimum_matches: ACCURACY_MINIMUM_MATCHES,
    reference: ACCURACY_REFERENCE,
    overall: {
      competition: null,
      model_versions: versionsOf(published),
      ...publicSeries(published, period, now, anyWaiting),
      // The store reads published forecasts only: every row is a published version's.
      ...(calibration === null ? {} : { calibration: calibrationOf(calibration) }),
    },
    competitions,
    versions,
    last_updated_at: lastEvaluated(published),
  };
}
