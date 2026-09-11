import { describe, expect, it } from 'vitest';
import { validateSubmission } from './internal/validation';

describe('validateSubmission', () => {
  it('accepts a full submission and normalises it', () => {
    const v = validateSubmission({
      outcome: 'home',
      score: { home: 2, away: 1 },
      confidence: 4,
      reason_tags: ['form', 'home_advantage'],
      explanation: '  Liverpool are flying at Anfield.  ',
    });
    expect(v).toEqual({
      ok: true,
      value: {
        outcome: 'home',
        score: { home: 2, away: 1 },
        confidence: 4,
        reasonTags: ['form', 'home_advantage'],
        explanation: 'Liverpool are flying at Anfield.',
      },
    });
  });

  it('accepts the minimum: outcome and confidence', () => {
    expect(validateSubmission({ outcome: 'draw', confidence: 1, explanation: '   ' })).toEqual({
      ok: true,
      value: { outcome: 'draw', score: null, confidence: 1, reasonTags: [], explanation: null },
    });
  });

  it('names every problem at once', () => {
    const v = validateSubmission({
      outcome: 'win',
      score: { home: -1, away: 2 },
      confidence: 7,
      reason_tags: ['luck'],
      explanation: 'x'.repeat(281),
    });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(Object.keys(v.fields).sort()).toEqual([
      'confidence',
      'explanation',
      'outcome',
      'reason_tags',
      'score',
    ]);
  });

  it('refuses a score that contradicts the outcome, too many or repeated tags', () => {
    expect(
      validateSubmission({ outcome: 'away', score: { home: 2, away: 1 }, confidence: 3 }),
    ).toMatchObject({
      ok: false,
      fields: { score: 'does not match the outcome (away)' },
    });
    expect(
      validateSubmission({
        outcome: 'home',
        confidence: 3,
        reason_tags: ['form', 'lineup', 'tactics', 'fatigue'],
      }),
    ).toMatchObject({ ok: false, fields: { reason_tags: 'at most 3 tags' } });
    expect(
      validateSubmission({ outcome: 'home', confidence: 3, reason_tags: ['form', 'form'] }),
    ).toMatchObject({ ok: false, fields: { reason_tags: 'must not repeat a tag' } });
    expect(validateSubmission('nope')).toEqual({
      ok: false,
      fields: { body: 'must be an object' },
    });
  });
});
