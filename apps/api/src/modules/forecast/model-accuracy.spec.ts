import { describe, expect, it } from 'vitest';
import {
  type AccuracySumRow,
  accuracyCoverage,
  accuracyMetrics,
  adminAccuracy,
  calibrationOf,
  isoWeekLabel,
  periodComplete,
  periodEnd,
  periodLabel,
  publicAccuracy,
} from './internal/model-accuracy';
import type { CalibrationSumRow } from './internal/evaluation-store';

/**
 * Accuracy over time (T-1369, D-187), as arithmetic: the sums the store reads
 * added up per period and in total, divided once, and each row's coverage
 * read from its match count.
 */
const PL = { id: 'c-pl', name: 'Premier League' };
const LL = { id: 'c-ll', name: 'La Liga' };

function row(overrides: Partial<AccuracySumRow>): AccuracySumRow {
  return {
    role: 'published',
    modelVersion: 'dixon-coles-elo@0.1.0',
    modelVersions: ['dixon-coles-elo@0.1.0'],
    competition: PL,
    periodStart: '2026-10-05',
    forecasts: 3,
    matches: 2,
    logLoss: 2,
    brier: 1.2,
    rps: 0.4,
    uniformRps: 0.555556,
    correct: 1,
    lastEvaluatedAt: new Date('2026-10-06T00:00:00Z'),
    ...overrides,
  };
}

describe('isoWeekLabel', () => {
  it('names the ISO week a Monday starts', () => {
    expect(isoWeekLabel('2026-10-05')).toBe('2026-W41');
    expect(isoWeekLabel('2026-01-05')).toBe('2026-W02');
    expect(isoWeekLabel('2025-12-29')).toBe('2026-W01');
  });

  it('gives a week to the year its Thursday is in', () => {
    expect(isoWeekLabel('2024-12-30')).toBe('2025-W01');
    expect(isoWeekLabel('2020-12-28')).toBe('2020-W53');
  });

  it('names a month by its first day', () => {
    expect(periodLabel('2026-10-01', 'month')).toBe('2026-10');
    expect(periodLabel('2031-02-24', 'week')).toBe('2031-W09');
  });
});

describe('accuracyCoverage', () => {
  it('is not_supplied with no match, limited below 30, available from 30', () => {
    expect(accuracyCoverage(0)).toBe('not_supplied');
    expect(accuracyCoverage(1)).toBe('limited');
    expect(accuracyCoverage(29)).toBe('limited');
    expect(accuracyCoverage(30)).toBe('available');
  });
});

describe('accuracyMetrics', () => {
  it('divides the sums by the matches, each counted once (D-209)', () => {
    expect(accuracyMetrics(row({}))).toEqual({
      forecasts: 3,
      matches: 2,
      coverage: 'limited',
      log_loss: 1,
      brier: 0.6,
      rps: 0.2,
      accuracy: 0.5,
      uniform_rps: 0.277778,
    });
  });

  it("gives a share the match count can make: 5 of La Liga's 7, never 65.0% of 7", () => {
    // The week the audit saw (T-1394): 7 matches, 20 pre-kick-off versions
    // of them scored, 13 of the versions right but 5 of the matches' own
    // forecasts. The share is of the matches it sits beside.
    const laLiga = accuracyMetrics({
      forecasts: 20,
      matches: 7,
      logLoss: 5.306,
      brier: 2.975,
      rps: 0.833,
      uniformRps: 1.596,
      correct: 5,
    });
    expect(laLiga).toMatchObject({ forecasts: 20, matches: 7, coverage: 'limited' });
    expect(laLiga.accuracy).toBe(0.7143);
    expect(laLiga.rps).toBe(0.119);
    // Every share of 7 is a multiple of 1/7: 0.7143 is 5/7, rounded.
    expect(Math.round((laLiga.accuracy ?? 0) * 7)).toBe(5);
    expect(Math.abs((laLiga.accuracy ?? 0) * 7 - 5)).toBeLessThan(0.001);
  });

  it('shows no figure at all when nothing was evaluated (rule 3)', () => {
    const none = accuracyMetrics({
      forecasts: 0,
      matches: 0,
      logLoss: 0,
      brier: 0,
      rps: 0,
      uniformRps: 0,
      correct: 0,
    });
    expect(none).toMatchObject({ coverage: 'not_supplied', log_loss: null, rps: null });
    expect(none.accuracy).toBeNull();
  });
});

describe('adminAccuracy', () => {
  const rows = [
    row({}),
    // The same week in another competition: added into the overall point.
    row({ competition: LL, forecasts: 1, matches: 1, logLoss: 0.5, rps: 0.1, correct: 1 }),
    row({ periodStart: '2026-10-12', forecasts: 1, matches: 1, logLoss: 1.5, correct: 0 }),
    row({
      role: 'shadow',
      modelVersion: 'dixon-coles-elo@0.5.0',
      modelVersions: ['dixon-coles-elo@0.5.0'],
      lastEvaluatedAt: new Date('2026-10-20T00:00:00Z'),
    }),
  ];
  const out = adminAccuracy(rows, 'week', new Date('2026-10-21T00:00:00Z'));

  it('gives a shadow version being judged counts only, overall and per competition (T-1771)', () => {
    const judged = adminAccuracy(
      rows,
      'week',
      new Date('2026-10-21T00:00:00Z'),
      new Set(['dixon-coles-elo@0.5.0']),
    );
    const shadow = judged.series.filter((s) => s.role === 'shadow');
    expect(shadow).toHaveLength(2);
    for (const s of shadow) {
      expect(s.withheld).toBe(true);
      expect(s.total).toMatchObject({ log_loss: null, brier: null, rps: null, accuracy: null });
      expect(s.total.matches).toBeGreaterThan(0);
      for (const p of s.points) expect(p.log_loss).toBeNull();
    }
    // The published series are untouched.
    expect(judged.series[0]?.withheld).toBeUndefined();
    expect(judged.series[0]?.total.log_loss).toBe(1);
  });

  it('puts published first, each version overall and then per competition by name', () => {
    expect(
      out.series.map((s) => [s.role, s.model_version, s.competition?.name ?? 'overall']),
    ).toEqual([
      ['published', 'dixon-coles-elo@0.1.0', 'overall'],
      ['published', 'dixon-coles-elo@0.1.0', 'La Liga'],
      ['published', 'dixon-coles-elo@0.1.0', 'Premier League'],
      ['shadow', 'dixon-coles-elo@0.5.0', 'overall'],
      ['shadow', 'dixon-coles-elo@0.5.0', 'Premier League'],
    ]);
    expect(out.last_updated_at).toBe('2026-10-20T00:00:00.000Z');
    expect(out.minimum_matches).toBe(30);
    expect(out.reference).toEqual({
      uniform_log_loss: 1.098612,
      uniform_brier: 0.666667,
      uniform_accuracy: 0.333333,
    });
  });

  it('adds competitions into the week, and weeks into the total, without averaging averages', () => {
    const overall = out.series[0];
    expect(overall?.points.map((p) => [p.period, p.period_start, p.forecasts, p.matches])).toEqual([
      ['2026-W41', '2026-10-05', 4, 3],
      ['2026-W42', '2026-10-12', 1, 1],
    ]);
    // (2 + 0.5) / 3 matches, not the mean of 1 and 0.5.
    expect(overall?.points[0]?.log_loss).toBe(0.833333);
    expect(overall?.points[0]?.accuracy).toBe(0.6667);
    expect(overall?.total).toMatchObject({ forecasts: 5, matches: 4, log_loss: 1, accuracy: 0.5 });
    expect(overall?.total.coverage).toBe('limited');
  });

  it('keeps the shadow version out of the published series', () => {
    expect(out.series[0]?.total.forecasts).toBe(5);
    expect(out.series[3]?.total.forecasts).toBe(3);
  });
});

describe('publicAccuracy', () => {
  it('lists every forecast competition, one with nothing evaluated as not_supplied', () => {
    const serie = { id: 'c-sa', name: 'Serie A' };
    const out = publicAccuracy(
      [
        row({ role: null, modelVersion: null, periodStart: '2026-10-01' }),
        row({
          role: null,
          modelVersion: null,
          periodStart: '2026-11-01',
          modelVersions: ['dixon-coles-elo@0.2.0'],
        }),
      ],
      [PL, serie],
    );
    expect(out.period).toBe('month');
    expect(out.competitions.map((c) => [c.competition?.name, c.total.coverage])).toEqual([
      ['Premier League', 'limited'],
      ['Serie A', 'not_supplied'],
    ]);
    expect(out.competitions[1]?.points).toEqual([]);
    expect(out.competitions[1]?.total.rps).toBeNull();
    expect(out.overall.model_versions).toEqual(['dixon-coles-elo@0.1.0', 'dixon-coles-elo@0.2.0']);
    expect(out.overall.points.map((p) => p.period)).toEqual(['2026-10', '2026-11']);
  });

  it('buckets by ISO week when asked (T-1413)', () => {
    const out = publicAccuracy(
      [
        row({ role: null, modelVersion: null, periodStart: '2026-10-05' }),
        row({ role: null, modelVersion: null, periodStart: '2026-10-12' }),
      ],
      [PL],
      'week',
    );
    expect(out.period).toBe('week');
    expect(out.overall.points.map((p) => [p.period, p.period_start])).toEqual([
      ['2026-W41', '2026-10-05'],
      ['2026-W42', '2026-10-12'],
    ]);
    expect(out.competitions[0]?.points.map((p) => p.period)).toEqual(['2026-W41', '2026-W42']);
  });

  it('never counts a shadow row, and says not_supplied with nothing at all', () => {
    const out = publicAccuracy([row({ role: 'shadow' })], []);
    expect(out.overall.total.coverage).toBe('not_supplied');
    expect(out.overall.model_versions).toEqual([]);
    expect(out.competitions).toEqual([]);
    expect(out.last_updated_at).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// T-1751 (D-370, D-408): calibration, each version on its own, the period's end
// ---------------------------------------------------------------------------

const OLD = 'dixon-coles-elo@0.1.0';
const NEW = 'dixon-coles-elo@0.6.0';
const NOW = new Date('2026-11-13T12:00:00Z');

const cal = (modelVersion: string, bin: number, forecasts: number, happened: number) =>
  ({
    modelVersion,
    bin,
    forecasts,
    happened,
    said: (forecasts * (bin + 0.5)) / 10,
  }) satisfies CalibrationSumRow;

describe('calibrationOf', () => {
  it('always gives ten steps of ten points, a step with nothing at zero and no mean', () => {
    const out = calibrationOf([cal(OLD, 6, 40, 25), cal(NEW, 6, 10, 7), cal(OLD, 9, 3, 3)]);
    expect(out.bins).toHaveLength(10);
    expect(out.bins.map((b) => [b.from, b.to])).toEqual(
      Array.from({ length: 10 }, (_, i) => [i / 10, (i + 1) / 10]),
    );
    // Two versions' sums in one step: added, then divided once.
    expect(out.bins[6]).toEqual({ from: 0.6, to: 0.7, forecasts: 50, happened: 32, said: 0.65 });
    expect(out.bins[9]).toMatchObject({ forecasts: 3, happened: 3, said: 0.95 });
    expect(out.bins[0]).toEqual({ from: 0, to: 0.1, forecasts: 0, happened: 0, said: null });
    expect(out.minimum_forecasts).toBe(30);
    expect(out.coverage).toBe('available');
  });

  it('is limited when no step reaches the minimum, not_supplied with nothing (rule 3)', () => {
    expect(calibrationOf([cal(OLD, 3, 29, 9), cal(OLD, 5, 12, 6)]).coverage).toBe('limited');
    expect(calibrationOf([cal(OLD, 3, 30, 9)]).coverage).toBe('available');
    const none = calibrationOf([]);
    expect(none.coverage).toBe('not_supplied');
    expect(none.bins.every((b) => b.forecasts === 0 && b.said === null)).toBe(true);
  });
});

describe('the period end and whether it is over', () => {
  it('ends a week seven days on and a month on the first of the next, UTC', () => {
    expect(periodEnd('2026-11-09', 'week')).toBe('2026-11-16');
    expect(periodEnd('2026-12-28', 'week')).toBe('2027-01-04');
    expect(periodEnd('2026-11-01', 'month')).toBe('2026-12-01');
    expect(periodEnd('2026-12-01', 'month')).toBe('2027-01-01');
    expect(periodEnd('2028-01-01', 'month')).toBe('2028-02-01');
  });

  it('is complete once the end has passed and no match of it waits for its score', () => {
    const none = new Set<string>();
    expect(periodComplete('2026-11-09', 'week', NOW, none)).toBe(false); // running
    expect(periodComplete('2026-11-02', 'week', NOW, none)).toBe(true);
    // A Sunday-night match still unscored keeps last week running past midnight.
    expect(periodComplete('2026-11-02', 'week', NOW, new Set(['2026-11-02']))).toBe(false);
    expect(periodComplete('2026-11-02', 'week', new Date('2026-11-09T00:00:00Z'), none)).toBe(true);
    expect(periodComplete('2026-11-02', 'week', new Date('2026-11-08T23:59:59Z'), none)).toBe(
      false,
    );
  });
});

describe('publicAccuracy, step two (T-1751)', () => {
  const rows = [
    row({ role: null, modelVersion: OLD, periodStart: '2026-10-26', matches: 20, forecasts: 25 }),
    row({ role: null, modelVersion: NEW, periodStart: '2026-11-02', matches: 31, forecasts: 31 }),
    row({
      role: null,
      modelVersion: NEW,
      competition: LL,
      periodStart: '2026-11-09',
      matches: 4,
      forecasts: 4,
    }),
  ];
  const out = publicAccuracy(rows, [PL, LL], 'week', {
    calibration: [cal(OLD, 4, 60, 20), cal(NEW, 4, 93, 40), cal(NEW, 8, 12, 10)],
    pending: [{ competitionId: PL.id, periodStart: '2026-11-02' }],
    now: NOW,
  });

  it('gives each published version on its own, the latest first, adding up to the whole', () => {
    expect(out.versions.map((v) => [v.model_version, v.total.matches, v.total.coverage])).toEqual([
      [NEW, 35, 'available'],
      [OLD, 20, 'limited'],
    ]);
    expect(out.versions.reduce((sum, v) => sum + v.total.matches, 0)).toBe(
      out.overall.total.matches,
    );
    expect(out.versions[0]?.points.map((p) => p.period)).toEqual(['2026-W45', '2026-W46']);
  });

  it('gives each version its own calibration, and the overall one their sum', () => {
    expect(out.versions[0]?.calibration?.bins[4]).toMatchObject({ forecasts: 93, happened: 40 });
    expect(out.versions[1]?.calibration?.bins[4]).toMatchObject({ forecasts: 60, happened: 20 });
    expect(out.versions[1]?.calibration?.bins[8]?.forecasts).toBe(0);
    expect(out.overall.calibration?.bins[4]).toMatchObject({ forecasts: 153, happened: 60 });
    expect(out.overall.calibration?.bins[8]).toMatchObject({ forecasts: 12, happened: 10 });
    expect(out.overall.calibration?.coverage).toBe('available');
  });

  it('marks each point with its end and whether it is over, per competition', () => {
    expect(out.overall.points.map((p) => [p.period_start, p.period_end, p.complete])).toEqual([
      ['2026-10-26', '2026-11-02', true],
      ['2026-11-02', '2026-11-09', false], // a Premier League match waits for its score
      ['2026-11-09', '2026-11-16', false], // still running
    ]);
    const pl = out.competitions.find((c) => c.competition?.id === PL.id);
    const ll = out.competitions.find((c) => c.competition?.id === LL.id);
    expect(pl?.points.map((p) => p.complete)).toEqual([true, false]);
    expect(ll?.points.map((p) => p.complete)).toEqual([false]);
  });

  it('never gives a shadow version a series or a calibration of its own (D9)', () => {
    const withShadow = publicAccuracy(
      [...rows, row({ role: 'shadow', modelVersion: 'dixon-coles-elo@0.7.0', matches: 99 })],
      [PL, LL],
      'week',
      { calibration: [], pending: [], now: NOW },
    );
    expect(withShadow.versions.map((v) => v.model_version)).toEqual([NEW, OLD]);
    expect(withShadow.overall.total.matches).toBe(55);
  });

  it('says not_supplied with nothing, with no version and an empty calibration', () => {
    const empty = publicAccuracy([], [], 'month', { calibration: [], pending: [], now: NOW });
    expect(empty.versions).toEqual([]);
    expect(empty.overall.calibration?.coverage).toBe('not_supplied');
  });

  it('leaves the calibration out, overall and per version, when it was not read', () => {
    const omitted = publicAccuracy(rows, [PL, LL], 'week', {
      calibration: null,
      pending: [],
      now: NOW,
    });
    expect(omitted.overall).not.toHaveProperty('calibration');
    expect(omitted.versions.map((v) => 'calibration' in v)).toEqual([false, false]);
    // Everything else is the answer it would have been.
    expect(omitted.versions.map((v) => v.total.matches)).toEqual([35, 20]);
  });

  it('orders versions with the same latest period by their number, newest first', () => {
    const tie = publicAccuracy(
      ['m@1.9.0', 'm@1.10.0', 'm@1.2.0'].map((modelVersion) =>
        row({ role: null, modelVersion, periodStart: '2026-11-02' }),
      ),
      [PL],
      'week',
      { calibration: null, pending: [], now: NOW },
    );
    expect(tie.versions.map((v) => v.model_version)).toEqual(['m@1.10.0', 'm@1.9.0', 'm@1.2.0']);
  });
});
