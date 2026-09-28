import type { MatchAbsence } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import {
  availabilityOf,
  keyPlayersSide,
  pickKeyPlayers,
  type SeasonFigures,
} from './internal/key-players';

// T-841: "key" is a stated rule -- most minutes in the competition's season
// before the match -- not a judgement, and a doubt is shown as a doubt.

const player = (id: string, minutes: number, goals = 0, assists = 0): SeasonFigures => ({
  id,
  name: id.toUpperCase(),
  position: null,
  appearances: minutes > 0 ? 1 : 0,
  minutes,
  goals,
  assists,
});

describe('pickKeyPlayers', () => {
  it('takes the three with the most minutes, most first', () => {
    const picked = pickKeyPlayers([
      player('a', 450),
      player('b', 900),
      player('c', 90, 5, 5),
      player('d', 720),
      player('e', 810),
    ]);
    expect(picked.map((p) => p.id)).toEqual(['b', 'e', 'd']);
  });

  it('breaks a tie on minutes by goals plus assists, then the name, then the id', () => {
    const picked = pickKeyPlayers([
      player('zed', 900, 1, 0),
      player('amy', 900, 0, 0),
      player('bob', 900, 0, 2),
      player('ann', 900, 0, 0),
    ]);
    expect(picked.map((p) => p.id)).toEqual(['bob', 'zed', 'amy']);
  });

  it('never picks a player with no minutes, and picks fewer when fewer played', () => {
    expect(pickKeyPlayers([player('a', 0, 3), player('b', 12)]).map((p) => p.id)).toEqual(['b']);
  });

  it('is the same whatever order the rows come in (reproducible)', () => {
    const rows = [player('a', 90), player('b', 90), player('c', 180), player('d', 45)];
    const once = pickKeyPlayers(rows).map((p) => p.id);
    expect(pickKeyPlayers([...rows].reverse()).map((p) => p.id)).toEqual(once);
  });
});

describe('availabilityOf', () => {
  const absences: MatchAbsence[] = [
    {
      id: 'a',
      name: 'A',
      side: 'home',
      status: 'doubtful',
      kind: 'injury',
      reason: 'Hamstring',
      reported_at: '2086-01-01T00:00:00.000Z',
    },
    {
      id: 'b',
      name: 'B',
      side: 'home',
      status: 'out',
      kind: 'suspension',
      reason: 'Red card',
      reported_at: '2086-01-01T00:00:00.000Z',
    },
  ];
  const asked = '2086-01-02T00:00:00.000Z';

  it('claims nothing when the provider was never asked', () => {
    expect(availabilityOf('a', absences, null)).toBeNull();
    expect(availabilityOf('z', [], null)).toBeNull();
  });

  it('keeps a doubt a doubt and an absence an absence, with the reason', () => {
    expect(availabilityOf('a', absences, asked)).toEqual({
      status: 'doubtful',
      kind: 'injury',
      reason: 'Hamstring',
    });
    expect(availabilityOf('b', absences, asked)?.status).toBe('out');
  });

  it('says only that a player asked about is not on the list', () => {
    expect(availabilityOf('z', absences, asked)).toEqual({
      status: 'not_listed',
      kind: null,
      reason: null,
    });
  });
});

describe('keyPlayersSide', () => {
  const team = { id: 't', name: 'T' };
  const picked = [{ ...player('a', 900), availability: null }];
  const at = '2086-01-01T00:00:00.000Z';

  it('is available when every match played has figures', () => {
    const side = keyPlayersSide(team, { played: 10, withFigures: 10 }, picked, at);
    expect(side.coverage).toBe('available');
    expect(side.data).toMatchObject({ matches_played: 10, matches_with_figures: 10 });
  });

  it('is limited when some matches have none: the minutes are a floor', () => {
    expect(keyPlayersSide(team, { played: 10, withFigures: 7 }, picked, at).coverage).toBe(
      'limited',
    );
  });

  it('is not supplied when no match played has figures', () => {
    expect(keyPlayersSide(team, { played: 10, withFigures: 0 }, [], at)).toEqual({
      coverage: 'not_supplied',
      last_updated_at: at,
      data: null,
    });
  });

  it('says there is nothing to count before the first match', () => {
    expect(keyPlayersSide(team, { played: 0, withFigures: 0 }, [], null)).toEqual({
      coverage: 'available',
      last_updated_at: null,
      data: { team, matches_played: 0, matches_with_figures: 0, players: [] },
    });
  });
});
