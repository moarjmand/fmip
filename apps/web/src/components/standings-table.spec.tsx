import type { ConferenceTable, GroupTable, LeagueZones, TableRow } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  ConferenceTables,
  GroupTables,
  StandingsTable,
  conferenceName,
  showsLeagueTable,
} from './standings-table';

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

const group = (stage: string, name: string, rows: TableRow[], superseded = false): GroupTable => ({
  stage: { id: stage, name: stage, superseded },
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
      unmarked_cup_places: true,
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

  it("names Argentina's halves and leads with the one being played (T-1668)", () => {
    const html = renderToStaticMarkup(
      <GroupTables
        locale="en"
        groups={[
          group('Apertura', 'A', [row('a', 1, 3)], true),
          group('Apertura', 'B', [row('b', 1, 3)], true),
          group('Clausura', 'A', [row('c', 1, 3)]),
          group('Clausura', 'B', [row('d', 1, 3)]),
        ]}
      />,
    );
    // Before T-1668 both halves were headed "Groups": the names were unknown.
    expect(html).not.toContain('>Groups<');
    expect(html.match(/data-testid="group-stage"/g)).toHaveLength(1);
    expect(html).toContain('<h3 class="text-base font-semibold">Clausura</h3>');
    expect(html).toContain('<caption class="sr-only">Clausura, Group A</caption>');
    // The Apertura follows, closed, named, and still all there.
    const earlier = html.indexOf('data-testid="group-stage-earlier"');
    expect(earlier).toBeGreaterThan(html.indexOf('Clausura'));
    expect(html.slice(earlier)).not.toContain('<details open');
    expect(html.slice(earlier)).toContain('<h3 class="text-base font-semibold">Apertura</h3>');
    expect(html.slice(earlier)).toContain('Earlier stage');
    expect(html.slice(earlier)).toContain('<caption class="sr-only">Apertura, Group B</caption>');
    expect(html.match(/data-testid="group-table"/g)).toHaveLength(4);
    expect(html).not.toMatch(/\b(left|right)\b/);
  });

  it('keeps both halves open in stage order before the second has a result (T-1668)', () => {
    const html = renderToStaticMarkup(
      <GroupTables
        locale="en"
        groups={[group('Apertura', 'A', [row('a', 1, 3)]), group('Clausura', 'A', [])]}
      />,
    );
    expect(html.match(/data-testid="group-stage"/g)).toHaveLength(2);
    expect(html).not.toContain('group-stage-earlier');
    expect(html.indexOf('Apertura')).toBeLessThan(html.indexOf('Clausura'));
  });

  it("names Argentina's halves in Persian (T-1668)", () => {
    const html = renderToStaticMarkup(
      <GroupTables
        locale="fa"
        groups={[
          group('Apertura', 'A', [row('a', 1, 3)], true),
          group('Clausura', 'A', [row('b', 1, 3)]),
        ]}
      />,
    );
    expect(html).toContain('کلاسورا');
    expect(html).toContain('آپرتورا');
    expect(html).toContain('مرحله‌ی قبلی');
  });

  it('labels the groups in Persian', () => {
    const html = renderToStaticMarkup(
      <GroupTables locale="fa" groups={[group('Group Stage', 'A', [row('a', 1, 3)])]} />,
    );
    expect(html).toContain('گروه A');
  });
});

const conference = (name: string, rows: TableRow[]): ConferenceTable => ({
  name,
  counted: rows.length === 0 ? 0 : 2,
  rows,
  teams: [
    { id: `${name}1`, name: `${name} club 1`, short_name: null },
    { id: `${name}2`, name: `${name} club 2`, short_name: null },
  ],
});

/** MLS 2026's places as the committed list names them (T-1674, D-323). */
const MLS_ZONES: LeagueZones = {
  state: 'listed',
  teams: 30,
  zones: ['Eastern Conference', 'Western Conference'].flatMap((c) => [
    { kind: 'title_playoffs' as const, from: 1, to: 7, conference: c },
    { kind: 'title_playoffs_wild_card' as const, from: 8, to: 9, conference: c },
  ]),
  complete: true,
  sources: ['https://www.mlssoccer.com/news/audi-2026-mls-cup-playoffs-format-how-it-works'],
  note: null,
  unmarked_cup_places: false,
};

const ranked = (prefix: string, n: number): TableRow[] =>
  Array.from({ length: n }, (_, i) => row(`${prefix}${i + 1}`, i + 1, 0));

const marks = (html: string): (string | null)[] =>
  [...html.matchAll(/<tr [^>]*data-testid="table-row"[^>]*>\s*<td([^>]*)>/g)].map(
    (m) => /data-zone="([^"]+)"/.exec(m[1] ?? '')?.[1] ?? null,
  );

describe('the play-off places of each conference (T-1674, D-323)', () => {
  it("marks each conference's first seven and its eighth and ninth, the rest unmarked", () => {
    const html = renderToStaticMarkup(
      <ConferenceTables
        locale="en"
        conferences={[
          conference('Eastern Conference', ranked('e', 11)),
          conference('Western Conference', ranked('w', 11)),
        ]}
        zones={MLS_ZONES}
      />,
    );
    const each = [
      ...Array<string>(7).fill('title_playoffs'),
      'title_playoffs_wild_card',
      'title_playoffs_wild_card',
      null,
      null,
    ];
    expect(marks(html)).toEqual([...each, ...each]);
    // The place names its band for a screen reader, colour never the only sign.
    expect(html).toContain('(Play-offs)');
    expect(html).toContain('(Play-off wild-card round)');
  });

  it('marks nothing on a conference the list does not name, nor on the overall table', () => {
    const north = renderToStaticMarkup(
      <ConferenceTables
        locale="en"
        conferences={[conference('Northern Conference', ranked('n', 9))]}
        zones={MLS_ZONES}
      />,
    );
    expect(north).not.toContain('data-zone=');
    const overall = renderToStaticMarkup(
      <StandingsTable rows={ranked('o', 18)} locale="en" zones={MLS_ZONES} />,
    );
    expect(overall).not.toContain('data-zone=');
  });

  it('names the bands in Persian', () => {
    const html = renderToStaticMarkup(
      <ConferenceTables
        locale="fa"
        conferences={[conference('Eastern Conference', ranked('e', 9))]}
        zones={MLS_ZONES}
      />,
    );
    expect(html).toContain('(پلی‌آف قهرمانی)');
    expect(html).toContain('(دور وایلدکارت پلی‌آف)');
  });
});

describe('the conference tables (T-1672)', () => {
  it('heads each conference by its name, its own clubs ranked, no zones', () => {
    const html = renderToStaticMarkup(
      <ConferenceTables
        locale="en"
        conferences={[
          conference('Eastern Conference', [row('a', 1, 3), row('b', 2, 0)]),
          conference('Western Conference', [row('c', 1, 3), row('d', 2, 0)]),
        ]}
        zones={null}
      />,
    );
    expect(html).toContain('<h3 class="text-sm font-semibold">Eastern Conference</h3>');
    expect(html).toContain('<h3 class="text-sm font-semibold">Western Conference</h3>');
    expect(html).toContain('<caption class="sr-only">Western Conference</caption>');
    expect(html.match(/data-testid="conference-table"/g)).toHaveLength(2);
    expect(html.match(/data-testid="table-row"/g)).toHaveLength(4);
    expect(html.indexOf('Eastern')).toBeLessThan(html.indexOf('Western'));
    expect(html).not.toContain('data-zone=');
    // Two abreast only from the wide desktop width: at 1024 the Persian names
    // pushed the second table into its own sideways scroll (T-1672).
    expect(html).toContain('xl:grid-cols-2');
    expect(html).not.toContain('lg:grid-cols-2');
  });

  it('says a conference not yet started has no positions, and names its clubs', () => {
    const html = renderToStaticMarkup(
      <ConferenceTables
        locale="en"
        conferences={[conference('Eastern Conference', [])]}
        zones={MLS_ZONES}
      />,
    );
    expect(html).toContain('data-testid="conference-not-started"');
    expect(html).toContain('no positions yet');
    expect(html).toContain('Eastern Conference club 1 and Eastern Conference club 2');
    expect(html).not.toContain('<table');
  });

  it('names the conferences in Persian, and one the catalogue lacks as the API does', () => {
    expect(conferenceName('fa', 'Eastern Conference')).toBe('کنفرانس شرق');
    expect(conferenceName('fa', 'Western Conference')).toBe('کنفرانس غرب');
    expect(conferenceName('fa', 'Northern Conference')).toBe('Northern Conference');
    const html = renderToStaticMarkup(
      <ConferenceTables
        locale="fa"
        conferences={[conference('Western Conference', [row('a', 1, 3)])]}
        zones={null}
      />,
    );
    expect(html).toContain('کنفرانس غرب');
  });
});
