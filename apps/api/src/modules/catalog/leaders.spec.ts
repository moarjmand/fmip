import type { Covered } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import type { Scorer } from '../standings/standings.service';
import { minMinutesOf } from './catalog.controller';
import { leadersModule, leadersWithMinutes, reachesFloor } from './internal/leaders';
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
