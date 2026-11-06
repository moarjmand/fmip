import type { CompetitionContext, ContextStanding, KnockoutLeg } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { gapLines, ordinal, positionLine, tieLine } from '@/lib/competition-context';
import { CompetitionContextPanel } from './competition-context';

/**
 * The match centre's competition context (T-840), rendered: a league match
 * shows both sides' lines before kick-off with the gaps the table supports
 * and says no qualification place is known; a cup tie says its round and
 * legs and never draws an empty table; a match with neither is a sentence.
 */

const team = (id: string, name: string) => ({ id, name, short_name: null });

const side = (over: Partial<ContextStanding> = {}): ContextStanding => ({
  team: team('b', 'Beta'),
  position: 2,
  played: 2,
  won: 1,
  drawn: 0,
  lost: 1,
  goal_difference: 1,
  points: 3,
  form: ['W', 'L'],
  points_from_top: 3,
  points_to_place_above: 3,
  points_clear_of_place_below: 2,
  ...over,
});

const base: CompetitionContext = {
  fixture_id: 'm',
  competition: { id: 'c', name: 'Test League', kind: 'league' },
  season: { id: 's', label: '2085/86' },
  stage: null,
  round: 'Regular Season - 3',
  group_name: null,
  table: null,
  knockout: null,
};

const leg = (id: string, score: { home: number; away: number } | null, n: number): KnockoutLeg => ({
  fixture_id: id,
  leg: n,
  kickoff_at: `2087-02-0${n}T20:00:00.000Z`,
  status: score === null ? 'scheduled' : 'finished',
  home: n === 1 ? team('c', 'Gamma') : team('d', 'Delta'),
  away: n === 1 ? team('d', 'Delta') : team('c', 'Gamma'),
  score,
  after_extra_time: false,
  penalties: null,
});

describe('the competition context words', () => {
  it('writes ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '12th',
      '13th',
      '21st',
      '22nd',
      '101st',
    ]);
    expect(positionLine(side(), 20)).toBe('2nd of 20 · 3 pts from 2 played');
  });

  it('states the gaps the table supports, and a level place as level', () => {
    expect(gapLines(side())).toEqual([
      '3 pts behind first',
      '3 pts behind the place above',
      '2 pts clear of the place below',
    ]);
    expect(gapLines(side({ points_to_place_above: 0, points_clear_of_place_below: null }))).toEqual(
      ['3 pts behind first', 'Level on points with the place above'],
    );
    expect(
      gapLines(
        side({
          position: 1,
          points_from_top: 0,
          points_to_place_above: null,
          points_clear_of_place_below: 1,
        }),
      ),
    ).toEqual(['First, 1 pt clear of second']);
  });

  it('judges no tie whose legs are unknown', () => {
    const tie = {
      teams: [team('c', 'Gamma'), team('d', 'Delta')] as [
        ReturnType<typeof team>,
        ReturnType<typeof team>,
      ],
      legs: [leg('x', { home: 1, away: 0 }, 1)],
      aggregate: null,
      winner: null,
      decided_by: null,
    };
    expect(tieLine({ round: 'Final', round_key: null, legs_expected: null, tie })).toMatch(
      /^Not judged/,
    );
  });
});

describe('the competition context panel', () => {
  it('shows both sides before kick-off, the leader, and no guessed place', () => {
    const html = renderToStaticMarkup(
      <CompetitionContextPanel
        locale="en"
        timeZone="UTC"
        context={{
          ...base,
          table: {
            coverage: 'available',
            last_updated_at: '2086-01-08T17:00:00.000Z',
            data: {
              scope: 'league',
              group_name: null,
              matches_counted: 4,
              teams: 4,
              leader: { team: team('a', 'Alpha'), points: 6 },
              home: side(),
              away: side({ team: team('c', 'Gamma'), position: 3, points: 1, points_from_top: 5 }),
              places: 'not_supplied',
            },
          },
        }}
      />,
    );
    expect(html).toContain('data-state="table"');
    expect(html).toContain('League table, before kick-off');
    // A compact two-team table (T-1746): a row per side, no neighbours.
    expect(html.match(/data-testid="competition-context-side"/g)).toHaveLength(2);
    expect(html.match(/<tbody>[^]*<\/tbody>/)?.[0].match(/<tr /g)).toHaveLength(2);
    const row = html.match(/<tr [^>]*data-testid="competition-context-side"[^]*?<\/tr>/)?.[0] ?? '';
    const cells = [...row.matchAll(/<t[dh][^>]*>([^]*?)<\/t[dh]>/g)].map((m) =>
      (m[1] ?? '').replace(/<[^>]+>/g, '').replace(/[\u2066-\u2069]/g, ''),
    );
    // Position, team, played, won-drawn-lost, goal difference, points.
    expect(cells).toEqual(['2', 'Beta', '2', '1-0-1', '+1', '3']);
    for (const title of ['Played', 'Won', 'Drawn', 'Lost', 'Goal difference', 'Points']) {
      expect(html).toContain(`<abbr title="${title}"`);
    }
    // The form as squares that carry their letter and differ in shape, not hue.
    const squares = html.match(
      /data-testid="competition-context-squares">[^]*?<\/span><\/span>/,
    )?.[0];
    expect(squares).toMatch(/class="[^"]*bg-fg text-surface" data-result="W">W</);
    expect(squares).toMatch(/class="[^"]*border-dashed[^"]*" data-result="L">L</);
    expect(html).not.toMatch(
      /data-result="[WDL]"[^>]*(bg|text|border)-(accent|danger|success|live)/,
    );
    // Every sentence the card had is kept; the gaps sit behind a native disclosure.
    const gaps = html.match(
      /<details data-testid="competition-context-gaps">[^]*?<\/details>/,
    )?.[0];
    expect(gaps).toContain('Gaps to the places around');
    expect(gaps).toContain('2nd of 4 · 3 pts from 2 played');
    expect(gaps).toContain(
      '3 pts behind first · 3 pts behind the place above · 2 pts clear of the place below',
    );
    // The form here is this competition's only, told apart from Recent form (T-1364).
    expect(html).toContain('Form in this competition only, latest first:');
    expect(html.match(/data-testid="competition-context-form-scope"/g)).toHaveLength(1);
    expect(html).toContain('Recent form counts the last five in every competition.');
    expect(html).toContain('<bdi>Alpha</bdi>, 6 pts');
    expect(html).toContain('From the 4 finished matches of this table played before kick-off.');
    expect(html).toContain('no gap to them is shown');
    expect(html).toContain('href="/en/team/b"');
    // The table scrolls in its own box where a column is too narrow for it.
    expect(html).toMatch(/class="scroll-cue overflow-x-auto"><table/);
    expect(html).not.toMatch(
      /class="[^"]*(?<![\w-])(left|right|ml|mr|pl|pr|text-left|text-right)-[^"]*"/,
    );
  });

  it('says a side with no result in this competition has no form, and draws no square', () => {
    const html = renderToStaticMarkup(
      <CompetitionContextPanel
        locale="fa"
        timeZone="UTC"
        context={{
          ...base,
          table: {
            coverage: 'available',
            last_updated_at: null,
            data: {
              scope: 'league',
              group_name: null,
              matches_counted: 4,
              teams: 4,
              leader: null,
              home: side({ form: [] }),
              away: side({ team: team('c', 'Gamma'), position: 3, form: ['D', 'W', 'L'] }),
              places: 'not_supplied',
            },
          },
        }}
      />,
    );
    expect(html.match(/data-testid="competition-context-squares"/g)).toHaveLength(1);
    // Persian letters, each in its own square.
    expect(html.match(/data-result="[WDL]">[^<]+</g)).toEqual([
      'data-result="D">م<',
      'data-result="W">ب<',
      'data-result="L">ش<',
    ]);
    expect(html).not.toContain('data-translation="untranslated"');
  });

  it('says a table that has not started has no positions yet', () => {
    const html = renderToStaticMarkup(
      <CompetitionContextPanel
        locale="en"
        timeZone="UTC"
        context={{
          ...base,
          table: {
            coverage: 'available',
            last_updated_at: null,
            data: {
              scope: 'group',
              group_name: 'A',
              matches_counted: 0,
              teams: 4,
              leader: null,
              home: null,
              away: null,
              places: 'not_supplied',
            },
          },
        }}
      />,
    );
    expect(html).toContain('Group A, before kick-off');
    expect(html).toContain('so there are no positions yet');
    expect(html).not.toContain('competition-context-side');
    expect(html).not.toContain('competition-context-form-scope');
  });

  it('gives a cup tie its round and legs, marks this match, and draws no table', () => {
    const html = renderToStaticMarkup(
      <CompetitionContextPanel
        locale="en"
        timeZone="UTC"
        context={{
          ...base,
          fixture_id: 'y',
          competition: { id: 'u', name: 'Test Cup', kind: 'cup' },
          round: 'Round of 16',
          knockout: {
            round: 'Round of 16',
            round_key: 'round_of_16',
            legs_expected: 2,
            tie: {
              teams: [team('c', 'Gamma'), team('d', 'Delta')],
              legs: [leg('x', { home: 2, away: 1 }, 1), leg('y', null, 2)],
              aggregate: null,
              winner: null,
              decided_by: null,
            },
          },
        }}
      />,
    );
    expect(html).toContain('data-state="knockout"');
    expect(html).not.toContain('competition-context-table');
    expect(html).toContain('Round of 16');
    expect(html).toContain('Two legs');
    expect(html).toContain('href="/en/match/x"');
    expect(html).toContain('(this match)');
    expect(html).toContain('Still to be decided');
  });

  it('says so in a sentence when there is neither a table nor a tie', () => {
    const none = renderToStaticMarkup(
      <CompetitionContextPanel
        locale="en"
        timeZone="UTC"
        context={{
          ...base,
          table: { coverage: 'not_supplied', last_updated_at: null, data: null },
        }}
      />,
    );
    expect(none).toContain('data-state="none"');
    expect(none).toContain('data-coverage="not_supplied"');
    expect(none).toContain('No table from before this match is in our records.');

    const unreachable = renderToStaticMarkup(
      <CompetitionContextPanel locale="en" timeZone="UTC" context={null} />,
    );
    expect(unreachable).toContain('data-state="unreachable"');
  });

  it("writes the season in the page's digits: «۲۰۸۵/۸۶» on /fa (T-1501)", () => {
    const render = (locale: string) =>
      renderToStaticMarkup(
        <CompetitionContextPanel
          locale={locale}
          timeZone="UTC"
          context={{
            ...base,
            table: { coverage: 'not_supplied', last_updated_at: null, data: null },
          }}
        />,
      );
    expect(render('fa')).toContain('<bdi>۲۰۸۵/۸۶</bdi>');
    expect(render('fa')).not.toContain('2085/86');
    expect(render('en')).toContain('<bdi>2085/86</bdi>');
  });
});
