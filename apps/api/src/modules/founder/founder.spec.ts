import { describe, expect, it } from 'vitest';
import { MIN_REASONING, OUTCOMES, validatePublish } from './internal/validate';

// Validating a published analysis (T-131). The rules are the blueprint's; what
// is tested here is that a person writing one gets sentences rather than
// constraint names, and gets all of them at once.

const VALID = {
  predicted_outcome: 'home',
  predicted_score: { home: 2, away: 1 },
  confidence: 4,
  reasoning:
    'They are the better side, at home, and the visitors have lost their last three away matches.',
  lineup_impact: 'Their first-choice centre-back is suspended.',
  key_players: null,
  form_and_context: null,
};

describe('a well-formed analysis', () => {
  it('is accepted, with the optional sections absent rather than empty', () => {
    const parsed = validatePublish({ ...VALID, key_players: '   ' });
    expect('value' in parsed).toBe(true);
    if (!('value' in parsed)) return;
    expect(parsed.value.key_players).toBeNull();
    expect(parsed.value.predicted_score).toEqual({ home: 2, away: 1 });
    // Prose is trimmed, so a stray newline does not become part of the record.
    expect(parsed.value.reasoning).toBe(VALID.reasoning);
  });

  it('accepts an outcome with no predicted score, which the blueprint makes optional', () => {
    const parsed = validatePublish({ ...VALID, predicted_score: null });
    expect('value' in parsed && parsed.value.predicted_score).toBeNull();
  });
});

describe('what it refuses, and how it says so', () => {
  it('insists on real reasoning, because an analysis is the reasoning', () => {
    // A sentence fragment beside a predicted score is a prediction, and the
    // product already has those. Letting one through as an analysis would blur
    // the distinction rule 6 exists to keep.
    const parsed = validatePublish({ ...VALID, reasoning: 'They will win.' });
    expect('fields' in parsed && parsed.fields.reasoning).toContain(
      `at least ${MIN_REASONING} characters`,
    );
  });

  it('refuses a predicted score that contradicts the predicted outcome, and says which', () => {
    const parsed = validatePublish({
      ...VALID,
      predicted_outcome: 'away',
      predicted_score: { home: 2, away: 1 },
    });
    expect('fields' in parsed && parsed.fields.predicted_score).toBe(
      'says home, but the predicted outcome is away',
    );
  });

  it('names every problem at once, not one at a time', () => {
    const parsed = validatePublish({
      predicted_outcome: 'maybe',
      confidence: 11,
      reasoning: 'no',
    });
    expect('fields' in parsed).toBe(true);
    if (!('fields' in parsed)) return;
    expect(Object.keys(parsed.fields).sort()).toEqual([
      'confidence',
      'predicted_outcome',
      'reasoning',
    ]);
    expect(parsed.fields.predicted_outcome).toContain(OUTCOMES.join(', '));
    expect(parsed.fields.confidence).toBe('must be a whole number from 1 to 5');
  });

  it('refuses half a score and a fractional one', () => {
    expect('fields' in validatePublish({ ...VALID, predicted_score: { home: 2 } })).toBe(true);
    expect('fields' in validatePublish({ ...VALID, predicted_score: { home: 1.5, away: 1 } })).toBe(
      true,
    );
    expect('fields' in validatePublish({ ...VALID, predicted_score: { home: -1, away: 0 } })).toBe(
      true,
    );
  });

  it('refuses something that is not an object at all', () => {
    expect('fields' in validatePublish(null)).toBe(true);
    expect('fields' in validatePublish('an analysis')).toBe(true);
    expect('fields' in validatePublish([VALID])).toBe(true);
  });
});
