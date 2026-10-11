import { describe, expect, it } from 'vitest';
import { STALE_LIVE_AFTER_MS, liveFreshnessFrom } from './scores';

/**
 * Where a live match's freshness is measured from (T-1394, D-209): the last
 * change in play, and the later of that and the provider's last live answer
 * where the stored clock stands still.
 */
const CHANGED = '2026-10-11T19:48:00.000Z';
const ANSWERED = '2026-10-11T19:58:30.000Z';
const at = (iso: string) => Date.parse(iso);

describe('liveFreshnessFrom', () => {
  it('measures a match in play from its last change, whatever the feed answered', () => {
    expect(
      liveFreshnessFrom({
        status: 'live',
        minute: 63,
        last_updated_at: CHANGED,
        live_answered_at: ANSWERED,
      }),
    ).toBe(at(CHANGED));
  });

  it('takes the last answer at half-time, in added time and in the breaks', () => {
    for (const minute of [45, 90, 105, 120]) {
      expect(
        liveFreshnessFrom({
          status: 'live',
          minute,
          last_updated_at: CHANGED,
          live_answered_at: ANSWERED,
        }),
      ).toBe(at(ANSWERED));
    }
    expect(
      liveFreshnessFrom({
        status: 'suspended',
        minute: null,
        last_updated_at: CHANGED,
        live_answered_at: ANSWERED,
      }),
    ).toBe(at(ANSWERED));
  });

  it('still ages a half-time the provider stopped answering about', () => {
    // No answer recorded, or one older than the last change: the change counts.
    expect(liveFreshnessFrom({ status: 'live', minute: 45, last_updated_at: CHANGED })).toBe(
      at(CHANGED),
    );
    expect(
      liveFreshnessFrom({
        status: 'live',
        minute: 45,
        last_updated_at: CHANGED,
        live_answered_at: '2026-10-11T19:40:00.000Z',
      }),
    ).toBe(at(CHANGED));
    // Two minutes after the last answer, half-time is behind again.
    const from = liveFreshnessFrom({
      status: 'live',
      minute: 45,
      last_updated_at: CHANGED,
      live_answered_at: ANSWERED,
    });
    expect(at('2026-10-11T20:01:00.000Z') - from > STALE_LIVE_AFTER_MS).toBe(true);
  });

  it('ignores an answer it cannot read, and a live match with no minute', () => {
    expect(
      liveFreshnessFrom({
        status: 'live',
        minute: 45,
        last_updated_at: CHANGED,
        live_answered_at: 'not a time',
      }),
    ).toBe(at(CHANGED));
    expect(
      liveFreshnessFrom({
        status: 'live',
        minute: null,
        last_updated_at: CHANGED,
        live_answered_at: ANSWERED,
      }),
    ).toBe(at(CHANGED));
  });
});
