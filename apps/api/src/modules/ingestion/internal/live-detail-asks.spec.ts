import { describe, expect, it } from 'vitest';
import {
  LIVE_DETAIL_DEADLINE_MS,
  LIVE_DETAIL_MINUTES,
  askUntilDeadline,
  LIVE_DETAIL_PER_TICK,
  forgetOldAsks,
  liveDetailAsks,
  liveDetailBudgetLeft,
  liveDetailMinutes,
  recentDetailCandidates,
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

describe('askUntilDeadline (T-1782, B1)', () => {
  /** A clock that moves `perAsk` ms with every ask. */
  function run(startedAt: number, perAsk: number, n = 6) {
    let t = 0;
    const asked: number[] = [];
    return askUntilDeadline(
      Array.from({ length: n }, (_, i) => i),
      async (i) => {
        asked.push(i);
        t += perAsk;
      },
      { startedAt, clock: () => t },
    ).then((started) => ({ started, asked }));
  }

  it('starts no ask once 20 s of the tick have gone; one under way is not cut', async () => {
    // Asks start at 0, 8 and 16 s; at 24 s none starts.
    expect(await run(0, 8_000)).toEqual({ started: 3, asked: [0, 1, 2] });
    // The third starts at 19.5 s and is let finish.
    expect((await run(0, 6_500)).asked).toEqual([0, 1, 2, 3]);
  });

  it('asks nothing when the list itself took the tick’s 20 s', async () => {
    expect(await run(-LIVE_DETAIL_DEADLINE_MS, 1)).toEqual({ started: 0, asked: [] });
  });

  it('asks them all when they fit', async () => {
    expect((await run(0, 100)).started).toBe(6);
  });
});

describe('liveDetailBudgetLeft (T-1782, N5)', () => {
  it('is the standard ceiling less the day so far, never below zero, unlimited without a budget', () => {
    expect(liveDetailBudgetLeft(63_000, 62_990)).toBe(10);
    expect(liveDetailBudgetLeft(63_000, 63_000)).toBe(0);
    expect(liveDetailBudgetLeft(63_000, 64_000)).toBe(0);
    expect(liveDetailBudgetLeft(null, 1_000_000)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('recentDetailCandidates (T-1782, T-1823)', () => {
  // The competitions in the store's alphabetical order, as `pollTargets` gives
  // them; the ids are not names, so no order below can come from a name.
  const row = (
    id: string,
    status: string,
    kickoffAt: string,
    competitionId: string,
    detailFetchedAt: string | null = null,
  ) => ({ externalId: id, fixtureId: id, status, kickoffAt, competitionId, detailFetchedAt });
  const known = [
    row('a1', 'finished', '2026-11-07T12:30:00Z', 'c-austria', '2026-11-07T14:20:00Z'),
    row('b1', 'live', '2026-11-07T15:00:00Z', 'c-bundesliga'),
    row('b2', 'finished', '2026-11-07T13:30:00Z', 'c-bundesliga'),
    row('l1', 'finished', '2026-11-07T14:00:00Z', 'c-laliga'),
    row('p1', 'finished', '2026-11-07T14:15:00Z', 'c-premier'),
    row('p2', 'scheduled', '2026-11-07T16:30:00Z', 'c-premier'),
  ];
  const ids = (rows: { externalId: string }[]): string[] => rows.map((r) => r.externalId);

  it('with live details on: finished only, never asked first, oldest kick-off first', () => {
    // a1 was asked at the whistle; the three never asked come first.
    expect(ids(recentDetailCandidates(known, true, 10))).toEqual(['b2', 'l1', 'p1', 'a1']);
    expect(ids(recentDetailCandidates(known, true, 2))).toEqual(['b2', 'l1']);
  });

  it('a crowded evening does not keep the earlier matches waiting (T-1823)', () => {
    // Forty cup matches at 19:00 and five league matches at 18:00, none asked:
    // the league's earlier matches are not behind the cup's, and the cup is
    // not behind the league's five either -- the competitions take turns.
    const cup = Array.from({ length: 40 }, (_, i) =>
      row(`cup${i}`, 'finished', '2026-10-29T19:00:00Z', 'c-cup'),
    );
    const league = Array.from({ length: 5 }, (_, i) =>
      row(`lg${i}`, 'finished', '2026-10-29T18:00:00Z', 'c-league'),
    );
    const asked = ids(recentDetailCandidates([...cup, ...league], true, 10));
    expect(asked.slice(0, 2)).toEqual(['lg0', 'cup0']);
    expect(asked.filter((id) => id.startsWith('lg'))).toHaveLength(5);
    expect(asked.filter((id) => id.startsWith('cup'))).toHaveLength(5);
  });

  it('with live details off: live and finished in the competitions’ order, as before', () => {
    expect(ids(recentDetailCandidates(known, false, 10))).toEqual(['a1', 'b1', 'b2', 'l1', 'p1']);
    expect(ids(recentDetailCandidates(known, false, 2))).toEqual(['a1', 'b1']);
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
