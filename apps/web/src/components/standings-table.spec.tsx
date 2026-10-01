import type { GroupTable, LeagueZones, TableRow } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GroupTables, StandingsTable, showsLeagueTable } from './standings-table';

/**
 * The competition page's tables (T-1336): a season with group stages shows
 * every group's table, under its stage when there are several, and a group
 * not yet started as a sentence with its teams; a league's page keeps its
 * one table, marked by its zones, exactly as before.
 */

const row = (id: string, position: number, points: number): TableRow => ({
  position,
  team: { id, name: `Team ${id}`, short_name: null },
  played: 1,
  won: points === 3 ? 1 : 0,
  drawn: 0,
  lost: points === 0 ? 1 : 0,
  goals_for: 1,
  goals_against: 0,
  goal_difference: points === 3 ? 1 : -1,
  points,
  form: [points === 3 ? 'W' : 'L'],
});

const group = (stage: string, name: string, rows: TableRow[]): GroupTable => ({
  stage: { id: stage, name: stage },
  group: name,
  counted: rows.length === 0 ? 0 : 1,
  rows,
  teams: [
    { id: `${name}1`, name: `Team ${name}1`, short_name: null },
    { id: `${name}2`, name: `Team ${name}2`, short_name: null },
  ],
});

const covered = <T,>(data: T | null) => ({
  coverage: data === null ? ('not_supplied' as const) : ('available' as const),
  last_updated_at: null,
  data,
});

describe('which table the competition page shows', () => {
  it('keeps a league season’s table, rows or none', () => {
    expect(showsLeagueTable({ table: covered([row('a', 1, 3)]), group_tables: null })).toBe(true);
    expect(showsLeagueTable({ table: covered<TableRow[]>(null), group_tables: null })).toBe(true);
  });

  it('drops the empty league table of a group season, keeps one with rows', () => {
    const groups = covered([group('Group Stage', 'A', [row('a', 1, 3)])]);
    expect(showsLeagueTable({ table: covered<TableRow[]>(null), group_tables: groups })).toBe(
      false,
    );
    expect(showsLeagueTable({ table: covered([row('a', 1, 3)]), group_tables: groups })).toBe(true);
  });
});

describe('the league table', () => {
  it('marks a listed zone on the start edge, as before', () => {
    const zones: LeagueZones = {
      state: 'listed',
      teams: 2,
      zones: [{ kind: 'champions_league', from: 1, to: 1 }],
      sources: ['https://example.org'],
      complete: true,
      note: null,
    };
    const html = renderToStaticMarkup(
      <StandingsTable rows={[row('a', 1, 3), row('b', 2, 0)]} locale="en" zones={zones} />,
    );
    expect(html.match(/data-testid="table-row"/g)).toHaveLength(2);
    expect(html).toContain('data-zone="champions_league"');
    expect(html).toContain('href="/en/team/a"');
    expect(html).not.toContain('<caption');
    expect(html).not.toMatch(/\b(left|right)\b/);
  });
});

describe('the group tables', () => {
  it('heads each group by its name alone under a single stage', () => {
    const html = renderToStaticMarkup(
      <GroupTables
        locale="en"
        groups={[
          group('Group Stage', 'A', [row('a', 1, 3), row('b', 2, 0)]),
          group('Group Stage', 'B', [row('c', 1, 3), row('d', 2, 0)]),
        ]}
      />,
    );
    expect(html).not.toContain('<h3 class="text-base font-semibold">Group Stage</h3>');
    expect(html).toContain('<h3 class="text-sm font-semibold">Group A</h3>');
    expect(html).toContain('<h3 class="text-sm font-semibold">Group B</h3>');
    expect(html.match(/data-testid="group-table"/g)).toHaveLength(2);
    expect(html.match(/data-testid="table-row"/g)).toHaveLength(4);
    // No zones in a group: the blank edge only.
    expect(html).not.toContain('data-zone=');
  });

  it('puts each group under its stage when there are several', () => {
    const html = renderToStaticMarkup(
      <GroupTables
        locale="en"
        groups={[
          group('League A', 'A', [row('a', 1, 3)]),
          group('League A', 'B', [row('b', 1, 3)]),
          group('League B', 'A', [row('c', 1, 3)]),
        ]}
      />,
    );
    expect(html.match(/data-testid="group-stage"/g)).toHaveLength(2);
    expect(html).toContain('<h3 class="text-base font-semibold">League A</h3>');
    expect(html).toContain('<h3 class="text-base font-semibold">League B</h3>');
    expect(html).toContain('<h4 class="text-sm font-semibold">Group A</h4>');
    expect(html).toContain('<caption class="sr-only">League B, Group A</caption>');
    expect(html.indexOf('League A')).toBeLessThan(html.indexOf('League B'));
  });

  it('says a group not yet started has no positions, and names its teams', () => {
    const html = renderToStaticMarkup(
      <GroupTables locale="en" groups={[group('Group Stage', 'C', [])]} />,
    );
    expect(html).toContain('data-testid="group-not-started"');
    expect(html).toContain('no positions yet');
    expect(html).toContain('Team C1 and Team C2');
    expect(html).not.toContain('<table');
  });

  it('labels the groups in Persian', () => {
    const html = renderToStaticMarkup(
      <GroupTables locale="fa" groups={[group('Group Stage', 'A', [row('a', 1, 3)])]} />,
    );
    expect(html).toContain('گروه A');
  });
});
