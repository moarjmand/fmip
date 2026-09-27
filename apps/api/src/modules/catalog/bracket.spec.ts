import { describe, expect, it } from 'vitest';
import { playsKnockoutBracket, seasonIsOpen } from './catalog.service';
import { buildBracket, roundKeyOf, type BracketFixture } from './internal/bracket';

// T-630: the knockout bracket from stored fixtures only. A round nobody has
// drawn is stated as such; a tie is never invented to fill it.

const team = (id: string) => ({ id, name: id.toUpperCase(), short_name: null });

let seq = 0;
function fixture(
  round: string | null,
  kickoff: string,
  home: string,
  away: string,
  score: [number, number] | null,
  over: Partial<BracketFixture> = {},
): BracketFixture {
  seq += 1;
  return {
    id: `f${String(seq).padStart(3, '0')}`,
    kickoff_at: `${kickoff}T20:00:00.000Z`,
    status: score === null ? 'scheduled' : 'finished',
    round,
    stage: null,
    leg: null,
    home: team(home),
    away: team(away),
    score: score === null ? null : { home: score[0], away: score[1] },
    after_extra_time: false,
    penalties: null,
    ...over,
  };
}

const LEAGUE = fixture('League Stage - 1', '2026-09-16', 'a', 'b', [1, 0]);

describe('roundKeyOf', () => {
  const after = '2026-09-16T20:00:00.000Z';
  it('reads the rounds the providers name', () => {
    expect(roundKeyOf('Knockout Round Play-offs', '2027-02-17', after)).toBe('knockout_playoff');
    expect(roundKeyOf('Round of 16', '2027-03-10', after)).toBe('round_of_16');
    expect(roundKeyOf('Round of 32', '2021-02-18', null)).toBe('round_of_32');
    expect(roundKeyOf('Quarter-finals', '2027-04-07', after)).toBe('quarter_final');
    expect(roundKeyOf('Semi-finals', '2027-04-28', after)).toBe('semi_final');
    expect(roundKeyOf('Final', '2027-05-29', after)).toBe('final');
    expect(roundKeyOf('8th Finals', '2027-03-10', after)).toBeNull();
  });

  it('never takes the league stage, a group or a qualifying round for a knockout round', () => {
    expect(roundKeyOf('League Stage - 8', '2027-01-28', after)).toBeNull();
    expect(roundKeyOf('Group A - 6', '2020-12-09', null)).toBeNull();
    expect(roundKeyOf('3rd Qualifying Round', '2026-08-05', after)).toBeNull();
    expect(roundKeyOf('Semi-finals Qualifying', '2026-08-05', after)).toBeNull();
    expect(roundKeyOf(null, '2027-02-17', after)).toBeNull();
  });

  it('counts a bare play-off only once the league stage has begun', () => {
    // The Conference League's August qualifying play-off is "Playoff round".
    expect(roundKeyOf('Playoff round', '2026-08-20T19:00:00.000Z', after)).toBeNull();
    expect(roundKeyOf('Play-offs', '2027-02-17T20:00:00.000Z', after)).toBe('knockout_playoff');
    expect(roundKeyOf('Play-offs', '2027-02-17T20:00:00.000Z', null)).toBeNull();
  });
});

describe('buildBracket', () => {
  it('states every round of a running season with nothing drawn, and invents no tie', () => {
    const bracket = buildBracket([LEAGUE], true);
    expect(bracket.rounds.map((r) => [r.key, r.state, r.ties.length])).toEqual([
      ['knockout_playoff', 'not_drawn', 0],
      ['round_of_16', 'not_drawn', 0],
      ['quarter_final', 'not_drawn', 0],
      ['semi_final', 'not_drawn', 0],
      ['final', 'not_drawn', 0],
    ]);
    expect(bracket.rounds.map((r) => r.expected_ties)).toEqual([8, 8, 4, 2, 1]);
  });

  it('pairs two legs of the same two teams into one tie with the aggregate', () => {
    const bracket = buildBracket(
      [
        LEAGUE,
        fixture('Round of 16', '2027-03-17', 'b', 'a', [2, 0]),
        fixture('Round of 16', '2027-03-10', 'a', 'b', [3, 0]),
        fixture('Round of 16', '2027-03-11', 'c', 'd', [1, 1]),
      ],
      true,
    );
    const r16 = bracket.rounds.find((r) => r.key === 'round_of_16')!;
    expect(r16.state).toBe('drawn');
    expect(r16.ties).toHaveLength(2);
    const [ab, cd] = r16.ties;
    expect(ab!.teams.map((t) => t.id)).toEqual(['a', 'b']);
    expect(ab!.legs.map((l) => [l.leg, l.home.id])).toEqual([
      [1, 'a'],
      [2, 'b'],
    ]);
    expect(ab!.aggregate).toEqual([3, 2]);
    expect(ab!.winner?.id).toBe('a');
    expect(ab!.decided_by).toBe('aggregate');
    // One leg played of two: no aggregate, no winner.
    expect(cd!.legs).toHaveLength(1);
    expect(cd!.aggregate).toBeNull();
    expect(cd!.winner).toBeNull();
    // The play-offs were not in our records, but the round of 16 is: not awaited.
    expect(bracket.rounds[0]!.key).toBe('round_of_16');
    expect(bracket.rounds.slice(1).map((r) => r.state)).toEqual([
      'not_drawn',
      'not_drawn',
      'not_drawn',
    ]);
  });

  it('decides nothing while a leg is still to play or live', () => {
    const bracket = buildBracket(
      [
        fixture('Quarter-finals', '2027-04-07', 'a', 'b', [4, 0]),
        fixture('Quarter-finals', '2027-04-14', 'b', 'a', [0, 0], { status: 'live' }),
      ],
      true,
    );
    const tie = bracket.rounds.find((r) => r.key === 'quarter_final')!.ties[0]!;
    expect(tie.legs[1]!.status).toBe('live');
    expect(tie.aggregate).toBeNull();
    expect(tie.winner).toBeNull();
  });

  it('decides a level tie on the shoot-out of the second leg', () => {
    const bracket = buildBracket(
      [
        fixture('Semi-finals', '2027-04-28', 'a', 'b', [1, 0]),
        fixture('Semi-finals', '2027-05-05', 'b', 'a', [2, 1], {
          after_extra_time: true,
          penalties: { home: 5, away: 4 },
        }),
      ],
      true,
    );
    const tie = bracket.rounds.find((r) => r.key === 'semi_final')!.ties[0]!;
    expect(tie.aggregate).toEqual([2, 2]);
    expect(tie.winner?.id).toBe('b');
    expect(tie.decided_by).toBe('penalties');
    expect(tie.legs[1]!.after_extra_time).toBe(true);
  });

  it('leaves a level tie with no shoot-out in our records undecided', () => {
    const bracket = buildBracket(
      [
        fixture('Semi-finals', '2027-04-28', 'a', 'b', [1, 1]),
        fixture('Semi-finals', '2027-05-05', 'b', 'a', [0, 0]),
      ],
      true,
    );
    const tie = bracket.rounds.find((r) => r.key === 'semi_final')!.ties[0]!;
    expect(tie.aggregate).toEqual([1, 1]);
    expect(tie.winner).toBeNull();
    expect(tie.decided_by).toBeNull();
  });

  it('plays the final as one match, decided on the score or the shoot-out', () => {
    const won = buildBracket([fixture('Final', '2027-05-29', 'a', 'b', [0, 2])], true);
    const final = won.rounds.find((r) => r.key === 'final')!;
    expect(final.legs).toBe(1);
    expect(final.ties[0]!.aggregate).toBeNull();
    expect(final.ties[0]!.winner?.id).toBe('b');
    expect(final.ties[0]!.decided_by).toBe('score');

    const shootout = buildBracket(
      [fixture('Final', '2027-05-29', 'a', 'b', [1, 1], { penalties: { home: 3, away: 2 } })],
      true,
    );
    const tie = shootout.rounds.find((r) => r.key === 'final')!.ties[0]!;
    expect(tie.winner?.id).toBe('a');
    expect(tie.decided_by).toBe('penalties');
  });

  it('refuses to decide a tie whose legs our records do not all hold', () => {
    const bracket = buildBracket([fixture('Round of 16', '2027-03-17', 'b', 'a', [2, 0])], false);
    const tie = bracket.rounds.find((r) => r.key === 'round_of_16')!.ties[0]!;
    expect(tie.winner).toBeNull();
  });

  it('calls a missing round of a finished season not supplied, never not drawn', () => {
    const bracket = buildBracket(
      [
        fixture('Group A - 1', '2020-10-20', 'a', 'b', [1, 0]),
        fixture('Round of 16', '2021-02-16', 'a', 'b', [1, 0]),
        fixture('Round of 16', '2021-03-09', 'b', 'a', [0, 0]),
        fixture('Semi-finals', '2021-04-27', 'a', 'c', [1, 0]),
        fixture('Semi-finals', '2021-05-04', 'c', 'a', [0, 0]),
      ],
      false,
    );
    expect(bracket.rounds.map((r) => [r.key, r.state])).toEqual([
      ['round_of_16', 'drawn'],
      ['quarter_final', 'not_supplied'],
      ['semi_final', 'drawn'],
      ['final', 'not_supplied'],
    ]);
  });

  it('takes the stage name when the round is missing and orders ties by first kick-off', () => {
    const bracket = buildBracket(
      [
        fixture(null, '2027-02-18', 'e', 'f', null, {
          stage: { name: 'Knockout Round Play-offs', kind: 'playoff' },
        }),
        fixture(null, '2027-02-17', 'c', 'd', null, {
          stage: { name: 'Knockout Round Play-offs', kind: 'playoff' },
        }),
      ],
      true,
    );
    const playoffs = bracket.rounds[0]!;
    expect(playoffs.key).toBe('knockout_playoff');
    expect(playoffs.ties.map((t) => t.teams[0].id)).toEqual(['c', 'e']);
    expect(playoffs.ties.every((t) => t.winner === null)).toBe(true);
  });

  it('keeps a stated leg number over the kick-off order', () => {
    const bracket = buildBracket(
      [fixture('Round of 16', '2027-03-10', 'a', 'b', null, { leg: 2 })],
      true,
    );
    expect(bracket.rounds.find((r) => r.key === 'round_of_16')!.ties[0]!.legs[0]!.leg).toBe(2);
  });
});

describe('which competitions and seasons', () => {
  it('draws a bracket for the continental cups only', () => {
    expect(playsKnockoutBracket({ kind: 'cup', scope: 'continental' })).toBe(true);
    expect(playsKnockoutBracket({ kind: 'league', scope: 'domestic' })).toBe(false);
    expect(playsKnockoutBracket({ kind: 'cup', scope: 'domestic' })).toBe(false);
  });

  it('treats the current season, or one not yet over, as running', () => {
    const season = { id: 's', label: '2026/27', start_date: '2026-07-07', end_date: '2027-01-27' };
    const now = new Date('2027-03-01T00:00:00Z');
    expect(seasonIsOpen({ ...season, is_current: true }, now)).toBe(true);
    expect(seasonIsOpen({ ...season, is_current: false }, now)).toBe(false);
    expect(seasonIsOpen({ ...season, is_current: false }, new Date('2027-01-27T12:00:00Z'))).toBe(
      true,
    );
  });
});
