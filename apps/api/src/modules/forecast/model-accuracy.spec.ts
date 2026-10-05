import { describe, expect, it } from 'vitest';
import {
  type AccuracySumRow,
  accuracyCoverage,
  accuracyMetrics,
  adminAccuracy,
  isoWeekLabel,
  periodLabel,
  publicAccuracy,
} from './internal/model-accuracy';

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
    forecasts: 2,
    matches: 1,
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
  it('divides the sums by the forecasts', () => {
    expect(accuracyMetrics(row({}))).toEqual({
      forecasts: 2,
      matches: 1,
      coverage: 'limited',
      log_loss: 1,
      brier: 0.6,
      rps: 0.2,
      accuracy: 0.5,
      uniform_rps: 0.277778,
    });
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
      ['2026-W41', '2026-10-05', 3, 2],
      ['2026-W42', '2026-10-12', 1, 1],
    ]);
    // (2 + 0.5) / 3, not the mean of 1 and 0.5.
    expect(overall?.points[0]?.log_loss).toBe(0.833333);
    expect(overall?.points[0]?.accuracy).toBe(0.6667);
    expect(overall?.total).toMatchObject({ forecasts: 4, matches: 3, log_loss: 1, accuracy: 0.5 });
    expect(overall?.total.coverage).toBe('limited');
  });

  it('keeps the shadow version out of the published series', () => {
    expect(out.series[0]?.total.forecasts).toBe(4);
    expect(out.series[3]?.total.forecasts).toBe(2);
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

  it('never counts a shadow row, and says not_supplied with nothing at all', () => {
    const out = publicAccuracy([row({ role: 'shadow' })], []);
    expect(out.overall.total.coverage).toBe('not_supplied');
    expect(out.overall.model_versions).toEqual([]);
    expect(out.competitions).toEqual([]);
    expect(out.last_updated_at).toBeNull();
  });
});
