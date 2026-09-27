import { describe, expect, it } from 'vitest';
import { RATING_FORMULA_V1, computeRating, ratingTrajectory } from './internal/formula';
import { ratingHistory, type HistoryInput } from './internal/history';

const PL = { id: '00000000-0000-4000-8000-00000000c001', name: 'Premier League' };
const CL = { id: '00000000-0000-4000-8000-00000000c002', name: 'Champions League' };
const NOW = '2026-09-27T12:00:00.000Z';

/**
 * `n` settlements, one every eight hours from 1 Jan 2026, so days hold two or
 * three each; correctness, exact scores, confidence and difficulty vary on
 * fixed cycles so the rating moves.
 */
function settlements(n: number): HistoryInput[] {
  return Array.from({ length: n }, (_, i) => ({
    settlementId: `s${String(i).padStart(4, '0')}`,
    settledAt: new Date(Date.UTC(2026, 0, 1) + i * 8 * 3_600_000).toISOString(),
    correct: i % 3 !== 1,
    scorePredicted: i % 2 === 0,
    scoreCorrect: i % 2 === 0 ? i % 7 === 0 : null,
    confidence: (i % 5) + 1,
    difficulty: i % 4 === 0 ? null : 0.2 + (i % 6) / 10,
    competition: i % 3 === 0 ? CL : PL,
  }));
}

/** The same rows in an order the formula must not depend on. */
const shuffled = <T>(rows: T[]): T[] => [...rows].reverse();

describe('ratingHistory (T-640)', () => {
  it('is null with nothing settled, so the profile says a sentence rather than drawing a line', () => {
    expect(ratingHistory([], NOW)).toBeNull();
  });

  it('ends on exactly the rating the existing computation gives, beyond the formula window', () => {
    const rows = settlements(130);
    const history = ratingHistory(shuffled(rows), NOW);
    const current = computeRating(rows);
    expect(current).not.toBeNull();
    expect(history?.points.at(-1)?.rating).toBe(current!.rating);
    expect(history?.points.at(-1)?.provisional).toBe(current!.provisional);
    expect(history?.settled_total).toBe(130);
    expect(history?.points.at(-1)?.settled_total).toBe(130);
    expect(history?.formula_version).toBe(RATING_FORMULA_V1.version);
    expect(history?.computed_at).toBe(NOW);
  });

  it('every step is computeRating over that prefix: no second formula', () => {
    const rows = settlements(120);
    for (const [index, step] of ratingTrajectory(shuffled(rows)).entries()) {
      expect(step.input.settlementId).toBe(rows[index]!.settlementId);
      expect(step.settledTotal).toBe(index + 1);
      expect(step.result).toEqual(computeRating(rows.slice(0, index + 1)));
    }
  });

  it('keeps one point per UTC day, the rating after that day’s last settlement', () => {
    const rows = settlements(10); // 1 Jan 00:00, 08:00, 16:00, 2 Jan ... 4 Jan 00:00
    const history = ratingHistory(rows, NOW)!;
    expect(history.points.map((p) => p.date)).toEqual([
      '2026-01-01',
      '2026-01-02',
      '2026-01-03',
      '2026-01-04',
    ]);
    const steps = ratingTrajectory(rows);
    expect(history.points.map((p) => p.settled_at)).toEqual([
      steps[2]!.input.settledAt,
      steps[5]!.input.settledAt,
      steps[8]!.input.settledAt,
      steps[9]!.input.settledAt,
    ]);
    expect(history.points.map((p) => p.rating)).toEqual(
      [2, 5, 8, 9].map((i) => steps[i]!.result.rating),
    );
  });

  it('the highest is the largest rating after any settlement, dated where it was first reached', () => {
    const rows = settlements(60);
    const history = ratingHistory(rows, NOW)!;
    const steps = ratingTrajectory(rows);
    const max = Math.max(...steps.map((s) => s.result.rating));
    const first = steps.find((s) => s.result.rating === max)!;
    expect(history.highest).toEqual({
      rating: max,
      date: first.input.settledAt.slice(0, 10),
      settled_at: first.input.settledAt,
      provisional: first.result.provisional,
    });
    expect(history.highest.rating).toBeGreaterThanOrEqual(history.points.at(-1)!.rating);
  });

  it('per competition: counts add up to the whole, and each rating is the formula on its own rows', () => {
    const rows = settlements(75);
    const history = ratingHistory(rows, NOW)!;
    const sum = (f: (c: (typeof history.by_competition)[number]) => number) =>
      history.by_competition.reduce((n, c) => n + f(c), 0);
    expect(sum((c) => c.settled_count)).toBe(history.settled_total);
    expect(sum((c) => c.outcome_correct)).toBe(rows.filter((r) => r.correct).length);
    expect(sum((c) => c.score_correct)).toBe(rows.filter((r) => r.scoreCorrect === true).length);
    // Most settled first.
    expect(history.by_competition.map((c) => c.competition)).toEqual([PL, CL]);
    for (const entry of history.by_competition) {
      const own = rows.filter((r) => r.competition.id === entry.competition.id);
      expect(entry.settled_count).toBe(own.length);
      expect(entry.rating).toBe(computeRating(own)!.rating);
      expect(entry.provisional).toBe(computeRating(own)!.provisional);
    }
  });
});
