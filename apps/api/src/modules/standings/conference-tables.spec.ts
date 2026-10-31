import type { TableRow } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import { conferenceStandingsModule, type Result } from './standings.service';

/**
 * The competition page's conference tables (T-1671, D-319): each conference
 * ranks its own clubs over all their league matches, those against the
 * other conference included; a club in no conference is said, not dropped.
 */

const team = (id: string): TableRow['team'] => ({ id, name: id, short_name: null });

let n = 0;
const result = (home: string, away: string, homeGoals: number, awayGoals: number): Result => {
  n += 1;
  return {
    fixtureId: `f${n}`,
    kickoffAt: `2026-03-${String(n).padStart(2, '0')}T20:00:00.000Z`,
    home: { id: home, name: home, shortName: null },
    away: { id: away, name: away, shortName: null },
    homeGoals,
    awayGoals,
  };
};

const EAST = { name: 'Eastern Conference', teams: [team('e1'), team('e2')] };
const WEST = { name: 'Western Conference', teams: [team('w1'), team('w2')] };
const ALL = [...EAST.teams, ...WEST.teams];
const AT = '2026-03-10T22:00:00.000Z';

describe('conferenceStandingsModule (T-1671)', () => {
  it('ranks each conference over all its clubs’ league matches, the other conference’s included', () => {
    const results = [
      result('e1', 'e2', 1, 0), // within the East
      result('w1', 'e2', 0, 2), // across: counts for e2 in the East and w1 in the West
      result('w2', 'w1', 3, 3), // within the West
    ];
    const module = conferenceStandingsModule([EAST, WEST], results, ALL, 'available', AT);
    expect(module.coverage).toBe('available');
    expect(module.last_updated_at).toBe(AT);
    const [east, west] = module.data ?? [];
    expect(east?.name).toBe('Eastern Conference');
    expect(east?.counted).toBe(2);
    expect(east?.rows.map((r) => [r.position, r.team.id, r.played, r.points])).toEqual([
      // Level on points and goal difference; e2 has scored more.
      [1, 'e2', 2, 3],
      [2, 'e1', 1, 3],
    ]);
    expect(west?.counted).toBe(2);
    expect(west?.rows.map((r) => [r.position, r.team.id, r.played, r.points])).toEqual([
      [1, 'w2', 1, 1],
      [2, 'w1', 2, 1],
    ]);
  });

  it('lists the clubs of a conference with no finished match, without positions', () => {
    const module = conferenceStandingsModule(
      [EAST, WEST],
      [result('e1', 'e2', 2, 2)],
      ALL,
      'available',
      AT,
    );
    const [, west] = module.data ?? [];
    expect(west?.counted).toBe(0);
    expect(west?.rows).toEqual([]);
    expect(west?.teams.map((t) => t.id)).toEqual(['w1', 'w2']);
  });

  it('is limited when a club of the league is in no conference', () => {
    const module = conferenceStandingsModule(
      [EAST, WEST],
      [result('e1', 'x', 1, 0)],
      [...ALL, team('x')],
      'available',
      AT,
    );
    expect(module.coverage).toBe('limited');
    expect(module.data?.[0]?.rows.map((r) => r.team.id)).toEqual(['e1', 'e2']);
  });

  it('keeps a delayed declaration, and says nothing as an absence', () => {
    expect(conferenceStandingsModule([EAST, WEST], [], ALL, 'delayed', null).coverage).toBe(
      'delayed',
    );
    const none = conferenceStandingsModule([], [], ALL, 'available', null);
    expect(none.coverage).toBe('not_supplied');
    expect(none.data).toBeNull();
  });
});
