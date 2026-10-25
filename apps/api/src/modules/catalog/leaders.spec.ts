import type { Covered } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import type { Scorer } from '../standings/standings.service';
import { minMinutesOf } from './catalog.controller';
import {
  appearancesOf,
  candidatesForTop,
  leadersModule,
  leadersWithMinutes,
  rankByFigure,
  reachesFloor,
  teamTopScorers,
  wholeOnlyIfRecorded,
} from './internal/leaders';
import { NO_LINEUPS, seasonMinutes } from './internal/player-store';

const scorer = (id: string, goals: number): Scorer => ({
  person: { id, name: id },
  team: { id: 't', name: 'Team' },
  goals,
});

describe('reachesFloor (T-824)', () => {
  it('judges a whole season by its total', () => {
    expect(reachesFloor(seasonMinutes(10, 10, 900), 900)).toBe(true);
    expect(reachesFloor(seasonMinutes(10, 10, 899), 900)).toBe(false);
  });

  it('takes a limited season as "at least" its supplied minutes', () => {
    expect(reachesFloor(seasonMinutes(12, 10, 950), 900)).toBe(true);
    // Short on paper, but two matches carry no minutes: it cannot say.
    expect(reachesFloor(seasonMinutes(12, 10, 850), 900)).toBeNull();
  });

  it('cannot judge minutes that were never supplied or never recorded', () => {
    expect(reachesFloor(seasonMinutes(5, 0, 0), 90)).toBeNull();
    expect(reachesFloor(NO_LINEUPS, 90)).toBeNull();
  });
});

describe('leadersWithMinutes (T-824)', () => {
  const minutes = new Map([
    ['a', seasonMinutes(10, 10, 900)],
    ['b', seasonMinutes(10, 10, 300)],
    ['c', seasonMinutes(10, 6, 500)],
    ['d', seasonMinutes(10, 9, 1000)],
  ]);
  const scorers = [scorer('a', 9), scorer('b', 8), scorer('c', 7), scorer('d', 6), scorer('e', 5)];

  it('attaches minutes to every leader without a floor, and says so when none are on record', () => {
    const { leaders, unproven } = leadersWithMinutes(scorers, minutes, null, 10);
    expect(leaders.map((l) => l.person.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(leaders[0]!.minutes.total).toBe(900);
    expect(leaders[4]!.minutes).toEqual(NO_LINEUPS);
    expect(unproven).toBe(0);
  });

  it('keeps only the proven, in goals order, and counts the ones it cannot judge', () => {
    const { leaders, unproven } = leadersWithMinutes(scorers, minutes, 600, 10);
    expect(leaders.map((l) => l.person.id)).toEqual(['a', 'd']);
    // c (limited below the floor) and e (no line-ups); b is known to be short.
    expect(unproven).toBe(2);
  });

  it('takes the first `limit` that pass, not the first `limit` scorers', () => {
    const { leaders } = leadersWithMinutes(scorers, minutes, 600, 1);
    expect(leaders.map((l) => l.person.id)).toEqual(['a']);
  });
});

describe('leadersWithMinutes on a board beyond goals (T-943)', () => {
  it('keeps the board its own figures and order, under the same floor', () => {
    const cards = [
      { person: { id: 'b', name: 'b' }, team: null, yellow_cards: 1, red_cards: 1 },
      { person: { id: 'a', name: 'a' }, team: null, yellow_cards: 5, red_cards: 0 },
    ];
    const minutes = new Map([
      ['a', seasonMinutes(10, 10, 900)],
      ['b', seasonMinutes(3, 0, 0)],
    ]);
    const all = leadersWithMinutes(cards, minutes, null, 10);
    expect(all.leaders.map((l) => [l.person.id, l.red_cards, l.yellow_cards])).toEqual([
      ['b', 1, 1],
      ['a', 0, 5],
    ]);
    const floored = leadersWithMinutes(cards, minutes, 450, 10);
    expect(floored.leaders.map((l) => l.person.id)).toEqual(['a']);
    expect(floored.unproven).toBe(1);
  });
});

describe('leadersModule (T-824)', () => {
  const available: Covered<Scorer[]> = {
    coverage: 'available',
    last_updated_at: '2026-09-01T00:00:00.000Z',
    data: [scorer('a', 1)],
  };

  it('is limited when a scorer was left out for want of minutes', () => {
    expect(leadersModule(available, { leaders: [], unproven: 1 })).toEqual({
      coverage: 'limited',
      last_updated_at: '2026-09-01T00:00:00.000Z',
      data: [],
    });
  });

  it('keeps the declared state when every scorer could be judged', () => {
    expect(leadersModule(available, { leaders: [], unproven: 0 }).coverage).toBe('available');
  });

  it('stays absent when there are no scorers at all', () => {
    const none: Covered<Scorer[]> = { coverage: 'not_supplied', last_updated_at: null, data: null };
    expect(leadersModule(none, { leaders: [], unproven: 0 })).toEqual(none);
  });
});

describe('minMinutesOf (T-824)', () => {
  it('reads a whole number of minutes, and 0 or nothing as no floor', () => {
    expect(minMinutesOf('900')).toEqual({ ok: true, value: 900 });
    expect(minMinutesOf(['450', '900'])).toEqual({ ok: true, value: 450 });
    expect(minMinutesOf('0')).toEqual({ ok: true, value: null });
    expect(minMinutesOf(undefined)).toEqual({ ok: true, value: null });
  });

  it('refuses anything else rather than guessing', () => {
    for (const bad of ['-1', '9.5', 'lots', '10001', '999999']) {
      expect(minMinutesOf(bad)).toEqual({ ok: false });
    }
  });
});

describe('rankByFigure (T-1441)', () => {
  const row = (id: string, name: string, goals: number) => ({ person: { id, name }, goals });
  const apps = new Map([
    ['a', seasonMinutes(30, 30, 2700)],
    ['b', seasonMinutes(12, 12, 1000)],
    ['c', seasonMinutes(12, 12, 1100)],
  ]);

  it('orders by the figure, then fewer appearances, then name', () => {
    const rows = [row('a', 'Zed', 9), row('b', 'Yan', 9), row('c', 'Abe', 9), row('d', 'Top', 10)];
    expect(rankByFigure(rows, (r) => r.goals, apps).map((r) => r.person.id)).toEqual([
      'd', // most goals
      'c', // 9 goals in 12 matches, level with b: "Abe" before "Yan"
      'b',
      'a', // 9 goals in 30 matches
    ]);
  });

  it('puts a player whose appearances are not recorded after those whose are, then by name', () => {
    const rows = [row('x', 'Ann', 5), row('b', 'Bea', 5), row('y', 'Cal', 5)];
    expect(rankByFigure(rows, (r) => r.goals, apps).map((r) => r.person.id)).toEqual([
      'b',
      'x',
      'y',
    ]);
  });

  it('falls back to the id so the order never depends on the query', () => {
    const rows = [row('2', 'Same', 3), row('1', 'Same', 3)];
    expect(rankByFigure(rows, (r) => r.goals, new Map()).map((r) => r.person.id)).toEqual([
      '1',
      '2',
    ]);
  });

  it('does not change its input', () => {
    const rows = [row('a', 'A', 1), row('b', 'B', 2)];
    rankByFigure(rows, (r) => r.goals, new Map());
    expect(rows.map((r) => r.person.id)).toEqual(['a', 'b']);
  });
});

describe('candidatesForTop (T-1441)', () => {
  const figures = [5, 4, 4, 4, 3, 1];
  it('keeps every row tied at the cut-off, so the tie-break can choose among them', () => {
    expect(candidatesForTop(figures, (n) => n, 2)).toEqual([5, 4, 4, 4]);
  });
  it('keeps all rows when there are no more than the limit', () => {
    expect(candidatesForTop(figures, (n) => n, 10)).toEqual(figures);
  });
  it('cuts cleanly where the limit falls between figures', () => {
    expect(candidatesForTop(figures, (n) => n, 1)).toEqual([5]);
  });
});

describe('appearancesOf (T-1441)', () => {
  it('is the matches played, and null when no line-up names the player', () => {
    expect(appearancesOf(seasonMinutes(7, 7, 600))).toBe(7);
    expect(appearancesOf(NO_LINEUPS)).toBeNull();
  });
});

describe('wholeOnlyIfRecorded (T-1441)', () => {
  const module: Covered<number[]> = { coverage: 'available', last_updated_at: null, data: [1] };
  it('downgrades to limited when fewer goals are recorded than the scores add up to', () => {
    expect(wholeOnlyIfRecorded(module, { scoredGoals: 10, recordedGoals: 9 }).coverage).toBe(
      'limited',
    );
  });
  it('leaves a fully recorded season as it was declared', () => {
    expect(wholeOnlyIfRecorded(module, { scoredGoals: 10, recordedGoals: 10 }).coverage).toBe(
      'available',
    );
  });
  it('never upgrades or touches a module that is already less than available', () => {
    const delayed: Covered<number[]> = { ...module, coverage: 'delayed' };
    expect(wholeOnlyIfRecorded(delayed, { scoredGoals: 10, recordedGoals: 0 })).toBe(delayed);
  });
});

describe('teamTopScorers (T-1528)', () => {
  const row = (id: string, team: string | null, goals: number): Scorer => ({
    person: { id, name: id },
    team: team === null ? null : { id: team, name: team },
    goals,
  });
  const module = (data: Scorer[] | null): Covered<Scorer[]> => ({
    coverage: data === null ? 'not_supplied' : 'limited',
    last_updated_at: data === null ? null : '2026-10-01T00:00:00.000Z',
    data,
  });

  it('keeps the club’s goals only, and every player level on the most, by name', () => {
    const season = module([
      row('zed', 'other', 9),
      row('bea', 'club', 4),
      row('amy', 'club', 4),
      row('cal', 'club', 2),
      row('dan', null, 5),
    ]);
    const top = teamTopScorers(season, 'club');
    expect(top.data!.map((r) => r.person.id)).toEqual(['amy', 'bea']);
    expect(top.coverage).toBe('limited');
    expect(top.last_updated_at).toBe('2026-10-01T00:00:00.000Z');
  });

  it('is an empty list for a club with no recorded goal, and not_supplied stays so', () => {
    expect(teamTopScorers(module([row('zed', 'other', 3)]), 'club').data).toEqual([]);
    const none = teamTopScorers(module(null), 'club');
    expect(none).toEqual({ coverage: 'not_supplied', last_updated_at: null, data: null });
  });
});
