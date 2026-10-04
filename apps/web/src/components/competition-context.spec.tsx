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
    expect(html.match(/data-testid="competition-context-side"/g)).toHaveLength(2);
    expect(html).toContain('2nd of 4 · 3 pts from 2 played');
    expect(html).toContain('<span dir="auto">W L</span>');
    // The form here is this competition's only, told apart from Recent form (T-1364).
    expect(html).toContain('Form in this competition only, latest first:');
    expect(html.match(/data-testid="competition-context-form-scope"/g)).toHaveLength(1);
    expect(html).toContain('Recent form counts the last five in every competition.');
    expect(html).toContain('<bdi>Alpha</bdi>, 6 pts');
    expect(html).toContain('From the 4 finished matches of this table played before kick-off.');
    expect(html).toContain('no gap to them is shown');
    expect(html).toContain('href="/en/team/b"');
    // Stacked on a phone, side by side from `sm`.
    expect(html).toContain('grid-cols-1 gap-3 sm:grid-cols-2');
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
});
