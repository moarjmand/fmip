import { PROMOTION_MINIMUM } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import { NEVER_ANSWERED, candidateRecords } from './internal/candidate-records';

const NOW = new Date('2026-10-01T00:00:00Z');
const COUNT = {
  modelVersion: 'dixon-coles-elo@0.5.0',
  evaluated: 120,
  awaiting: 8,
  afterKickoff: 2,
  unavailable: 1,
};

describe('candidateRecords (T-1103)', () => {
  it('lists a candidate the service runs before its first forecast, with zeros', () => {
    const report = candidateRecords(
      [COUNT],
      [],
      ['dixon-coles-elo@0.5.0', 'dixon-coles-elo@0.6.0'],
      NOW,
    );
    expect(report.minimum).toBe(PROMOTION_MINIMUM);
    expect(report.service).toBe('answered');
    expect(report.candidates).toEqual([
      expect.objectContaining({
        model_version: 'dixon-coles-elo@0.5.0',
        in_shadow: true,
        pre_kickoff_evaluated: 120,
      }),
      expect.objectContaining({
        model_version: 'dixon-coles-elo@0.6.0',
        in_shadow: true,
        pre_kickoff_evaluated: 0,
        competitions: [],
      }),
    ]);
  });

  it('keeps the record of a candidate that left shadow, and says when the service is silent', () => {
    expect(candidateRecords([COUNT], [], [], NOW).candidates[0]?.in_shadow).toBe(false);
    const silent = candidateRecords([COUNT], [], null, NOW);
    expect(silent.service).toBe('unreachable');
    expect(silent.candidates[0]?.in_shadow).toBeNull();
  });

  it('carries no verdict, whatever the count', () => {
    const report = candidateRecords([{ ...COUNT, evaluated: 400 }], [], [], NOW);
    expect(Object.keys(report.candidates[0] ?? {}).sort()).toEqual([
      'after_kickoff',
      'competitions',
      'in_shadow',
      'model_version',
      'pre_kickoff_awaiting',
      'pre_kickoff_evaluated',
      'shadow',
      'unavailable',
    ]);
  });

  it('carries whether each answers, and a candidate with nothing stored as never answered (T-1165)', () => {
    const answering = {
      first_answered_at: '2026-09-20T10:00:00.000Z',
      last_answered_at: '2026-09-30T10:00:00.000Z',
      day: { asked: 6, failed: 1 },
      last_failure: { at: '2026-09-30T09:00:00.000Z', fixture_id: 'f1' },
    };
    const report = candidateRecords(
      [COUNT],
      [],
      ['dixon-coles-elo@0.5.0', 'dixon-coles-elo@0.6.0'],
      NOW,
      new Map([['dixon-coles-elo@0.5.0', answering]]),
    );
    expect(report.candidates[0]?.shadow).toEqual(answering);
    expect(report.candidates[1]?.shadow).toEqual(NEVER_ANSWERED);
    expect(NEVER_ANSWERED.first_answered_at).toBeNull();
  });
});
