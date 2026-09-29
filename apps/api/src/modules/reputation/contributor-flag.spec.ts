import { describe, expect, it } from 'vitest';
import {
  CONTRIBUTOR_FLAG_PROPOSED_PERIOD_DAYS,
  belowSince,
  flagPeriodDays,
  planFlags,
  stretchDue,
  type RatingPoint,
} from './internal/contributor-flag';

const day = (n: number) => new Date(Date.UTC(2026, 0, 1) + n * 86_400_000);
const points = (...pairs: [number, number][]): RatingPoint[] =>
  pairs.map(([d, rating]) => ({ at: day(d), rating }));

describe('flagPeriodDays (T-1031, D-137)', () => {
  it('is the proposal of 30 days unless the setting names another whole number of days', () => {
    expect(CONTRIBUTOR_FLAG_PROPOSED_PERIOD_DAYS).toBe(30);
    expect(flagPeriodDays({})).toBe(30);
    expect(flagPeriodDays({ CONTRIBUTOR_FLAG_PERIOD_DAYS: '45' })).toBe(45);
    for (const bad of ['0', '-3', '2.5', 'thirty', '366']) {
      expect(flagPeriodDays({ CONTRIBUTOR_FLAG_PERIOD_DAYS: bad })).toBe(30);
    }
  });
});

describe('belowSince', () => {
  it('is the start of the unbroken run below that ends with the newest rating', () => {
    expect(belowSince(points([0, 80], [5, 65], [9, 60]), 70)).toEqual(day(5));
    expect(belowSince(points([0, 65], [5, 80], [9, 60]), 70)).toEqual(day(9));
  });

  it('is null when the newest rating is at or above the threshold, or there is none', () => {
    expect(belowSince(points([0, 60], [5, 70]), 70)).toBeNull();
    expect(belowSince([], 70)).toBeNull();
  });
});

describe('stretchDue', () => {
  it('counts from the later of the stretch and the grant', () => {
    expect(stretchDue(day(0), day(0), day(30), 30)).toBe(true);
    expect(stretchDue(day(0), day(0), day(29), 30)).toBe(false);
    // Approved while already below: a contributor below only since the grant.
    expect(stretchDue(day(0), day(10), day(35), 30)).toBe(false);
    expect(stretchDue(day(0), day(10), day(40), 30)).toBe(true);
  });
});

describe('planFlags', () => {
  const holder = (userId: string, grantedAt = day(-100)) => ({
    userId,
    grantId: `g-${userId}`,
    grantedAt,
  });

  it('raises a flag for a stretch that lasted the period, and never pauses anybody', () => {
    const plan = planFlags(
      [holder('a'), holder('b')],
      [],
      new Map([
        ['a', points([0, 80], [1, 60])],
        ['b', points([0, 80], [20, 60])],
      ]),
      70,
      30,
      day(31),
    );
    expect(plan).toEqual({
      close: [],
      raise: [{ userId: 'a', grantId: 'g-a', belowSince: day(1), rating: 60 }],
    });
    expect(Object.keys(plan)).toEqual(['close', 'raise']);
  });

  it('leaves an open flag for the same stretch alone', () => {
    const plan = planFlags(
      [holder('a')],
      [{ id: 'f', userId: 'a', belowSince: day(1) }],
      new Map([['a', points([1, 60])]]),
      70,
      30,
      day(60),
    );
    expect(plan).toEqual({ close: [], raise: [] });
  });

  it('closes a flag whose member recovered, or whose stretch is no longer the current one', () => {
    const recovered = planFlags(
      [holder('a')],
      [{ id: 'f', userId: 'a', belowSince: day(1) }],
      new Map([['a', points([1, 60], [40, 72])]]),
      70,
      30,
      day(41),
    );
    expect(recovered.close).toEqual([{ id: 'f', reason: 'recovered' }]);

    const again = planFlags(
      [holder('a')],
      [{ id: 'f', userId: 'a', belowSince: day(1) }],
      new Map([['a', points([1, 60], [40, 72], [41, 65])]]),
      70,
      30,
      day(80),
    );
    expect(again.close).toEqual([{ id: 'f', reason: 'recovered' }]);
    expect(again.raise).toEqual([{ userId: 'a', grantId: 'g-a', belowSince: day(41), rating: 65 }]);
  });

  it('closes a flag once a person paused or withdrew the grant', () => {
    const plan = planFlags(
      [],
      [{ id: 'f', userId: 'a', belowSince: day(1) }],
      new Map([['a', points([1, 60])]]),
      70,
      30,
      day(60),
    );
    expect(plan.close).toEqual([{ id: 'f', reason: 'grant_not_live' }]);
  });

  it('does not treat a member with no rating as below', () => {
    expect(planFlags([holder('a')], [], new Map(), 70, 30, day(60)).raise).toEqual([]);
  });
});
