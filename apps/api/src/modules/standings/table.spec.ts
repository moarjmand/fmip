import { describe, expect, it } from 'vitest';
import { DEFAULT_RANKING } from '@fmip/contracts';
import { FORM_WINDOW, type Result, rankGroup, rankTable } from './internal/table';

const team = (id: string, name = id.toUpperCase()) => ({ id, name, shortName: null });

const result = (
  n: number,
  home: string,
  away: string,
  homeGoals: number,
  awayGoals: number,
): Result => ({
  fixtureId: `f${n}`,
  kickoffAt: `2025-01-${String(n).padStart(2, '0')}T15:00:00.000Z`,
  home: team(home),
  away: team(away),
  homeGoals,
  awayGoals,
});

describe('rankGroup (T-1399)', () => {
  const member = (id: string) => ({ id, name: id.toUpperCase(), short_name: null });

  it("counts a match against another zone for the group's own team only", () => {
    // a and b are zone A; x is zone B and beat a in an interzonal match.
    const rows = rankGroup(
      [result(1, 'a', 'b', 1, 0), result(2, 'x', 'a', 3, 0)],
      [member('a'), member('b')],
    );
    expect(rows.map((r) => [r.position, r.team.id, r.played, r.points])).toEqual([
      [1, 'a', 2, 3],
      [2, 'b', 1, 0],
    ]);
  });

  it('is rankTable when every match is inside the group', () => {
    const results = [result(1, 'a', 'b', 1, 1), result(2, 'b', 'a', 2, 0)];
    const members = [member('a'), member('b')];
    expect(rankGroup(results, members)).toEqual(rankTable(results, members));
  });
});

describe('rankTable', () => {
  it('tallies points, goals and results, and ranks by points, then goal difference', () => {
    const rows = rankTable([
      result(1, 'a', 'b', 2, 0),
      result(2, 'c', 'd', 1, 1),
      result(3, 'b', 'c', 0, 3),
      result(4, 'd', 'a', 2, 2),
    ]);
    expect(rows.map((r) => r.team.id)).toEqual(['c', 'a', 'd', 'b']);
    expect(rows[0]).toMatchObject({
      position: 1,
      played: 2,
      won: 1,
      drawn: 1,
      lost: 0,
      goals_for: 4,
      goals_against: 1,
      goal_difference: 3,
      points: 4,
      form: ['W', 'D'],
    });
    expect(rows[1]).toMatchObject({ position: 2, points: 4, goal_difference: 2, goals_for: 4 });
    expect(rows[3]).toMatchObject({
      position: 4,
      points: 0,
      goal_difference: -5,
      form: ['L', 'L'],
    });
  });

  it('breaks equal points and difference by goals scored, then by name', () => {
    // a and c both win 2-0 and 3-1: 3 points, +2 each; c scored more.
    const rows = rankTable([result(1, 'a', 'b', 2, 0), result(2, 'c', 'd', 3, 1)]);
    // b and d both lost by two goals; d scored one, b none.
    expect(rows.map((r) => r.team.id)).toEqual(['c', 'a', 'd', 'b']);
    expect(rankTable([result(1, 'zeta', 'alpha', 1, 1)]).map((r) => r.team.name)).toEqual([
      'ALPHA',
      'ZETA',
    ]);
  });

  it('keeps the last five results as form, most recent first', () => {
    // a: W D L W W L D over seven matches.
    const spec: [number, number][] = [
      [1, 0],
      [1, 1],
      [0, 1],
      [2, 0],
      [3, 1],
      [0, 2],
      [2, 2],
    ];
    const results = spec.map(([h, a], i) => result(i + 1, 'a', 'b', h, a));
    const a = rankTable(results).find((r) => r.team.id === 'a')!;
    expect(a.played).toBe(7);
    expect(a.form).toHaveLength(FORM_WINDOW);
    expect(a.form).toEqual(['D', 'L', 'W', 'W', 'L']);
  });

  describe("a league's own ranking (T-1674, D-323)", () => {
    const MLS = ['points', 'wins', 'goal_difference', 'goals_for'] as const;
    // Level on 6 points: b drew all six (no win, 0); e won two and lost two (-4).
    const level = [
      ...[1, 2, 3, 4, 5, 6].map((n) => result(n, 'b', 'z', 1, 1)),
      result(7, 'e', 'x', 1, 0),
      result(8, 'e', 'y', 1, 0),
      result(9, 'x', 'e', 3, 0),
      result(10, 'y', 'e', 3, 0),
    ];
    const order = (rows: ReturnType<typeof rankTable>) =>
      rows.filter((r) => r.team.id === 'b' || r.team.id === 'e').map((r) => r.team.id);

    it('ranks by points, goal difference, goals scored, then name when no order is given', () => {
      expect(order(rankTable(level))).toEqual(['b', 'e']);
      expect(rankTable(level, [], DEFAULT_RANKING)).toEqual(rankTable(level));
    });

    it("puts wins before goal difference in MLS's order", () => {
      const rows = rankTable(level, [], MLS);
      expect(order(rows)).toEqual(['e', 'b']);
      // The rows themselves are the same tallies, only their places change.
      expect(rows.find((r) => r.team.id === 'e')).toMatchObject({
        won: 2,
        points: 6,
        goal_difference: -4,
      });
    });

    it('falls back to goal difference, goals scored and name when wins are level too', () => {
      // c and d: one win and three draws each; d +3, c +1.
      const results = [
        result(1, 'c', 'z', 1, 0),
        ...[2, 3, 4].map((n) => result(n, 'c', 'w', 0, 0)),
        result(5, 'd', 'z', 3, 0),
        ...[6, 7, 8].map((n) => result(n, 'd', 'w', 2, 2)),
      ];
      expect(
        rankTable(results, [], MLS)
          .slice(0, 2)
          .map((r) => r.team.id),
      ).toEqual(['d', 'c']);
      expect(
        rankTable([result(1, 'zeta', 'alpha', 1, 1)], [], MLS).map((r) => r.team.name),
      ).toEqual(['ALPHA', 'ZETA']);
    });

    it('is the same table under either order when no two clubs are level on points', () => {
      const results = [
        result(1, 'a', 'b', 2, 0),
        result(2, 'b', 'c', 1, 0),
        result(3, 'a', 'c', 1, 1),
      ];
      expect(rankTable(results, [], MLS)).toEqual(rankTable(results));
    });

    it('ranks a conference by the same order (rankGroup)', () => {
      const members = ['b', 'e'].map((id) => ({ id, name: id.toUpperCase(), short_name: null }));
      expect(rankGroup(level, members).map((r) => r.team.id)).toEqual(['b', 'e']);
      expect(rankGroup(level, members, MLS).map((r) => [r.position, r.team.id])).toEqual([
        [1, 'e'],
        [2, 'b'],
      ]);
    });
  });

  it('gives a participant without a result an empty row instead of leaving it out', () => {
    const rows = rankTable([result(1, 'a', 'b', 1, 0)], [{ id: 'c', name: 'C', short_name: null }]);
    // No points for c, but no goals conceded either: above the beaten b.
    expect(rows.map((r) => r.team.id)).toEqual(['a', 'c', 'b']);
    expect(rows[1]).toMatchObject({ played: 0, points: 0, form: [] });
  });
});
