import type { Covered, TableRow } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import {
  CONTEXT_RADIUS,
  groupSuggestions,
  mainPhaseTeams,
  pickSeason,
  tableContext,
  type SuggestionRow,
} from './catalog.service';

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

describe('follow suggestions (T-622)', () => {
  const competition = (
    id: string,
    display_order: number | null,
    team: { id: string; name: string; followers: number } | null,
    stage_kinds: (string | null)[] = [null],
  ): SuggestionRow => ({
    id,
    name: id.toUpperCase(),
    short_name: null,
    scope: 'domestic',
    country_id: null,
    display_order,
    season_id: team === null ? null : `${id}-s`,
    season_label: team === null ? null : '2025/26',
    team_id: team?.id ?? null,
    team_name: team?.name ?? null,
    team_short_name: null,
    team_code: null,
    team_kind: team === null ? null : 'club',
    team_country_id: null,
    stage_kinds: team === null ? null : stage_kinds,
    followers: team?.followers ?? null,
  });

  it('orders competitions as the scores page does: stated position first, then by name', () => {
    const grouped = groupSuggestions(
      [
        competition('zeta', null, null),
        competition('alpha', null, null),
        competition('cup', 2, null),
        competition('league', 1, null),
      ],
      5,
    );
    expect(grouped.map((g) => g.competition.id)).toEqual(['league', 'cup', 'alpha', 'zeta']);
  });

  it('ranks teams by followers, then by name, and keeps only the limit', () => {
    const rows = [
      competition('pl', 1, { id: 'b', name: 'Beta', followers: 3 }),
      competition('pl', 1, { id: 'a', name: 'Alpha', followers: 3 }),
      competition('pl', 1, { id: 'c', name: 'Gamma', followers: 9 }),
      competition('pl', 1, { id: 'd', name: 'Delta', followers: 0 }),
    ];
    const [pl] = groupSuggestions(rows, 3);
    expect(pl?.teams.map((t) => t.id)).toEqual(['c', 'a', 'b']);
    expect(pl?.teams[0]).toEqual({
      id: 'c',
      name: 'Gamma',
      short_name: null,
      code: null,
      kind: 'club',
      country_id: null,
      followers: 9,
    });
    expect(pl?.season).toEqual({ id: 'pl-s', label: '2025/26' });
  });

  it('suggests only the teams of the main phase, never clubs out in the qualifiers', () => {
    const rows = [
      competition('ucl', 1, { id: 'aarhus', name: 'Aarhus', followers: 4 }, ['qualifying']),
      competition('ucl', 1, { id: 'ararat', name: 'Ararat-Armenia', followers: 0 }, [
        'qualifying',
        'playoff',
      ]),
      competition('ucl', 1, { id: 'inter', name: 'Inter', followers: 0 }, ['league', 'knockout']),
      // Came through the qualifiers into the league stage: suggested.
      competition('ucl', 1, { id: 'bodo', name: 'Bodo/Glimt', followers: 0 }, [
        'qualifying',
        'league',
      ]),
      // A fixture with no stage beside a staged season does not count on its own.
      competition('ucl', 1, { id: 'loose', name: 'Loose', followers: 0 }, [null]),
    ];
    const [ucl] = groupSuggestions(rows, 5);
    expect(ucl?.teams.map((t) => t.id)).toEqual(['bodo', 'inter']);
  });

  it('counts group and knockout stages as the main phase too', () => {
    expect(
      mainPhaseTeams([
        { id: 'g', stage_kinds: ['group'] },
        { id: 'k', stage_kinds: ['knockout'] },
        { id: 'p', stage_kinds: ['playoff'] },
      ]).map((t) => t.id),
    ).toEqual(['g', 'k']);
  });

  it('takes every team of a league whose fixtures carry no stage', () => {
    expect(
      mainPhaseTeams([
        { id: 'a', stage_kinds: [null] },
        { id: 'b', stage_kinds: [null] },
      ]).map((t) => t.id),
    ).toEqual(['a', 'b']);
  });

  it('suggests no one from a season still in its qualifiers', () => {
    expect(
      mainPhaseTeams([
        { id: 'q', stage_kinds: ['qualifying'] },
        { id: 'p', stage_kinds: ['qualifying', 'playoff'] },
      ]),
    ).toEqual([]);
  });

  it('breaks a tie in followers by table position, a team with none after, then by name', () => {
    const rows = [
      competition('pl', 1, { id: 'a', name: 'Arsenal', followers: 0 }),
      competition('pl', 1, { id: 'b', name: 'Brentford', followers: 0 }),
      competition('pl', 1, { id: 'c', name: 'Chelsea', followers: 0 }),
      competition('pl', 1, { id: 'd', name: 'Derby', followers: 0 }),
      competition('pl', 1, { id: 'e', name: 'Everton', followers: 2 }),
    ];
    const positions = new Map([
      ['pl-s:c', 1],
      ['pl-s:b', 2],
      ['pl-s:a', 3],
      ['pl-s:e', 20],
    ]);
    const [pl] = groupSuggestions(rows, 5, positions);
    expect(pl?.teams.map((t) => t.id)).toEqual(['e', 'c', 'b', 'a', 'd']);
  });

  it('lists a competition with no season or no team as it is: no teams, never borrowed ones', () => {
    const [empty] = groupSuggestions([competition('new', null, null)], 5);
    expect(empty).toEqual({
      competition: {
        id: 'new',
        name: 'NEW',
        short_name: null,
        scope: 'domestic',
        country_id: null,
      },
      season: null,
      teams: [],
    });
  });
});
