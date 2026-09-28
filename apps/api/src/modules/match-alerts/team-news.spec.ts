import { describe, expect, it } from 'vitest';
import {
  type Absentee,
  type TeamNewsState,
  deriveTeamNews,
  keyTeamNews,
  teamNewsLine,
} from './internal/team-news';

/** T-832, D-100: team news and line-ups derived from two readings, keyed once. */
const FIXTURE = '11111111-1111-4111-8111-111111111111';
const TEAMS = { home: 'Arsenal', away: 'Chelsea' };

const saka: Absentee = { personId: 'p-saka', name: 'Saka', side: 'home', reason: 'injury' };
const james: Absentee = { personId: 'p-james', name: 'James', side: 'away', reason: null };

function state(overrides: Partial<TeamNewsState> = {}): TeamNewsState {
  return { status: 'scheduled', starters: { home: 0, away: 0 }, out: [], ...overrides };
}
const kinds = (before: TeamNewsState, after: TeamNewsState): string[] =>
  deriveTeamNews(before, after).map((e) =>
    e.kind === 'lineups' ? 'lineups' : `out:${e.absentee.personId}`,
  );

describe('deriveTeamNews', () => {
  it('announces the line-ups the moment both sides have starters', () => {
    const none = state();
    const one = state({ starters: { home: 11, away: 0 } });
    const both = state({ starters: { home: 11, away: 11 } });
    expect(kinds(none, one)).toEqual([]);
    expect(kinds(one, both)).toEqual(['lineups']);
    expect(kinds(none, both)).toEqual(['lineups']);
  });

  it('does not announce line-ups that were already here, or corrected', () => {
    const both = state({ starters: { home: 11, away: 11 } });
    expect(kinds(both, both)).toEqual([]);
    expect(kinds(both, state({ starters: { home: 11, away: 10 } }))).toEqual([]);
  });

  it('announces a line-up for a live match but not one that arrives after the whistle', () => {
    const both = { home: 11, away: 11 };
    expect(kinds(state({ status: 'live' }), state({ status: 'live', starters: both }))).toEqual([
      'lineups',
    ]);
    expect(
      kinds(state({ status: 'finished' }), state({ status: 'finished', starters: both })),
    ).toEqual([]);
    expect(
      kinds(state({ status: 'postponed' }), state({ status: 'postponed', starters: both })),
    ).toEqual([]);
  });

  it('announces each player newly listed out, before kick-off only', () => {
    expect(kinds(state(), state({ out: [saka, james] }))).toEqual(['out:p-saka', 'out:p-james']);
    expect(kinds(state({ out: [saka] }), state({ out: [saka, james] }))).toEqual(['out:p-james']);
    expect(kinds(state({ status: 'live' }), state({ status: 'live', out: [saka] }))).toEqual([]);
  });

  it('says nothing about a player no longer listed, and never names nobody', () => {
    expect(kinds(state({ out: [saka] }), state())).toEqual([]);
    expect(kinds(state(), state({ out: [{ ...saka, name: null }] }))).toEqual([]);
  });
});

describe('keyTeamNews', () => {
  it('keys one event per match and per player, and drops a key already there', () => {
    const events = deriveTeamNews(
      state(),
      state({ starters: { home: 11, away: 11 }, out: [saka] }),
    );
    const history = new Set<string>();
    const first = keyTeamNews(FIXTURE, events, history);
    expect(first.map((k) => [k.key, k.kind])).toEqual([
      [`${FIXTURE}:lineups`, 'match_lineups'],
      [`${FIXTURE}:out:p-saka`, 'match_availability'],
    ]);
    // The same events again -- a retry, a second process, a player listed,
    // dropped and listed again -- key to nothing new.
    expect(keyTeamNews(FIXTURE, events, history)).toEqual([]);
  });

  it('names the fixture in every key, as match_alert requires', () => {
    const keyed = keyTeamNews(FIXTURE, [{ kind: 'out', absentee: james }], new Set());
    expect(keyed.every((k) => k.key.startsWith(`${FIXTURE}:`))).toBe(true);
  });
});

describe('teamNewsLine', () => {
  it('reads the line-ups and a player out, with the reason where there is one', () => {
    expect(teamNewsLine({ kind: 'lineups' }, TEAMS)).toBe('Line-ups are in: Arsenal v Chelsea.');
    expect(teamNewsLine({ kind: 'out', absentee: saka }, TEAMS)).toBe(
      'Team news: Saka (Arsenal) will miss Arsenal v Chelsea, injured.',
    );
    expect(teamNewsLine({ kind: 'out', absentee: james }, TEAMS)).toBe(
      'Team news: James (Chelsea) will miss Arsenal v Chelsea.',
    );
    expect(
      teamNewsLine({ kind: 'out', absentee: { ...saka, side: null, reason: 'other' } }, TEAMS),
    ).toBe('Team news: Saka will miss Arsenal v Chelsea.');
  });
});
