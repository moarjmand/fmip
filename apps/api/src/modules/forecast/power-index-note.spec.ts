import { describe, expect, it } from 'vitest';
import { explainNote } from './internal/power-index-note';

/**
 * T-1602: every note the measures write reads back to a code and its numbers,
 * so a Persian page never shows the English sentence. The first twelve are
 * every note production held on 2026-10-26 (2,400 indexes).
 */
describe('a Power Index note in our words (T-1602)', () => {
  it('reads every note production holds, with its numbers', () => {
    const cases: [string, string, Record<string, number | string>][] = [
      [
        '4 days since the previous match, 2 in the last 14; travel not modelled',
        'rest_days',
        { days: 4, matches: 2, window: 14 },
      ],
      [
        'not modelled: needs the stakes of this stage and the team’s other commitments',
        'context_not_modelled',
        {},
      ],
      ['last 6 matches, adjusted for opponent strength', 'form_window', { matches: 6 }],
      ['the coach’s run this season and how much of the XI carries over', 'coach_and_xi', {}],
      ['expected: the last starting XI, by its players’ ratings this season', 'expected_xi', {}],
      ['home record over the last 20 matches', 'venue_record', { side: 'home', matches: 20 }],
      ['away record over the last 19 matches', 'venue_record', { side: 'away', matches: 19 }],
      ['the announced starting XI, by its players’ ratings this season', 'announced_xi', {}],
      ['fewer than 7 of the line-up have a rating this season', 'few_rated_starters', { min: 7 }],
      ['how much of the XI carries over only', 'xi_only', {}],
      [
        'expected: the last starting XI less 2 reported out, by their ratings this season',
        'expected_xi_less_out',
        { out: 2 },
      ],
      ['only 3 matches of history', 'thin_history', { matches: 3 }],
      ['the coach’s run this season only', 'coach_only', {}],
      ['no previous fixture on record, so rest cannot be measured', 'no_previous_fixture', {}],
      ['no line-up recorded for this team yet this season', 'no_lineup', {}],
      ['too few teams in this competition have a measurable line-up', 'few_measurable_lineups', {}],
      ['too few line-ups recorded this season to place the team', 'few_lineups', {}],
      ['no matches in the recent window', 'no_recent_matches', {}],
      ['no away matches in the window', 'no_venue_matches', { side: 'away' }],
      [
        'only 5 teams in this division have enough history to rank against',
        'few_ranked_teams',
        { teams: 5 },
      ],
      ['no recorded matches for Esteghlal in this division', 'no_recorded_matches', {}],
      ['no player ratings on the free data (D-049)', 'no_ratings_feed', {}],
      ['no manager or squad-stability feed on the free data (D-049)', 'no_stability_feed', {}],
    ];
    for (const [note, code, values] of cases) {
      expect([note, explainNote(note)]).toEqual([note, { code, values }]);
    }
  });

  it('says nothing for no note or one it cannot read, never the English', () => {
    expect(explainNote(null)).toBeNull();
    expect(explainNote(undefined)).toBeNull();
    expect(explainNote('something new')).toBeNull();
  });
});
