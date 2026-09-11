import { describe, expect, it } from 'vitest';
import { FORM_WINDOW, type Result, rankTable } from './internal/table';

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

  it('gives a participant without a result an empty row instead of leaving it out', () => {
    const rows = rankTable([result(1, 'a', 'b', 1, 0)], [{ id: 'c', name: 'C', short_name: null }]);
    // No points for c, but no goals conceded either: above the beaten b.
    expect(rows.map((r) => r.team.id)).toEqual(['a', 'c', 'b']);
    expect(rows[1]).toMatchObject({ played: 0, points: 0, form: [] });
  });
});
