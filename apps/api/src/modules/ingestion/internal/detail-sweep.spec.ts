import { describe, expect, it } from 'vitest';
import {
  DETAIL_BATCH,
  LINEUP_REASK_BATCH,
  LINEUP_REASK_DEADLINE_MS,
  LINEUP_REASK_DAYS,
  LINEUP_REASK_HOURS,
  detailBatch,
  fairOrder,
  lineupReasks,
  recentDetailOrder,
} from './detail-sweep';

describe('detailBatch (T-1823)', () => {
  it('is 30 unless set, a whole number from 1 to 100, anything else the default', () => {
    expect(DETAIL_BATCH).toBe(30);
    expect(detailBatch(undefined)).toBe(30);
    expect(detailBatch('')).toBe(30);
    expect(detailBatch(' 40 ')).toBe(40);
    expect(detailBatch('1')).toBe(1);
    expect(detailBatch('100')).toBe(100);
    expect(detailBatch('101')).toBe(30);
    expect(detailBatch('0')).toBe(30);
    expect(detailBatch('-5')).toBe(30);
    expect(detailBatch('12.5')).toBe(30);
    expect(detailBatch('many')).toBe(30);
  });
});

describe('the line-up re-ask constants (T-1823)', () => {
  it('asks every six hours for two weeks, at most twenty a run', () => {
    expect(LINEUP_REASK_HOURS).toBe(6);
    expect(LINEUP_REASK_DAYS).toBe(14);
    expect(LINEUP_REASK_BATCH).toBe(20);
    // 48 runs a day at most: under the 75,000 a day with room.
    expect(48 * LINEUP_REASK_BATCH).toBeLessThanOrEqual(1_000);
    // Held to the 30 seconds the jobs on the live tick's worker keep to.
    expect(LINEUP_REASK_DEADLINE_MS).toBe(30_000);
  });
});

describe('fairOrder (T-1823)', () => {
  const byNumber = (a: { n: number }, b: { n: number }) => a.n - b.n;

  it('takes one from each competition in turn, each in its own order', () => {
    const items = [
      { c: 'x', n: 3 },
      { c: 'x', n: 1 },
      { c: 'x', n: 2 },
      { c: 'y', n: 5 },
      { c: 'y', n: 4 },
      { c: 'z', n: 9 },
    ];
    expect(fairOrder(items, (i) => i.c, byNumber).map((i) => `${i.c}${i.n}`)).toEqual([
      'x1',
      'y4',
      'z9',
      'x2',
      'y5',
      'x3',
    ]);
  });

  it('orders the competitions by their first item, then by id, never by input order', () => {
    const items = [
      { c: 'b', n: 2 },
      { c: 'a', n: 2 },
      { c: 'c', n: 1 },
    ];
    expect(fairOrder(items, (i) => i.c, byNumber).map((i) => i.c)).toEqual(['c', 'a', 'b']);
  });

  it('is empty for nothing', () => {
    expect(fairOrder([], () => 'x', byNumber)).toEqual([]);
  });
});

describe('recentDetailOrder (T-1823)', () => {
  const m = (id: string, c: string, kickoffAt: string, detailFetchedAt: string | null) => ({
    id,
    competitionId: c,
    kickoffAt,
    detailFetchedAt,
  });

  it('puts the never-asked first by kick-off, then the longest-unasked, at most the batch', () => {
    const rows = [
      m('asked-late', 'c1', '2026-11-07T15:00:00Z', '2026-11-07T17:30:00Z'),
      m('asked-early', 'c2', '2026-11-07T15:00:00Z', '2026-11-07T17:00:00Z'),
      m('never-late', 'c1', '2026-11-07T16:00:00Z', null),
      m('never-early', 'c2', '2026-11-07T14:00:00Z', null),
    ];
    expect(recentDetailOrder(rows, 10).map((r) => r.id)).toEqual([
      'never-early',
      'never-late',
      'asked-early',
      'asked-late',
    ]);
    expect(recentDetailOrder(rows, 1).map((r) => r.id)).toEqual(['never-early']);
    expect(recentDetailOrder(rows, 0)).toEqual([]);
  });
});

describe('lineupReasks (T-1823)', () => {
  const o = (id: string, c: string, askedAt: string, kickoffAt = '2026-10-29T19:00:00Z') => ({
    id,
    competitionId: c,
    askedAt,
    kickoffAt,
  });

  it('asks the longest-unasked first, the competitions in turn, at most the batch', () => {
    const owed = [
      o('copa1', 'copa', '2026-10-29T22:00:00Z'),
      o('copa2', 'copa', '2026-10-29T22:01:00Z'),
      o('copa3', 'copa', '2026-10-29T22:02:00Z'),
      o('knvb1', 'knvb', '2026-10-29T22:30:00Z'),
      o('pgpl1', 'pgpl', '2026-11-06T16:00:00Z', '2026-11-06T12:00:00Z'),
    ];
    expect(lineupReasks(owed, 10).map((r) => r.id)).toEqual([
      'copa1',
      'knvb1',
      'pgpl1',
      'copa2',
      'copa3',
    ]);
    expect(lineupReasks(owed, 2).map((r) => r.id)).toEqual(['copa1', 'knvb1']);
  });
});
