import type { Covered, TableRow } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import { CONTEXT_RADIUS, pickSeason, tableContext } from './catalog.service';

const season = (id: string, is_current: boolean) => ({
  id,
  label: id,
  start_date: '2025-08-01',
  end_date: '2026-05-31',
  is_current,
});

const row = (position: number, id = `t${position}`): TableRow => ({
  position,
  team: { id, name: id.toUpperCase(), short_name: null },
  played: 1,
  won: 0,
  drawn: 0,
  lost: 0,
  goals_for: 0,
  goals_against: 0,
  goal_difference: 0,
  points: 30 - position,
  form: [],
});

const table = (rows: TableRow[]): Covered<TableRow[]> => ({
  coverage: 'available',
  last_updated_at: '2025-09-01T00:00:00.000Z',
  data: rows,
});

describe('pickSeason', () => {
  it('takes the requested season, else the current one, else the newest', () => {
    const seasons = [season('new', false), season('cur', true), season('old', false)];
    expect(pickSeason(seasons, 'old')?.id).toBe('old');
    expect(pickSeason(seasons, 'missing')).toBeUndefined();
    expect(pickSeason(seasons, null)?.id).toBe('cur');
    expect(pickSeason([season('new', false), season('old', false)], null)?.id).toBe('new');
    expect(pickSeason([], null)).toBeUndefined();
  });
});

describe('tableContext', () => {
  const rows = Array.from({ length: 10 }, (_, i) => row(i + 1));

  it('slices the team and its neighbours out of the table, under the table coverage', () => {
    const context = tableContext(table(rows), 't5');
    expect(context.coverage).toBe('available');
    expect(context.data).toMatchObject({ position: 5, total: 10, points: 25 });
    expect(context.data!.rows.map((r) => r.position)).toEqual([3, 4, 5, 6, 7]);
    expect(context.data!.rows).toHaveLength(2 * CONTEXT_RADIUS + 1);
  });

  it('clips at the top and the bottom', () => {
    expect(tableContext(table(rows), 't1').data!.rows.map((r) => r.position)).toEqual([1, 2, 3]);
    expect(tableContext(table(rows), 't10').data!.rows.map((r) => r.position)).toEqual([8, 9, 10]);
  });

  it('carries no data when the team is not on the table, and keeps a delayed state', () => {
    expect(tableContext(table(rows), 'elsewhere')).toEqual({
      coverage: 'not_supplied',
      last_updated_at: '2025-09-01T00:00:00.000Z',
      data: null,
    });
    expect(
      tableContext({ coverage: 'delayed', last_updated_at: null, data: null }, 't1').coverage,
    ).toBe('delayed');
  });
});
