import { describe, expect, it } from 'vitest';
import {
  CONSOLE_SILENT_HOURS,
  CONSOLE_SYNC_EARLY_MINUTES,
  CONSOLE_SYNC_GRACE_MINUTES,
  CONSOLE_SYNC_TIMES,
  consolePcState,
  syncSlotAfter,
  syncSlotAtOrBefore,
} from './console-heartbeat';

/**
 * T-1906 (D-456): the four states of the computer's heartbeat at fixed
 * clocks. Tehran is UTC+03:30 all year, so the sync's 09:25, 15:25 and 21:25
 * are 05:55, 11:55 and 17:55 UTC.
 */
const at = (iso: string): Date => new Date(iso);
const iso = (date: Date | null): string | null => (date === null ? null : date.toISOString());

describe('the sync times', () => {
  it('are the three daily ones, and the limits are the defaults of D-456 point 3', () => {
    expect(CONSOLE_SYNC_TIMES).toEqual(['09:25', '15:25', '21:25']);
    expect(CONSOLE_SYNC_GRACE_MINUTES).toBe(60);
    expect(CONSOLE_SILENT_HOURS).toBe(26);
  });

  it('finds the first time strictly after an instant, across midnight', () => {
    expect(iso(syncSlotAfter(at('2026-11-19T05:54:59Z')))).toBe('2026-11-19T05:55:00.000Z');
    expect(iso(syncSlotAfter(at('2026-11-19T05:55:00Z')))).toBe('2026-11-19T11:55:00.000Z');
    expect(iso(syncSlotAfter(at('2026-11-19T17:55:00Z')))).toBe('2026-11-20T05:55:00.000Z');
    // 23:50 UTC is already the next day in Tehran (03:20).
    expect(iso(syncSlotAfter(at('2026-11-19T23:50:00Z')))).toBe('2026-11-20T05:55:00.000Z');
  });

  it('finds the last time at or before an instant, across midnight', () => {
    expect(iso(syncSlotAtOrBefore(at('2026-11-19T05:55:00Z')))).toBe('2026-11-19T05:55:00.000Z');
    expect(iso(syncSlotAtOrBefore(at('2026-11-19T05:54:59Z')))).toBe('2026-11-18T17:55:00.000Z');
    expect(iso(syncSlotAtOrBefore(at('2026-11-19T23:50:00Z')))).toBe('2026-11-19T17:55:00.000Z');
  });
});

describe('consolePcState', () => {
  it('never: no snapshot has arrived, and the schedule is still named', () => {
    expect(consolePcState(null, at('2026-11-19T08:00:00Z'))).toEqual({
      state: 'never',
      lastSync: null,
      ageMinutes: null,
      nextSlot: at('2026-11-19T11:55:00Z'),
      missedSlot: null,
      dueSlot: null,
    });
    expect(consolePcState('not a time', at('2026-11-19T08:00:00Z')).state).toBe('never');
  });

  it('fresh: the last sync is within one slot and the grace', () => {
    const state = consolePcState('2026-11-19T05:58:00Z', at('2026-11-19T08:00:00Z'));
    expect(state).toMatchObject({ state: 'fresh', ageMinutes: 122, missedSlot: null });
    expect(iso(state.nextSlot)).toBe('2026-11-19T11:55:00.000Z');
    expect(state.dueSlot).toBeNull();
  });

  it('fresh overnight: nothing is due between 21:25 and 09:25', () => {
    const state = consolePcState('2026-11-19T17:58:00Z', at('2026-11-20T05:00:00Z'));
    expect(state).toMatchObject({ state: 'fresh', dueSlot: null });
    expect(iso(state.nextSlot)).toBe('2026-11-20T05:55:00.000Z');
  });

  it('fresh inside the grace: the passed slot is awaited, not yet missed', () => {
    const state = consolePcState('2026-11-19T05:58:00Z', at('2026-11-19T12:30:00Z'));
    expect(state.state).toBe('fresh');
    expect(iso(state.dueSlot)).toBe('2026-11-19T11:55:00.000Z');
    expect(iso(state.nextSlot)).toBe('2026-11-19T17:55:00.000Z');
  });

  it('late only when a slot is missed by more than the grace', () => {
    const loaded = '2026-11-19T05:58:00Z';
    // 11:55 UTC plus 60 minutes, to the millisecond: still fresh.
    expect(consolePcState(loaded, at('2026-11-19T12:55:00.000Z')).state).toBe('fresh');
    const late = consolePcState(loaded, at('2026-11-19T12:55:00.001Z'));
    expect(late).toMatchObject({ state: 'late', dueSlot: null, ageMinutes: 417 });
    expect(iso(late.missedSlot)).toBe('2026-11-19T11:55:00.000Z');
  });

  it('late names the newest missed slot when several were missed', () => {
    // Synced at 09:28 one day; 10:30 the next: 15:25, 21:25 and 09:25 all missed, 25 h 2 min.
    const late = consolePcState('2026-11-18T05:58:00Z', at('2026-11-19T07:00:00Z'));
    expect(late.state).toBe('late');
    expect(iso(late.missedSlot)).toBe('2026-11-19T05:55:00.000Z');
    // 09:25 passed 35 minutes ago: the newest slot past its grace is still last night's.
    const earlier = consolePcState('2026-11-18T05:58:00Z', at('2026-11-19T06:30:00Z'));
    expect(iso(earlier.missedSlot)).toBe('2026-11-18T17:55:00.000Z');
  });

  it('the mock-up clock: a sync at 01:54 is late from 10:25, not at 10:15', () => {
    const loaded = '2026-11-18T22:24:00Z'; // 28 Aban 01:54 in Tehran
    const drawn = consolePcState(loaded, at('2026-11-19T06:45:00Z')); // 10:15
    expect(drawn.state).toBe('fresh');
    expect(iso(drawn.dueSlot)).toBe('2026-11-19T05:55:00.000Z');
    const late = consolePcState(loaded, at('2026-11-19T06:56:00Z')); // 10:26
    expect(late).toMatchObject({ state: 'late', ageMinutes: 512 });
    expect(iso(late.missedSlot)).toBe('2026-11-19T05:55:00.000Z');
  });

  it('silent only past 26 hours, and silence outranks lateness', () => {
    const loaded = '2026-11-18T05:00:00Z';
    expect(consolePcState(loaded, at('2026-11-19T07:00:00.000Z')).state).toBe('late');
    const silent = consolePcState(loaded, at('2026-11-19T07:00:00.001Z'));
    expect(silent).toMatchObject({
      state: 'silent',
      ageMinutes: 26 * 60,
      missedSlot: null,
      dueSlot: null,
    });
    expect(iso(silent.nextSlot)).toBe('2026-11-19T11:55:00.000Z');
    expect(consolePcState(loaded, at('2026-11-25T07:00:00Z')).state).toBe('silent');
  });

  it('counts a sync that lands up to ten minutes before its slot for that slot', () => {
    expect(CONSOLE_SYNC_EARLY_MINUTES).toBe(10);
    const read = at('2026-11-19T06:56:00Z'); // 10:26, an hour and a minute after 09:25
    // Two minutes early (the computer's clock runs ahead): the 09:25 sync, so nothing is missed.
    const early = consolePcState('2026-11-19T05:53:00Z', read);
    expect(early).toMatchObject({ state: 'fresh', dueSlot: null, missedSlot: null });
    expect(iso(early.nextSlot)).toBe('2026-11-19T11:55:00.000Z');
    // Exactly ten minutes early still counts; a millisecond more does not.
    expect(consolePcState('2026-11-19T05:45:00.000Z', read).state).toBe('fresh');
    const before = consolePcState('2026-11-19T05:44:59.999Z', read);
    expect(before.state).toBe('late');
    expect(iso(before.missedSlot)).toBe('2026-11-19T05:55:00.000Z');
    // And the early one is late once the slot after it is missed.
    const next = consolePcState('2026-11-19T05:53:00Z', at('2026-11-19T12:56:00Z'));
    expect(next.state).toBe('late');
    expect(iso(next.missedSlot)).toBe('2026-11-19T11:55:00.000Z');
  });

  it('a snapshot stamped ahead of the clock is fresh and no age is negative', () => {
    const state = consolePcState('2026-11-19T08:00:30Z', at('2026-11-19T08:00:00Z'));
    expect(state).toMatchObject({ state: 'fresh', ageMinutes: 0 });
  });
});
