import { describe, expect, it } from 'vitest';
import { formToSubmission, isLocked } from './prediction-form';

const form = (entries: [string, string][]): FormData => {
  const data = new FormData();
  for (const [k, v] of entries) data.append(k, v);
  return data;
};

describe('formToSubmission', () => {
  it('shapes a full form into the request', () => {
    expect(
      formToSubmission(
        form([
          ['outcome', 'home'],
          ['score_home', '2'],
          ['score_away', '1'],
          ['confidence', '4'],
          ['reason_tags', 'form'],
          ['reason_tags', 'home_advantage'],
          ['explanation', '  Anfield.  '],
        ]),
      ),
    ).toEqual({
      outcome: 'home',
      score: { home: 2, away: 1 },
      confidence: 4,
      reason_tags: ['form', 'home_advantage'],
      explanation: 'Anfield.',
    });
  });

  it('leaves the score out unless both goals are given, and drops unknown tags', () => {
    expect(
      formToSubmission(
        form([
          ['outcome', 'draw'],
          ['score_home', '1'],
          ['confidence', '3'],
          ['reason_tags', 'luck'],
        ]),
      ),
    ).toEqual({ outcome: 'draw', score: null, confidence: 3, reason_tags: [], explanation: null });
  });

  it('forwards a fourth tag so the API can refuse it by name', () => {
    const request = formToSubmission(
      form([
        ['outcome', 'away'],
        ['confidence', '2'],
        ['reason_tags', 'form'],
        ['reason_tags', 'lineup'],
        ['reason_tags', 'tactics'],
        ['reason_tags', 'fatigue'],
        ['reason_tags', 'motivation'],
      ]),
    );
    expect(request.reason_tags).toHaveLength(4);
  });
});

describe('isLocked', () => {
  it('locks at the kick-off instant, not before', () => {
    const kickoff = '2025-01-05T16:30:00.000Z';
    expect(isLocked(kickoff, Date.parse(kickoff) - 1)).toBe(false);
    expect(isLocked(kickoff, Date.parse(kickoff))).toBe(true);
  });
});
