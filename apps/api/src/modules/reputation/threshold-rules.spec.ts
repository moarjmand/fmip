import { describe, expect, it } from 'vitest';
import { THRESHOLDS_V1 } from '../rating-thresholds/rating-thresholds.service';
import {
  ELIGIBILITY_V1,
  eligibilityFor,
  eligibilityRulesUnder,
  underThresholds,
} from './internal/eligibility';
import { RATING_FORMULA_V1, computeRating, formulaUnder } from './internal/formula';

/**
 * The rating and eligibility under a threshold version (T-1160, D-152, D-164):
 * version 1 moves nothing, and a later one moves only what it names.
 */
describe('version 1', () => {
  it("holds today's constants exactly, so nothing moves the day it ships", () => {
    expect(THRESHOLDS_V1.provisionalBelow).toBe(RATING_FORMULA_V1.provisionalBelow);
    expect(THRESHOLDS_V1.establishedAt).toBe(RATING_FORMULA_V1.establishedAt);
    expect(eligibilityRulesUnder(THRESHOLDS_V1)).toEqual(ELIGIBILITY_V1);
    expect(formulaUnder(RATING_FORMULA_V1, THRESHOLDS_V1)).toEqual(RATING_FORMULA_V1);
    // D-137 and D-169: 30 consecutive days.
    expect(THRESHOLDS_V1.flagPeriodDays).toBe(30);
  });
});

describe('a later version', () => {
  const v2 = { ...THRESHOLDS_V1, version: 2, contributorMinRating: 75, establishedAt: 60 };

  it('names itself in the eligibility rules version, and only there', () => {
    const rules = eligibilityRulesUnder(v2);
    expect(rules.version).toBe('privilege-eligibility@1.1.0+thresholds.2');
    expect(rules.minRating).toBe(75);
    expect(underThresholds('contributor-flag@1.0.0', 1)).toBe('contributor-flag@1.0.0');
    const facts = {
      rating: 72,
      settled_count: 80,
      email_verified: true,
      under_sanction: false,
      recently_sanctioned: false,
      last_sanctioned_at: null,
    };
    expect(eligibilityFor(facts, eligibilityRulesUnder(THRESHOLDS_V1)).qualifies).toBe(true);
    expect(eligibilityFor(facts, rules).qualifies).toBe(false);
  });

  it('moves the flags and nothing else of the formula', () => {
    const history = Array.from({ length: 55 }, (_, i) => ({
      settlementId: `s${String(i).padStart(3, '0')}`,
      settledAt: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
      correct: i % 2 === 0,
      scorePredicted: false,
      scoreCorrect: null,
      confidence: 3,
      difficulty: null,
    }));
    const before = computeRating(history, RATING_FORMULA_V1)!;
    const after = computeRating(history, formulaUnder(RATING_FORMULA_V1, v2))!;
    expect(before.established).toBe(true);
    expect(after.established).toBe(false);
    expect(after.rating).toBe(before.rating);
    expect(after.components).toEqual(before.components);
    expect(after.inputsHash).toBe(before.inputsHash);
  });
});
