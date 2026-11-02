import { STALE_LIVE_AFTER_MS } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import { AWAITING_UPDATE_AFTER_MS, freshnessOf, listFreshnessOf } from './internal/freshness';

const NOW = new Date('2026-09-12T20:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe('freshnessOf', () => {
  it('calls a live match current until the threshold and stale after it', () => {
    expect(freshnessOf('live', ago(0), NOW)).toBe('current');
    expect(freshnessOf('live', ago(STALE_LIVE_AFTER_MS), NOW)).toBe('current');
    expect(freshnessOf('live', ago(STALE_LIVE_AFTER_MS + 1), NOW)).toBe('stale');
    expect(freshnessOf('suspended', ago(10 * 60_000), NOW)).toBe('stale');
  });

  it('does not apply before kick-off or after the end', () => {
    for (const status of [
      'scheduled',
      'finished',
      'postponed',
      'cancelled',
      'abandoned',
      'awarded',
    ] as const) {
      expect(freshnessOf(status, ago(60 * 60_000), NOW)).toBeNull();
    }
  });

  it('calls a scheduled match awaiting an update past three hours after kick-off (T-1708, D-343)', () => {
    // Longer than ninety minutes, the breaks, extra time and a shoot-out.
    expect(AWAITING_UPDATE_AFTER_MS).toBe(3 * 60 * 60_000);
    const at = (kickoffAgoMs: number) =>
      freshnessOf('scheduled', ago(5 * 24 * 60 * 60_000), NOW, undefined, {
        kickoffAt: ago(kickoffAgoMs),
      });
    expect(at(-60 * 60_000)).toBeNull();
    expect(at(0)).toBeNull();
    expect(at(AWAITING_UPDATE_AFTER_MS)).toBeNull();
    expect(at(AWAITING_UPDATE_AFTER_MS + 1)).toBe('awaiting_update');
    expect(at(2 * 24 * 60 * 60_000)).toBe('awaiting_update');
    // No kick-off handed in: nothing is derived.
    expect(freshnessOf('scheduled', ago(0), NOW)).toBeNull();
  });

  it('leaves every other status as it was, however long ago the kick-off', () => {
    const kickoffAt = ago(2 * 24 * 60 * 60_000);
    for (const status of ['finished', 'postponed', 'cancelled', 'abandoned', 'awarded'] as const) {
      expect(
        freshnessOf(status, ago(60 * 60_000), NOW, undefined, { kickoffAt }),
        status,
      ).toBeNull();
    }
    expect(freshnessOf('live', ago(0), NOW, undefined, { kickoffAt })).toBe('current');
  });

  it('takes a different threshold when asked', () => {
    expect(freshnessOf('live', ago(30_000), NOW, 20_000)).toBe('stale');
  });

  it('keeps half-time current while the live list still answers (T-1394, D-209)', () => {
    const clock = { minute: 45, liveAnsweredAt: ago(20_000) };
    expect(freshnessOf('live', ago(10 * 60_000), NOW, undefined, clock)).toBe('current');
    expect(
      freshnessOf('suspended', ago(10 * 60_000), NOW, undefined, {
        minute: null,
        liveAnsweredAt: ago(20_000),
      }),
    ).toBe('current');
    // The answers stopped: stale again.
    expect(
      freshnessOf('live', ago(10 * 60_000), NOW, undefined, {
        minute: 45,
        liveAnsweredAt: ago(STALE_LIVE_AFTER_MS + 1),
      }),
    ).toBe('stale');
    // In play the minute moves, so an answer without a change is stale.
    expect(freshnessOf('live', ago(10 * 60_000), NOW, undefined, { ...clock, minute: 63 })).toBe(
      'stale',
    );
    // Never for a match that is over.
    expect(freshnessOf('finished', ago(10 * 60_000), NOW, undefined, clock)).toBeNull();
  });
});

describe('listFreshnessOf (T-1710, D-343)', () => {
  const kickoff = (agoMs: number) => ago(agoMs).toISOString();

  it('says awaiting_update for a scheduled match past three hours after kick-off', () => {
    expect(listFreshnessOf('scheduled', kickoff(AWAITING_UPDATE_AFTER_MS + 1), NOW)).toBe(
      'awaiting_update',
    );
    expect(listFreshnessOf('scheduled', kickoff(AWAITING_UPDATE_AFTER_MS), NOW)).toBeNull();
    expect(listFreshnessOf('scheduled', kickoff(-60 * 60_000), NOW)).toBeNull();
  });

  it('never says anything else: a live match on a list is not judged stale here', () => {
    for (const status of ['live', 'suspended', 'finished', 'postponed', 'cancelled']) {
      expect(listFreshnessOf(status, kickoff(2 * 24 * 60 * 60_000), NOW)).toBeNull();
    }
  });
});
