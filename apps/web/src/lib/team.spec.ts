import type { SquadPlayer, TeamFixture } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import { contextLine, fromTeamSide, groupSquad } from './team';

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
});

const fixture = (over: Partial<TeamFixture> = {}): TeamFixture => ({
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
    });
    expect(fromTeamSide(fixture(), 'b')).toEqual({ opponent: 'ALP', home: false, result: 'L' });
    expect(fromTeamSide(fixture({ score: { home: 1, away: 1 } }), 'b').result).toBe('D');
    expect(fromTeamSide(fixture({ status: 'scheduled', score: null }), 'a').result).toBeNull();
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
