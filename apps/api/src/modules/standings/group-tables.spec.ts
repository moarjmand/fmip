import type { TableRow } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import {
  groupStandingsModule,
  supersededStages,
  type SeasonGroupTable,
  type StageSpan,
} from './standings.service';

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
      [{ id: 's1', name: 'League A', superseded: false }, 'A', 1, 2],
      [{ id: 's2', name: 'League B', superseded: false }, 'A', 1, 2],
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

describe('supersededStages (T-1668)', () => {
  const span = (stageId: string, first: string, last: string, played: number): StageSpan => ({
    stageId,
    first: `${first}T18:00:00.000Z`,
    last: `${last}T18:00:00.000Z`,
    played,
  });

  it("marks Argentina's Apertura once the Clausura has a result, and only then", () => {
    const apertura = span('apertura', '2026-01-22', '2026-05-05', 240);
    expect([
      ...supersededStages([apertura, span('clausura', '2026-07-23', '2026-11-08', 214)]),
    ]).toEqual(['apertura']);
    // The Clausura drawn but not started: the Apertura is still the season's table.
    expect(supersededStages([apertura, span('clausura', '2026-07-23', '2026-11-08', 0)]).size).toBe(
      0,
    );
  });

  it('never marks stages played side by side, nor a single group stage', () => {
    expect(
      supersededStages([
        span('a', '2026-09-24', '2026-11-17', 32),
        span('b', '2026-09-24', '2026-11-17', 32),
        span('d', '2026-09-24', '2026-11-16', 8),
      ]).size,
    ).toBe(0);
    expect(supersededStages([span('g', '2026-09-15', '2026-12-09', 45)]).size).toBe(0);
    expect(supersededStages([{ stageId: 'x', first: null, last: null, played: 0 }]).size).toBe(0);
  });

  it('carries the mark on every group of the stage', () => {
    const module = groupStandingsModule(
      [
        group({ stageId: 'ap', name: 'A' }),
        group({ stageId: 'ap', name: 'B' }),
        group({ stageId: 'cl' }),
      ],
      'available',
      new Set(['ap']),
    );
    expect(module.data!.map((g) => [g.stage.id, g.group, g.stage.superseded])).toEqual([
      ['ap', 'A', true],
      ['ap', 'B', true],
      ['cl', 'A', false],
    ]);
  });
});
