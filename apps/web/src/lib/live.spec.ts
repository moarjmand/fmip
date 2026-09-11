import { describe, expect, it } from 'vitest';
import { INITIAL_CLOCK, STALE_AFTER_MS, liveLabel, liveState } from './live';

const T0 = Date.parse('2026-09-11T20:31:07Z');

describe('liveState', () => {
  it('is connecting until the first event, live after it, stale when heartbeats stop', () => {
    expect(liveState(INITIAL_CLOCK, T0)).toBe('connecting');
    const clock = { lastEventAt: T0, lastSnapshotAt: T0, broken: false };
    expect(liveState(clock, T0 + 10_000)).toBe('live');
    expect(liveState(clock, T0 + STALE_AFTER_MS)).toBe('live');
    expect(liveState(clock, T0 + STALE_AFTER_MS + 1)).toBe('stale');
  });

  it('calls a broken feed stale when it has a picture and unavailable when it never had one', () => {
    expect(liveState({ lastEventAt: T0, lastSnapshotAt: T0, broken: true }, T0)).toBe('stale');
    expect(liveState({ lastEventAt: null, lastSnapshotAt: null, broken: true }, T0)).toBe(
      'unavailable',
    );
  });
});

describe('liveLabel', () => {
  it('says what it knows in the viewer zone', () => {
    const clock = { lastEventAt: T0, lastSnapshotAt: T0, broken: false };
    expect(liveLabel('live', clock, 'UTC')).toBe('Live · updated 20:31:07');
    expect(liveLabel('live', clock, 'Asia/Tehran')).toBe('Live · updated 00:01:07');
    expect(liveLabel('stale', clock, 'UTC')).toBe('Stale · last update 20:31:07');
    expect(liveLabel('connecting', INITIAL_CLOCK, 'UTC')).toBe('Connecting to live updates…');
    expect(liveLabel('unavailable', INITIAL_CLOCK, 'UTC')).toBe('Live updates unavailable');
  });
});
