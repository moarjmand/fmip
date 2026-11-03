import { describe, expect, it } from 'vitest';
import {
  type CandidateInput,
  calibrationBands,
  candidateRecord,
  competitionRecords,
  modelRecord,
  normalEstimate,
  wilsonEstimate,
} from './internal/console-model';
import type { ModelRecordRow, PairedRow } from './internal/evaluation-store';

/**
 * The console's model page (T-1729, D-355): the intervals are the model
 * watch's, competitions rank best first with the thin ones after, and a
 * candidate's comparison stays a count until D-336's thresholds (T-1720).
 */

const row = (overrides: Partial<ModelRecordRow> = {}): ModelRecordRow => ({
  competition: null,
  matches: 400,
  logLoss: 0.95,
  logLossSd: 0.4,
  brier: 0.56,
  brierSd: 0.3,
  correct: 232,
  firstKickoffAt: new Date('2026-10-10T12:00:00Z'),
  lastKickoffAt: new Date('2026-11-01T20:00:00Z'),
  lastEvaluatedAt: new Date('2026-11-02T01:00:00Z'),
  ...overrides,
});

const paired = (overrides: Partial<PairedRow> = {}): PairedRow => ({
  matches: 254,
  identical: 247,
  publishedLogLoss: 0.95,
  candidateLogLoss: 0.94998,
  publishedBrier: 0.56,
  candidateBrier: 0.55999,
  difference: -0.00002,
  differenceSd: 0.0009,
  ...overrides,
});

const candidate = (overrides: Partial<CandidateInput> = {}): CandidateInput => ({
  modelVersion: 'dixon-coles-elo@0.7.0',
  inService: true,
  span: { first: new Date('2026-10-22T08:00:00Z'), last: new Date('2026-11-02T08:00:00Z') },
  own: row({ matches: 659 }),
  paired: paired(),
  newDivisions: row({ matches: 72, logLoss: 0.9749, logLossSd: 0.46 }),
  ...overrides,
});

describe('the intervals', () => {
  it('gives a mean its normal interval, mean ± 1.96 sd/√n', () => {
    expect(normalEstimate(0.95, 0.4, 400)).toEqual({ mean: 0.95, low: 0.9108, high: 0.9892 });
  });

  it('gives a share its Wilson interval, inside 0..1 on a small band', () => {
    const all = wilsonEstimate(5, 5);
    expect(all.mean).toBe(1);
    expect(all.high).toBe(1);
    expect(all.low).toBeCloseTo(0.5655, 4);
    expect(wilsonEstimate(157, 253)).toMatchObject({ mean: 0.6206, low: 0.5594, high: 0.6781 });
  });

  it('draws no bounds below two matches', () => {
    expect(normalEstimate(1.2, null, 1)).toEqual({ mean: 1.2, low: null, high: null });
    expect(wilsonEstimate(1, 1)).toEqual({ mean: 1, low: null, high: null });
  });
});

describe('a record', () => {
  it('states its sample, its coverage and its window', () => {
    const record = modelRecord(row());
    expect(record.matches).toBe(400);
    expect(record.coverage).toBe('available');
    expect(record.accuracy?.mean).toBe(0.58);
    expect(record.first_kickoff_at).toBe('2026-10-10T12:00:00.000Z');
    expect(modelRecord(row({ matches: 12 })).coverage).toBe('limited');
  });

  it('says nothing was evaluated rather than a zero', () => {
    expect(modelRecord(undefined)).toMatchObject({
      matches: 0,
      coverage: 'not_supplied',
      log_loss: null,
      accuracy: null,
    });
  });
});

describe('the competitions', () => {
  it('ranks best first by log loss, the thin ones after by name', () => {
    const named = (name: string, logLoss: number, matches: number) =>
      row({ competition: { id: name, name }, logLoss, matches });
    const ordered = competitionRecords([
      row(),
      named('Scottish Premiership', 1.1184, 75),
      named('Saudi Pro League', 0.9, 12),
      named('Serie A', 0.93, 160),
      named('Eredivisie', 1.0765, 102),
      named('A-League', 0.8, 5),
    ]).map((c) => c.competition.name);
    expect(ordered).toEqual([
      'Serie A',
      'Eredivisie',
      'Scottish Premiership',
      'A-League',
      'Saudi Pro League',
    ]);
  });
});

describe('the calibration', () => {
  it('orders home, draw, away and each by band, with the share seen and its interval', () => {
    const bands = calibrationBands([
      { outcome: 'away', band: 4, forecasts: 253, said: 0.441, seen: 157 },
      { outcome: 'draw', band: 2, forecasts: 1239, said: 0.25, seen: 214 },
      { outcome: 'home', band: 4, forecasts: 364, said: 0.449, seen: 194 },
    ]);
    expect(bands.map((b) => `${b.outcome}${b.band}`)).toEqual(['home4', 'draw2', 'away4']);
    expect(bands[2]?.seen.mean).toBeCloseTo(0.6206, 4);
  });
});

describe('a candidate', () => {
  it('gives the paired and new-division counts alone below D-336 thresholds', () => {
    const record = candidateRecord(candidate());
    expect(record.paired).toEqual({ matches: 254, identical: 247, figures: null });
    expect(record.new_divisions).toEqual({ matches: 72, log_loss: null });
    expect(record.own.matches).toBe(659);
  });

  it('gives the figures and their intervals once each count is reached', () => {
    const record = candidateRecord(
      candidate({
        paired: paired({ matches: 300 }),
        newDivisions: row({ matches: 100, logLoss: 0.97, logLossSd: 0.5 }),
      }),
    );
    expect(record.paired.figures?.difference.mean).toBe(-0.00002);
    expect(record.paired.figures?.difference.high).toBeCloseTo(
      -0.00002 + (1.96 * 0.0009) / Math.sqrt(300),
      6,
    );
    expect(record.new_divisions.log_loss).toEqual({ mean: 0.97, low: 0.872, high: 1.068 });
  });

  it('says the service was silent rather than that it runs nothing', () => {
    expect(candidateRecord(candidate({ inService: null })).in_service).toBeNull();
  });
});
