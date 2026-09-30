import type {
  SquadPlayer,
  TeamCompetitionSplits,
  TeamPageFixture,
  TeamStatAverage,
} from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import {
  notSuppliedNote,
  SPLITS_FOOTNOTE,
  averageCell,
  afterTimeNote,
  averageNote,
  contextLine,
  fromTeamSide,
  groupSquad,
  splitNotes,
} from './team';

const player = (
  name: string,
  position: SquadPlayer['position'],
  shirt: number | null,
): SquadPlayer => ({
  person: { id: name, name },
  shirt_number: shirt,
  position,
  on_loan: false,
  since: '2024-07-01',
  minutes: {
    coverage: 'not_supplied',
    total: null,
    matches: 0,
    matches_with_minutes: 0,
    supplied_minutes: 0,
  },
});

const fixture = (over: Partial<TeamPageFixture> = {}): TeamPageFixture => ({
  id: 'f1',
  kickoff_at: '2025-09-01T15:00:00.000Z',
  status: 'finished',
  round: null,
  stage: null,
  competition: { id: 'c', name: 'Test League', short_name: null },
  season: { id: 's', label: '2025/26' },
  home: { id: 'a', name: 'Test Alpha', short_name: 'ALP' },
  away: { id: 'b', name: 'Test Beta', short_name: null },
  score: { home: 2, away: 0 },
  after_extra_time: false,
  penalties: null,
  ...over,
});

describe('groupSquad', () => {
  it('groups by position in pitch order, shirts ascending, unknown last, empty groups left out', () => {
    const groups = groupSquad([
      player('Nine', 'forward', 9),
      player('One', 'goalkeeper', 1),
      player('Mystery', null, null),
      player('Seven', 'forward', 7),
      player('NoShirt', 'forward', null),
    ]);
    expect(groups.map((g) => g.label)).toEqual([
      'Goalkeepers',
      'Forwards',
      'Position not recorded',
    ]);
    expect(groups[1]!.players.map((p) => p.person.name)).toEqual(['Seven', 'Nine', 'NoShirt']);
  });
});

describe('labels', () => {
  it('reads a match from the team side', () => {
    expect(fromTeamSide(fixture(), 'a')).toEqual({
      opponent: 'Test Beta',
      home: true,
      result: 'W',
      shootout: null,
    });
    expect(fromTeamSide(fixture(), 'b')).toEqual({
      opponent: 'ALP',
      home: false,
      result: 'L',
      shootout: null,
    });
    expect(fromTeamSide(fixture({ score: { home: 1, away: 1 } }), 'b').result).toBe('D');
    expect(fromTeamSide(fixture({ status: 'scheduled', score: null }), 'a').result).toBeNull();
  });

  it('reads the result after extra time: 1–1 at ninety, 2–1 aet is a win (T-632)', () => {
    // The API sends the latest score, as the bracket and the figures read it.
    const aet = fixture({ score: { home: 2, away: 1 }, after_extra_time: true });
    expect(fromTeamSide(aet, 'a')).toMatchObject({ result: 'W', shootout: null });
    expect(fromTeamSide(aet, 'b').result).toBe('L');
    expect(afterTimeNote(aet, 'a')).toBe('aet');
    expect(afterTimeNote(fixture(), 'a')).toBeNull();
  });

  it('shows a tie settled on penalties as a draw, with who won the shoot-out beside it', () => {
    const pens = fixture({
      score: { home: 2, away: 2 },
      after_extra_time: true,
      penalties: { home: 3, away: 4 },
    });
    expect(fromTeamSide(pens, 'a')).toMatchObject({ result: 'D', shootout: 'lost' });
    expect(fromTeamSide(pens, 'b')).toMatchObject({ result: 'D', shootout: 'won' });
    expect(afterTimeNote(pens, 'a')).toBe('aet, lost 3–4 on penalties');
    expect(afterTimeNote(pens, 'b')).toBe('aet, won 4–3 on penalties');
  });

  it('spells the table position by the locale’s ordinal rules', () => {
    // The ordinal comes from the catalogue by CLDR rules now (T-301); the
    // teens, which the hand-rolled version had to special-case, are covered
    // in messages.spec.ts. A locale with no translation yet gets the English
    // forms by English rules, and that is asserted rather than assumed.
    expect(contextLine('en', { position: 3, total: 20, points: 45, rows: [] })).toBe(
      '3rd of 20 · 45 pts',
    );
    expect(contextLine('en', { position: 22, total: 24, points: 1, rows: [] })).toMatch(/^22nd/);
    expect(contextLine('fr', { position: 3, total: 20, points: 45, rows: [] })).toBe(
      '3rd of 20 · 45 pts',
    );
  });
});

// T-632: the home / away / total table's cells and notes.
const average = (over: Partial<TeamStatAverage> = {}): TeamStatAverage => ({
  metric: 'shots',
  coverage: 'available',
  matches_with_figure: { home: 2, away: 2, total: 4 },
  home: 12.5,
  away: 9,
  total: 10.75,
  ...over,
});

const record = {
  played: 0,
  won: 0,
  drawn: 0,
  lost: 0,
  goals_for: 0,
  goals_against: 0,
  clean_sheets: 0,
};
const splits = (over: Partial<TeamCompetitionSplits> = {}): TeamCompetitionSplits => ({
  competition: { id: 'c', name: 'Test Cup', short_name: null },
  season: { id: 's', label: '2025/26', is_current: true },
  home: record,
  away: record,
  total: record,
  penalty_shootouts: 0,
  finished_without_score: 0,
  averages: [],
  last_updated_at: null,
  ...over,
});

describe('home and away figures', () => {
  it('prints an average to one decimal, a percentage as one, and a dash for a missing split', () => {
    expect(averageCell('en', average(), 'home')).toBe('12.5');
    expect(averageCell('en', average(), 'away')).toBe('9.0');
    expect(averageCell('en', average(), 'total')).toBe('10.8');
    const possession = average({ metric: 'possession_pct', home: 54.25 });
    expect(averageCell('en', possession, 'home')).toBe('54.3%');
    expect(averageCell('en', average({ away: null }), 'away')).toBe('–');
  });

  it('says why an average row is short, and nothing when it is complete', () => {
    expect(averageNote(average(), 4)).toBeNull();
    expect(averageNote(average({ coverage: 'not_supplied' }), 4)).toBe(
      'Not supplied for these matches',
    );
    expect(
      averageNote(
        average({ coverage: 'limited', matches_with_figure: { home: 2, away: 1, total: 3 } }),
        4,
      ),
    ).toBe('Held for 3 of 4 matches; no average where a match lacks it');
  });

  it('names shoot-outs and unscored matches only when there are some', () => {
    expect(splitNotes(splits())).toEqual([]);
    expect(splitNotes(splits({ penalty_shootouts: 1, finished_without_score: 2 }))).toEqual([
      '1 match went to penalties, counted as a draw.',
      '2 finished matches have no score on record and are not counted.',
    ]);
    expect(SPLITS_FOOTNOTE).toMatch(/penalties counts as a draw/);
  });
});

describe('notSuppliedNote (T-1205)', () => {
  it('names every missing figure once, in one sentence', () => {
    expect(notSuppliedNote(['Possession'])).toBe('Not supplied for these matches: Possession.');
    expect(notSuppliedNote(['Possession', 'Shots', 'Expected goals'])).toBe(
      'Not supplied for these matches: Possession, shots and expected goals.',
    );
  });
});
