import { describe, expect, it } from 'vitest';
import { outcomeOf, settleOne, verdictFor } from './internal/settle';
import type { Settleable } from './internal/settlement-store';

const prediction = (over: Partial<Settleable> = {}): Settleable => ({
  predictionId: 'p1',
  versionId: 'v2',
  versionNumber: 2,
  outcome: 'home',
  score: { home: 2, away: 1 },
  confidence: 4,
  current: null,
  ...over,
});

describe('verdictFor', () => {
  it('settles a finished match with a score, voids the four no-result states, waits otherwise', () => {
    expect(verdictFor({ id: 'f', status: 'finished', fullTime: { home: 2, away: 1 } })).toEqual({
      kind: 'settle',
      actual: { home: 2, away: 1 },
    });
    expect(verdictFor({ id: 'f', status: 'finished', fullTime: null })).toEqual({
      kind: 'not_final',
    });
    for (const status of ['postponed', 'abandoned', 'cancelled', 'awarded'] as const) {
      expect(verdictFor({ id: 'f', status, fullTime: null })).toEqual({
        kind: 'void',
        reason: status,
      });
    }
    for (const status of ['scheduled', 'live', 'suspended']) {
      expect(verdictFor({ id: 'f', status, fullTime: null })).toEqual({ kind: 'not_final' });
    }
  });
});

describe('settleOne', () => {
  const settle = verdictFor({ id: 'f', status: 'finished', fullTime: { home: 2, away: 1 } });

  it('judges outcome and exact score against the final result', () => {
    expect(settleOne(prediction(), settle)).toMatchObject({
      status: 'settled',
      actual: { home: 2, away: 1 },
      outcomeCorrect: true,
      scorePredicted: true,
      scoreCorrect: true,
      confidence: 4,
    });
    expect(settleOne(prediction({ outcome: 'draw', score: null }), settle)).toMatchObject({
      outcomeCorrect: false,
      scorePredicted: false,
      scoreCorrect: null,
    });
    expect(settleOne(prediction({ score: { home: 3, away: 1 } }), settle)).toMatchObject({
      outcomeCorrect: true,
      scoreCorrect: false,
    });
    expect(outcomeOf(0, 0)).toBe('draw');
    expect(outcomeOf(0, 1)).toBe('away');
  });

  it('is idempotent: an already-settled prediction writes nothing, a void one is superseded', () => {
    expect(
      settleOne(prediction({ current: { status: 'settled', voidReason: null } }), settle),
    ).toBeNull();
    expect(
      settleOne(prediction({ current: { status: 'void', voidReason: 'postponed' } }), settle),
    ).toMatchObject({ status: 'settled' });
  });

  it('voids once per reason and never after a real settlement', () => {
    const postponed = verdictFor({ id: 'f', status: 'postponed', fullTime: null });
    expect(settleOne(prediction(), postponed)).toMatchObject({
      status: 'void',
      voidReason: 'postponed',
      actual: null,
      outcomeCorrect: null,
      scoreCorrect: null,
    });
    expect(
      settleOne(prediction({ current: { status: 'void', voidReason: 'postponed' } }), postponed),
    ).toBeNull();
    expect(
      settleOne(prediction({ current: { status: 'void', voidReason: 'abandoned' } }), postponed),
    ).toMatchObject({ status: 'void', voidReason: 'postponed' });
    expect(
      settleOne(prediction({ current: { status: 'settled', voidReason: null } }), postponed),
    ).toBeNull();
    expect(settleOne(prediction(), { kind: 'not_final' })).toBeNull();
  });
});
