import type { Rating } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import { ELIGIBILITY_V1, eligibilityFor } from './internal/eligibility';
import { POINTS_RULES_V1, awardsFor, currentStreak, type PointsInput } from './internal/points';

let n = 0;
const settled = (correct: boolean, scoreCorrect: boolean | null = null): PointsInput => {
  n += 1;
  return {
    settlementId: `s${String(n).padStart(3, '0')}`,
    settledAt: `2026-02-${String(((n - 1) % 28) + 1).padStart(2, '0')}T12:00:00.000Z`,
    correct,
    scoreCorrect,
  };
};

describe('awardsFor', () => {
  it('pays for taking part, for being right, and for the exact score', () => {
    const awards = awardsFor([settled(false), settled(true, true)]);
    expect(awards.map((a) => [a.settlementId, a.reason, a.points])).toEqual([
      ['s001', 'settled', 1],
      ['s002', 'settled', 1],
      ['s002', 'correct_outcome', 3],
      ['s002', 'exact_score', 5],
    ]);
  });

  it('pays streak awards once per run, ten passing through five', () => {
    const run = Array.from({ length: 12 }, () => settled(true));
    const awards = awardsFor(run);
    const streaks = awards.filter((a) => a.reason.startsWith('streak'));
    expect(streaks.map((a) => [a.settlementId, a.reason])).toEqual([
      [run[4]!.settlementId, 'streak_5'],
      [run[9]!.settlementId, 'streak_5'],
      [run[9]!.settlementId, 'streak_10'],
    ]);
    expect(currentStreak(run)).toBe(12);
    expect(currentStreak([...run, settled(false)])).toBe(0);
  });

  it('is a pure function of the settlements: same rows, same ledger, any order', () => {
    const history = [settled(true), settled(true), settled(false, false), settled(true, true)];
    expect(awardsFor([...history].reverse())).toEqual(awardsFor(history));
    expect(awardsFor([])).toEqual([]);
    expect(POINTS_RULES_V1.version).toBe('career-points@1.0.0');
  });
});

describe('eligibilityFor', () => {
  const rating = (over: Partial<Rating>): Rating => ({
    username: 'x',
    rating: 75,
    tier: 'platinum',
    provisional: false,
    established: true,
    settled_count: 60,
    components: { result: 0.8, exact_score: 0.2, consistency: 0.9, confidence: 0.6 },
    formula_version: 'performance-rating@1.0.0',
    computed_at: '2026-02-01T00:00:00.000Z',
    ...over,
  });

  it('needs rating, sample and a verified address, and names what is missing', () => {
    expect(eligibilityFor(rating({}), true)).toEqual({
      eligible: true,
      reasons: [],
      rules_version: ELIGIBILITY_V1.version,
    });
    expect(eligibilityFor(rating({ settled_count: 12, rating: 40 }), false).reasons).toEqual([
      'verify your e-mail address',
      'settle at least 50 predictions (12 so far)',
      'reach a rating of 70 (currently 40)',
    ]);
    expect(eligibilityFor(null, true).eligible).toBe(false);
  });

  it('cannot be unlocked by Career Points: they are not an input at all', () => {
    // A million points and no rating is still not eligible; the function has no
    // parameter through which points could arrive.
    // Two required inputs (rating, verified address) plus the rules; nothing else.
    expect(eligibilityFor.length).toBe(2);
    expect(eligibilityFor(null, true).eligible).toBe(false);
  });
});
