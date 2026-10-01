import type { TableRow } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import { groupStandingsModule, type SeasonGroupTable } from './standings.service';

/**
 * The competition page's group tables (T-1336): each group under its stage,
 * rows only once a match is finished, the newest change across the groups,
 * and no group at all said as an absence rather than an empty list.
 */

const team = (id: string): TableRow['team'] => ({ id, name: id, short_name: null });

const row = (id: string, position: number, points: number): TableRow => ({
  position,
  team: team(id),
  played: 1,
  won: points === 3 ? 1 : 0,
  drawn: points === 1 ? 1 : 0,
  lost: points === 0 ? 1 : 0,
  goals_for: 1,
  goals_against: 0,
  goal_difference: 0,
  points,
  form: [],
});

const group = (over: Partial<SeasonGroupTable>): SeasonGroupTable => ({
  stageId: 's1',
  stageName: 'League A',
  name: 'A',
  rows: [row('x', 1, 3), row('y', 2, 0)],
  teams: [team('x'), team('y')],
  counted: 1,
  lastUpdatedAt: '2026-09-05T20:00:00.000Z',
  ...over,
});

describe('groupStandingsModule (T-1336)', () => {
  it('carries each group under its stage, with the newest change of any', () => {
    const module = groupStandingsModule(
      [
        group({}),
        group({ stageId: 's2', stageName: 'League B', lastUpdatedAt: '2026-09-06T20:00:00.000Z' }),
      ],
      'available',
    );
    expect(module.coverage).toBe('available');
    expect(module.last_updated_at).toBe('2026-09-06T20:00:00.000Z');
    expect(module.data!.map((g) => [g.stage, g.group, g.counted, g.rows.length])).toEqual([
      [{ id: 's1', name: 'League A' }, 'A', 1, 2],
      [{ id: 's2', name: 'League B' }, 'A', 1, 2],
    ]);
  });

  it('gives a group not yet started no positions, only its teams', () => {
    const module = groupStandingsModule(
      [group({ counted: 0, lastUpdatedAt: null, rows: [row('x', 1, 0), row('y', 2, 0)] })],
      'available',
    );
    const [only] = module.data!;
    expect(only!.rows).toEqual([]);
    expect(only!.teams.map((t) => t.id)).toEqual(['x', 'y']);
    expect(module.last_updated_at).toBeNull();
  });

  it('is not supplied when no group is known, and limited when nothing was declared', () => {
    expect(groupStandingsModule([], 'available')).toEqual({
      coverage: 'not_supplied',
      last_updated_at: null,
      data: null,
    });
    expect(groupStandingsModule([], 'delayed').coverage).toBe('delayed');
    expect(groupStandingsModule([group({})], null).coverage).toBe('limited');
  });
});
