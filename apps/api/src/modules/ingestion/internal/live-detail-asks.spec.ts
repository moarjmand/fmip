import { describe, expect, it } from 'vitest';
import {
  LIVE_DETAIL_MINUTES,
  LIVE_DETAIL_PER_TICK,
  forgetOldAsks,
  liveDetailAsks,
  liveDetailMinutes,
} from './live-detail-asks';

const NOW = new Date('2026-11-07T16:00:00Z');
const minutesAgo = (n: number): number => NOW.getTime() - n * 60_000;

function match(n: number, kickoffAt = '2026-11-07T15:00:00Z') {
  return { fixtureId: `f${String(n).padStart(3, '0')}`, externalId: `${n}`, kickoffAt };
}

describe('liveDetailMinutes (T-1782)', () => {
  it('is 3 unless set, 0 turns it off, and anything else is the default', () => {
    expect(liveDetailMinutes(undefined)).toBe(LIVE_DETAIL_MINUTES);
    expect(liveDetailMinutes('')).toBe(3);
    expect(liveDetailMinutes(' 5 ')).toBe(5);
    expect(liveDetailMinutes('0')).toBe(0);
    expect(liveDetailMinutes('30')).toBe(30);
    expect(liveDetailMinutes('31')).toBe(3);
    expect(liveDetailMinutes('-1')).toBe(3);
    expect(liveDetailMinutes('2.5')).toBe(3);
    expect(liveDetailMinutes('often')).toBe(3);
  });
});

describe('liveDetailAsks (T-1782)', () => {
  it('asks a match never asked, and again only once the interval has passed', () => {
    const a = match(1);
    expect(liveDetailAsks([a], new Map(), NOW, 3)).toEqual([a]);
    expect(liveDetailAsks([a], new Map([[a.fixtureId, minutesAgo(2)]]), NOW, 3)).toEqual([]);
    expect(liveDetailAsks([a], new Map([[a.fixtureId, minutesAgo(3)]]), NOW, 3)).toEqual([a]);
  });

  it('asks nothing when switched off', () => {
    expect(liveDetailAsks([match(1)], new Map(), NOW, 0)).toEqual([]);
  });

  it('puts the never-asked first, then the longest ago, then the earlier kick-off', () => {
    const old = match(1, '2026-11-07T14:30:00Z');
    const fresh = match(2, '2026-11-07T15:00:00Z');
    const neverLate = match(3, '2026-11-07T15:15:00Z');
    const neverEarly = match(4, '2026-11-07T14:30:00Z');
    const askedAt = new Map([
      [old.fixtureId, minutesAgo(9)],
      [fresh.fixtureId, minutesAgo(4)],
    ]);
    expect(liveDetailAsks([fresh, neverLate, old, neverEarly], askedAt, NOW, 3)).toEqual([
      neverEarly,
      neverLate,
      old,
      fresh,
    ]);
  });

  it('spreads a crowded tick: at most the cap, the rest first on the next tick', () => {
    // 62 matches in play at once, the busiest minute of 2026-11-01..07.
    const all = Array.from({ length: 62 }, (_, i) => match(i + 1));
    const askedAt = new Map<string, number>();
    const asked = new Set<string>();
    for (let tick = 0; tick < 5; tick += 1) {
      const now = new Date(NOW.getTime() + tick * 60_000);
      const asks = liveDetailAsks(all, askedAt, now, 3);
      expect(asks.length).toBeLessThanOrEqual(LIVE_DETAIL_PER_TICK);
      for (const a of asks) {
        askedAt.set(a.fixtureId, now.getTime());
        asked.add(a.fixtureId);
      }
    }
    // Every match asked within five ticks, none left behind by its order.
    expect(asked.size).toBe(62);
  });

  it('counts a match the list carried twice once', () => {
    const a = match(1);
    expect(liveDetailAsks([a, a], new Map(), NOW, 3)).toEqual([a]);
  });
});

describe('forgetOldAsks', () => {
  it('drops asks older than six hours and keeps the rest', () => {
    const askedAt = new Map([
      ['old', minutesAgo(6 * 60 + 1)],
      ['recent', minutesAgo(10)],
    ]);
    forgetOldAsks(askedAt, NOW);
    expect([...askedAt.keys()]).toEqual(['recent']);
  });
});
