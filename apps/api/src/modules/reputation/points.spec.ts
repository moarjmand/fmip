import { describe, expect, it } from 'vitest';
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
