import { describe, expect, it } from 'vitest';
import { RATING_FORMULA_V1, computeRating } from './internal/formula';
import { LEADERBOARD_RULES_V1, monthBounds } from './internal/leaderboard';
import { periodBoard, type PeriodInput } from './internal/period-board';
import { resolvePeriod } from './reputation.service';

const FLOOR = LEADERBOARD_RULES_V1.floor;
const ANN = '00000000-0000-4000-8000-00000000a001';
const BEN = '00000000-0000-4000-8000-00000000a002';
const CAT = '00000000-0000-4000-8000-00000000a003';
const MEMBERS = new Map([
  [ANN, 'ann'],
  [BEN, 'ben'],
  [CAT, 'cat'],
]);

/**
 * `n` settlements for one member, one every eight hours from `start`, with
 * correctness, exact scores, confidence and difficulty on fixed cycles offset
 * by `seed`, so members rate differently.
 */
function settlements(userId: string, n: number, start: string, seed: number): PeriodInput[] {
  return Array.from({ length: n }, (_, i) => {
    const k = i + seed;
    return {
      userId,
      settlementId: `${userId.slice(-4)}-${String(i).padStart(4, '0')}`,
      settledAt: new Date(Date.parse(start) + i * 8 * 3_600_000).toISOString(),
      correct: k % 3 !== 1 && k % (seed + 4) !== 0,
      scorePredicted: k % 2 === 0,
      scoreCorrect: k % 2 === 0 ? k % 7 === 0 : null,
      confidence: (k % 5) + 1,
      difficulty: k % 4 === 0 ? null : 0.2 + (k % 6) / 10,
    };
  });
}

/** What the store hands over for a month: only the settlements inside it. */
function inMonth(rows: PeriodInput[], month: string): PeriodInput[] {
  const { from, to } = monthBounds(month);
  return rows.filter((r) => r.settledAt >= from && r.settledAt < to);
}

describe('periodBoard (T-641)', () => {
  // Three members settle through August and September; the September board
  // must be each member's rating over their September settlements alone.
  const all = [
    ...settlements(ANN, 150, '2026-08-01T00:00:00.000Z', 1),
    ...settlements(BEN, 120, '2026-08-10T00:00:00.000Z', 2),
    ...settlements(CAT, 70, '2026-08-20T00:00:00.000Z', 3),
  ];
  const september = inMonth(all, '2026-09');

  it("rates each member with computeRating over that period's settlements only", () => {
    const board = periodBoard(september, MEMBERS, FLOOR);
    expect(board.length).toBeGreaterThan(0);
    for (const row of board) {
      const own = september.filter((r) => r.userId === row.userId);
      const expected = computeRating(own, RATING_FORMULA_V1);
      expect(row.result).toEqual(expected);
      expect(row.result.settledCount).toBe(Math.min(own.length, RATING_FORMULA_V1.window));
    }
    // And not the all-time rating: August is not in it.
    const annAllTime = computeRating(all.filter((r) => r.userId === ANN));
    const ann = board.find((r) => r.userId === ANN);
    expect(ann?.result.inputsHash).not.toBe(annAllTime?.inputsHash);
  });

  it('does not depend on the order the settlements arrive in', () => {
    expect(periodBoard([...september].reverse(), MEMBERS, FLOOR)).toEqual(
      periodBoard(september, MEMBERS, FLOOR),
    );
  });

  it("keeps the global board's minimum-sample rule, and ranks inside what is left", () => {
    const lucky = settlements(CAT, FLOOR - 1, '2026-09-01T00:00:00.000Z', 0).map((r) => ({
      ...r,
      correct: true,
      scoreCorrect: true,
    }));
    const rows = [...inMonth(all, '2026-09').filter((r) => r.userId !== CAT), ...lucky];
    const board = periodBoard(rows, MEMBERS, FLOOR);
    expect(board.some((r) => r.userId === CAT)).toBe(false);
    for (const row of board) expect(row.result.settledCount).toBeGreaterThanOrEqual(FLOOR);
    expect(board.map((r) => r.rank)).toEqual(board.map((_, i) => i + 1));

    // A stricter filter only removes members; it never re-rates them.
    const strict = periodBoard(rows, MEMBERS, 60);
    for (const row of strict)
      expect(row.result).toEqual(board.find((r) => r.userId === row.userId)?.result);
  });

  it('orders by rating, then sample, then username, as the global board does', () => {
    const board = periodBoard(september, MEMBERS, FLOOR);
    for (let i = 1; i < board.length; i += 1) {
      const [a, b] = [board[i - 1]!, board[i]!];
      expect(
        a.result.rating > b.result.rating ||
          (a.result.rating === b.result.rating && a.result.settledCount >= b.result.settledCount),
      ).toBe(true);
    }
    // Two identical histories tie on rating and sample: the username decides.
    const twin = settlements(BEN, 40, '2026-09-01T00:00:00.000Z', 5);
    const tie = periodBoard(
      [...twin, ...twin.map((r) => ({ ...r, userId: ANN, settlementId: `a-${r.settlementId}` }))],
      MEMBERS,
      FLOOR,
    );
    expect(tie.map((r) => r.username)).toEqual(['ann', 'ben']);
  });

  it('leaves out anybody the caller did not hand over (scope, privacy, inactive)', () => {
    const board = periodBoard(september, new Map([[BEN, 'ben']]), FLOOR);
    expect(board.map((r) => r.username)).toEqual(['ben']);
    expect(board[0]!.rank).toBe(1);
    expect(periodBoard([], MEMBERS, FLOOR)).toEqual([]);
  });
});

describe('resolvePeriod (T-641)', () => {
  const now = new Date('2026-09-27T12:00:00.000Z');

  it('defaults a month to the current UTC month and a season to the newest with settlements', () => {
    expect(resolvePeriod({ kind: 'month', month: null }, { seasons: [] }, now)).toEqual({
      kind: 'month',
      month: '2026-09',
      from: '2026-09-01T00:00:00.000Z',
      to: '2026-10-01T00:00:00.000Z',
    });
    expect(
      resolvePeriod({ kind: 'season', label: null }, { seasons: ['2025/26', '2024/25'] }, now),
    ).toEqual({ kind: 'season', label: '2025/26' });
    expect(resolvePeriod({ kind: 'season', label: '2024/25' }, { seasons: [] }, now)).toEqual({
      kind: 'season',
      label: '2024/25',
    });
  });

  it('says there is no season rather than inventing one', () => {
    expect(resolvePeriod({ kind: 'season', label: null }, { seasons: [] }, now)).toEqual({
      kind: 'season',
      label: null,
    });
  });
});
