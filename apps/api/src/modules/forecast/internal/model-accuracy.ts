import {
  ACCURACY_MINIMUM_MATCHES,
  type AccuracyMetrics,
  type AccuracyPeriod,
  type AccuracyPoint,
  type AccuracyReference,
  type AdminAccuracySeries,
  type AdminModelAccuracyResponse,
  type CoverageState,
  type PublicAccuracySeries,
  type PublicModelAccuracyResponse,
} from '@fmip/contracts';
import { UNIFORM_ACCURACY, UNIFORM_BRIER, UNIFORM_LOG_LOSS } from './scoring';

/**
 * Model accuracy over time (T-1369, D-187), as pure arithmetic over the sums
 * `PostgresEvaluationStore.accuracySums` reads: one row per competition and
 * week or month (and, for the console, per model version and role). This
 * file adds them up into each series, overall and per competition, divides
 * once, and states each row's coverage from its match count. Nothing here
 * says which model is better: the console decides nothing (D-082).
 */

/** One group of pre-kick-off evaluations, summed (not averaged). */
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

/** The means, divided once; null figures when there is nothing to average. */
export function accuracyMetrics(sums: Sums): AccuracyMetrics {
  const n = sums.forecasts;
  const mean = (total: number, digits: number) => (n === 0 ? null : round(total / n, digits));
  return {
    forecasts: n,
    matches: sums.matches,
    coverage: accuracyCoverage(n === 0 ? 0 : sums.matches),
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
export function adminAccuracy(
  rows: readonly AccuracySumRow[],
  period: AccuracyPeriod,
  now: Date,
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
    out.push({ role, model_version: modelVersion, competition: null, ...series(own, period) });
    for (const group of competitionsOf(own)) {
      out.push({
        role,
        model_version: modelVersion,
        competition: group.competition,
        ...series(group.rows, period),
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

/**
 * The public page's figures (T-1369): published forecasts only, by month,
 * overall and for each competition the model has published a pre-kick-off
 * forecast for -- one with nothing evaluated yet is listed as `not_supplied`.
 */
export function publicAccuracy(
  rows: readonly AccuracySumRow[],
  forecastCompetitions: readonly { id: string; name: string }[],
): PublicModelAccuracyResponse {
  const published = rows.filter((row) => row.role === null || row.role === 'published');
  const grouped = new Map(competitionsOf(published).map((g) => [g.competition.id, g]));
  const named = new Map(forecastCompetitions.map((c) => [c.id, c]));
  for (const group of grouped.values()) named.set(group.competition.id, group.competition);

  const competitions: PublicAccuracySeries[] = [...named.values()].sort(byName).map((c) => {
    const own = grouped.get(c.id)?.rows ?? [];
    return { competition: c, model_versions: versionsOf(own), ...series(own, 'month') };
  });
  return {
    period: 'month',
    minimum_matches: ACCURACY_MINIMUM_MATCHES,
    reference: ACCURACY_REFERENCE,
    overall: {
      competition: null,
      model_versions: versionsOf(published),
      ...series(published, 'month'),
    },
    competitions,
    last_updated_at: lastEvaluated(published),
  };
}
