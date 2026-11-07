import type {
  ConferenceTable,
  GroupTable,
  LeagueZoneEntry,
  LeagueZones,
  TableRow,
} from '@fmip/contracts';
import { leagueZonesFor } from '@fmip/contracts';
import LIST from '@fmip/contracts/zones/league-zones.json';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ZoneLegend } from './competition-page';
import {
  ConferenceTables,
  GroupTables,
  OverallFold,
  StandingsTable,
  conferenceName,
  leaguePhase,
  showsLeagueTable,
  zoneDivider,
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
    // Two abreast only when the competition column itself is 1,100px wide
    // (T-1760, D-377): a container query, never the viewport (at 1440 the
    // column is 854px and the two tables crushed each other's form).
    expect(html).toMatch(/^<div class="@container" data-testid="conference-grid">/);
    expect(html).toContain('<div class="grid grid-cols-1 gap-4 @min-[68.75rem]:grid-cols-2">');
    expect(html).not.toMatch(/\b(lg|xl):grid-cols-2/);
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

/** A row with a form of its own and a number of matches played. */
const played = (
  id: string,
  position: number,
  n: number,
  form: TableRow['form'] = ['W', 'D', 'L'],
) => ({
  ...row(id, position, 3),
  played: n,
  form,
});

const cellsOf = (html: string, testId: string): string[] =>
  [...html.matchAll(new RegExp(`<tr data-testid="${testId}"[^>]*>([\\s\\S]*?)</tr>`, 'g'))].map(
    (m) => m[1] ?? '',
  );

describe('the phone table: every column in reach (T-1760, D-377)', () => {
  const html = renderToStaticMarkup(
    <StandingsTable rows={[played('a', 1, 9), played('b', 2, 9)]} locale="en" zones={null} flush />,
  );

  it('keeps every figure and the form in the table at every width, the form last', () => {
    const [first] = cellsOf(html, 'table-row');
    // place, team, P W D L Goals GD, points, form: nothing hidden on a phone.
    expect(first?.match(/<td/g)).toHaveLength(10);
    expect(html).not.toContain('hidden sm:table-cell');
    expect(html).not.toContain('hidden md:table-cell');
    const heads = [...html.matchAll(/<th scope="col"[^>]*>([\s\S]*?)<\/th>/g)].map((m) => m[1]);
    expect(heads.at(-1)).toBe('Form');
  });

  it('fixes the place and team at the start edge, sideways only, over the surface', () => {
    expect(html).toContain('border-separate border-spacing-0');
    const [first] = cellsOf(html, 'table-row');
    const [place, team] = [...(first ?? '').matchAll(/<td class="([^"]*)"/g)].map(
      (m) => m[1] ?? '',
    );
    expect(place).toMatch(/\bsticky start-0 z-1 bg-surface w-\[30px\]/);
    expect(place).toContain('sm:w-11');
    expect(team).toMatch(/\bsticky start-\[30px\] z-1 bg-surface sm:start-11\b/);
    // 30 + 90 = the 120px fixed column, a hairline on its edge.
    expect(team).toContain('max-sm:w-[90px]');
    expect(team).toContain('max-sm:border-e');
    // A word longer than the column breaks inside it rather than spilling under the figures.
    // Condensed and hyphenated on a phone, so a name such as "Bournemouth" stays whole in the 90px.
    expect(html).toContain('max-sm:font-stretch-condensed');
    expect(html).toContain(
      '<bdi class="min-w-0 max-sm:hyphens-auto max-sm:wrap-anywhere">Team a</bdi>',
    );
    // Horizontal only: nothing sticks to the top under the site header (D-376).
    expect(html).not.toMatch(/\b(top|inset-block)-/);
    expect(html).not.toMatch(/\b(left|right)\b/);
  });

  it('lets a keyboard reach the sliding box, named for a screen reader', () => {
    expect(html).toContain(
      '<div class="scroll-cue overflow-x-auto @container focus-visible:outline-2 focus-visible:outline-offset-2" tabindex="0" role="region" aria-label="Table, scrolls sideways"',
    );
    const named = renderToStaticMarkup(
      <StandingsTable rows={[played('a', 1, 9)]} locale="en" zones={null} caption="Group A" />,
    );
    expect(named).toContain('aria-label="Group A, scrolls sideways"');
  });

  it('says to swipe for the form on a phone, once, and keeps team names 44px links', () => {
    expect(html.match(/data-testid="table-swipe"/g)).toHaveLength(1);
    expect(html).toContain(
      '<p class="text-xs text-muted sm:hidden px-4 sm:px-4.5" data-testid="table-swipe">Swipe sideways for the form: the last five results, most recent first.</p>',
    );
    expect(html).toContain('class="inline-flex min-h-touch items-center gap-2 font-bold');
    // A summary keeps its phone columns and says nothing about swiping.
    const summary = renderToStaticMarkup(
      <StandingsTable rows={[played('a', 1, 9)]} locale="en" zones={null} summary />,
    );
    expect(summary).not.toContain('table-swipe');
    expect(summary).toContain('hidden sm:table-cell');
  });

  it('caps the table at 960px with a 44px "#" column on the desktop', () => {
    expect(html).toContain('<table class="w-full max-w-[60rem] ');
    expect(html).toMatch(/<th scope="col" class="[^"]*sm:w-11[^"]*">#<\/th>/);
  });

  it("draws the form as D-367's squares: a letter in each, filled, outlined, dashed, in ink", () => {
    const squares = [
      ...html.matchAll(/<span data-result="([WDL])" class="([^"]*)">([^<]*)<\/span>/g),
    ];
    expect(squares.slice(0, 3).map((m) => [m[1], m[3]])).toEqual([
      ['W', 'W'],
      ['D', 'D'],
      ['L', 'L'],
    ]);
    expect(squares[0]?.[2]).toContain('bg-fg text-surface');
    expect(squares[1]?.[2]).toContain('border border-strong text-fg');
    expect(squares[2]?.[2]).toContain('border border-dashed border-caption text-muted');
    expect(squares[0]?.[2]).toContain('size-[17px]');
    // Ink only: no hue for won or lost.
    expect(html).not.toMatch(/data-result="[WDL]" class="[^"]*(accent|danger|success)/);
    // Read out once, in words.
    expect(html).toContain('<span class="sr-only">W D L</span>');
  });

  it('mirrors in Persian: the same logical edges, Persian digits and letters', () => {
    const fa = renderToStaticMarkup(
      <StandingsTable rows={[played('a', 1, 9), played('b', 2, 9)]} locale="fa" zones={null} />,
    );
    expect(fa).toContain('sticky start-0');
    expect(fa).not.toMatch(/\b(left|right)\b/);
    expect(fa).toContain('>۹</td>');
    expect(fa).toMatch(/data-result="W" class="[^"]*">ب</);
    expect(fa).toContain('به کنار بکشید');
  });
});

describe("MLS: each conference's bands under it, the overall table folded (T-1760, D-377)", () => {
  it('lists each table its own play-off and wild-card places', () => {
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
    const keys = [...html.matchAll(/<ul [^>]*data-testid="table-zone-key">([\s\S]*?)<\/ul>/g)];
    expect(keys).toHaveLength(2);
    for (const k of keys) {
      expect(k[1]).toContain('Play-offs: 1–7');
      expect(k[1]).toContain('Play-off wild-card round: 8–9');
    }
    // Each key follows its own table, before the next conference.
    expect(html.indexOf('table-zone-key')).toBeLessThan(html.indexOf('Western Conference'));
    const none = renderToStaticMarkup(
      <ConferenceTables
        locale="en"
        conferences={[conference('Eastern Conference', ranked('e', 3))]}
        zones={null}
      />,
    );
    expect(none).not.toContain('table-zone-key');
  });

  it('folds the overall table in a native closed details named with its clubs', () => {
    const html = renderToStaticMarkup(
      <OverallFold locale="en" clubs={30}>
        <p>table</p>
      </OverallFold>,
    );
    expect(html).toMatch(/^<details class="group\/overall" data-testid="overall-table"><summary/);
    expect(html).not.toContain('<details open');
    expect(html).toContain('Overall table, 30 clubs');
    expect(html).toContain('min-h-touch');
    const fa = renderToStaticMarkup(
      <OverallFold locale="fa" clubs={30}>
        <p>table</p>
      </OverallFold>,
    );
    expect(fa).toContain('جدول کل، ۳۰ باشگاه');
    expect(
      renderToStaticMarkup(
        <OverallFold locale="en" clubs={0}>
          x
        </OverallFold>,
      ),
    ).toContain('Overall table<svg');
  });
});

describe("the Champions League's league phase, from the committed list (T-1761, D-381)", () => {
  const UCL = leagueZonesFor(
    LIST as LeagueZoneEntry[],
    { kind: 'cup', division: null, key: 'UCL' },
    '2026/27',
  );
  const table = (n: number, playedEach: (i: number) => number) =>
    Array.from({ length: n }, (_, i) => played(`c${i + 1}`, i + 1, playedEach(i)));

  it('draws a labelled line after each band, naming the band above and below', () => {
    const html = renderToStaticMarkup(
      <StandingsTable rows={table(36, () => 4)} locale="en" zones={UCL} flush />,
    );
    const lines = [
      ...html.matchAll(
        /<tr aria-hidden="true" data-testid="zone-divider" data-above="([a-z_0-9]+)" data-below="([a-z_0-9]+)">([\s\S]*?)<\/tr>/g,
      ),
    ];
    expect(lines.map((m) => [m[1], m[2]])).toEqual([
      ['league_phase_round_of_16', 'league_phase_playoff'],
      ['league_phase_playoff', 'league_phase_out'],
    ]);
    expect(lines[0]?.[3]).toContain('▲ Round of 16 (1–8)');
    expect(lines[0]?.[3]).toContain('Play-off round (9–24) ▼');
    expect(lines[1]?.[3]).toContain('▲ Play-off round (9–24)');
    expect(lines[1]?.[3]).toContain('Out (25–36) ▼');
    // In the colour of the band above, the existing tokens; spanning the whole row.
    expect(lines[0]?.[3]).toContain('border-y-2 bg-surface-raised p-0 border-y-accent');
    expect(lines[1]?.[3]).toContain('border-y-strong');
    expect(lines[0]?.[3]).toMatch(/^<td colSpan="10"/i);
    // The lines follow rows 8 and 24, wherever they fall.
    const order = [...html.matchAll(/data-testid="(table-row|zone-divider)"/g)].map((m) => m[1]);
    expect(order.indexOf('zone-divider')).toBe(8);
    expect(order.lastIndexOf('zone-divider')).toBe(25);
  });

  it('marks the place cell with the existing marks and says the band after the rank', () => {
    const html = renderToStaticMarkup(
      <StandingsTable rows={table(36, () => 4)} locale="en" zones={UCL} />,
    );
    const each = [
      ...Array<string>(8).fill('league_phase_round_of_16'),
      ...Array<string>(16).fill('league_phase_playoff'),
      ...Array<string>(12).fill('league_phase_out'),
    ];
    expect(marks(html)).toEqual(each);
    expect(html).toMatch(
      /border-s-accent" data-zone="league_phase_round_of_16">1<span class="sr-only"> \(Round of 16\)/,
    );
    expect(html).toMatch(
      /border-s-strong" data-zone="league_phase_playoff">9<span class="sr-only"> \(Play-off round\)/,
    );
    expect(html).toMatch(
      /border-s-transparent" data-zone="league_phase_out">25<span class="sr-only"> \(Out\)/,
    );
  });

  it('says the lines are where a club would stand today while any match remains, and final after', () => {
    const say = (rows: TableRow[]) => {
      const html = renderToStaticMarkup(<StandingsTable rows={rows} locale="en" zones={UCL} />);
      return /<p class="text-xs text-fg" data-testid="table-phase" data-state="([a-z]+)">([^<]*)<\/p>/.exec(
        html,
      );
    };
    expect(say(table(36, () => 4))?.slice(1)).toEqual([
      'provisional',
      'Every club has played 4 of 8 league-phase matches: the lines show where a club would stand if the league phase ended today.',
    ]);
    expect(say(table(36, (i) => (i < 30 ? 5 : 4)))?.[2]).toContain(
      'Clubs have played 4 to 5 of 8 league-phase matches',
    );
    // A matchday from the end: still provisional, whatever the date.
    expect(say(table(36, (i) => (i === 0 ? 7 : 8)))?.[1]).toBe('provisional');
    // A club the table does not list yet has played none.
    expect(say(table(35, () => 8))?.[1]).toBe('provisional');
    expect(say(table(36, () => 8))?.slice(1)).toEqual([
      'final',
      'Final league-phase table: every club has played its 8 matches.',
    ]);
  });

  it('writes no band edge or count itself: a different entry draws different lines', () => {
    const six: LeagueZones = {
      state: 'listed',
      teams: 6,
      matches: 3,
      zones: [
        { kind: 'league_phase_round_of_16', from: 1, to: 2 },
        { kind: 'league_phase_playoff', from: 3, to: 5 },
        { kind: 'league_phase_out', from: 6, to: 6 },
      ],
      sources: ['https://example.org'],
      complete: true,
      note: null,
      unmarked_cup_places: false,
    };
    const html = renderToStaticMarkup(
      <StandingsTable rows={table(6, () => 2)} locale="en" zones={six} />,
    );
    const order = [...html.matchAll(/data-testid="(table-row|zone-divider)"/g)].map((m) => m[1]);
    expect(order).toEqual([
      'table-row',
      'table-row',
      'zone-divider',
      'table-row',
      'table-row',
      'table-row',
      'zone-divider',
      'table-row',
    ]);
    expect(html).toContain('Play-off round (3–5)');
    expect(html).toContain('Every club has played 2 of 3 league-phase matches');
    expect(
      leaguePhase(
        six,
        table(6, () => 3),
      ),
    ).toEqual({ state: 'final', matches: 3 });
  });

  it('draws no line and no phase sentence on a league, nor without zones', () => {
    const e0 = leagueZonesFor(
      LIST as LeagueZoneEntry[],
      { kind: 'league', division: 'E0' },
      '2025/26',
    );
    const league = renderToStaticMarkup(
      <StandingsTable rows={table(20, () => 38)} locale="en" zones={e0} />,
    );
    expect(league).toContain('data-zone="relegation"');
    expect(league).not.toContain('zone-divider');
    expect(league).not.toContain('table-phase');
    expect(zoneDivider(null, null, 8, 9)).toBeNull();
    expect(
      leaguePhase(
        null,
        table(2, () => 1),
      ),
    ).toBeNull();
  });

  it('names the bands and the state in Persian, mirrored, with Persian digits', () => {
    const html = renderToStaticMarkup(
      <StandingsTable rows={table(36, () => 4)} locale="fa" zones={UCL} />,
    );
    expect(html).toContain('یک‌هشتم نهایی');
    expect(html).toContain('(یک‌هشتم نهایی)');
    expect(html).toContain('(حذف)');
    expect(html).toContain('هر باشگاه ۴ بازی از ۸ بازی مرحله‌ی لیگ');
    expect(html).not.toMatch(/\b(left|right)\b/);
  });

  it("lists the three bands in the table's legend", () => {
    const html = renderToStaticMarkup(<ZoneLegend locale="en" zones={UCL} />);
    expect(html).toContain('Round of 16: 1–8');
    expect(html).toContain('Play-off round: 9–24');
    expect(html).toContain('Out: 25–36');
    expect(html).toContain('href="https://documents.uefa.com/');
    // A cup has no Europa or Conference League places for cup winners to reassign.
    expect(html).not.toContain('Cup winners');
  });
});
