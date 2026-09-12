import { STALE_LIVE_AFTER_MS } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import { freshnessOf } from './internal/freshness';

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

  it('takes a different threshold when asked', () => {
    expect(freshnessOf('live', ago(30_000), NOW, 20_000)).toBe('stale');
  });
});
