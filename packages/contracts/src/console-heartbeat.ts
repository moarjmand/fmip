/**
 * The maintainer's computer as the agents console sees it (T-1906, D-456):
 * nothing but the model page, the calendar and the reminders works while it
 * is off, so every console page says when it last synced and what follows
 * from that (rule 4 applied to the console).
 *
 * The sync's times are stated here and nowhere else: the page, the forms'
 * success line and, later, the server's own "computer silent" alert read
 * them from this file. They mirror the scheduled task `stadiomind-console-sync`
 * on the maintainer's computer (three times a day since 2026-11-17, hourly
 * before); T-1892 changes them here when the sync moves to Task Scheduler.
 *
 * Runtime values and the pure arithmetic are on `@fmip/contracts/console`,
 * never in the barrel, which exports the types only.
 */
import {
  CONSOLE_CALENDAR_TIME_ZONE,
  isoToDay,
  timeToMinutes,
  wallClock,
  wallTimeToInstant,
} from './console-calendar';

/** `GET /console/heartbeat`: what the bar on every console page is drawn from. */
export interface ConsoleHeartbeat {
  /** When the newest snapshot reached the server; `null` when none ever has. */
  loaded_at: string | null;
  /**
   * The rows still `queued` in `console_command` and `console_message`;
   * `null` when they could not be counted, which is not "none".
   */
  queued: { commands: number; messages: number } | null;
}

/** The zone the sync's times are wall-clock times in. */
export const CONSOLE_SYNC_TIME_ZONE = CONSOLE_CALENDAR_TIME_ZONE;
/**
 * When the console sync starts each day, in `CONSOLE_SYNC_TIME_ZONE`, in
 * order. The scheduler starts each a few minutes after its time, which is
 * why the page says "about".
 */
export const CONSOLE_SYNC_TIMES = ['09:25', '15:25', '21:25'] as const;
/** When the team's daily run starts (scheduled for 09:00, started at 09:09 by the scheduler). */
export const CONSOLE_DAILY_RUN_TIME = '09:09';
/**
 * How long after a sync's time the console waits before calling it missed.
 * A default pending the maintainer's word (D-456 point 3).
 */
export const CONSOLE_SYNC_GRACE_MINUTES = 60;
/**
 * Hours without a sync after which the computer is taken to be off: an
 * inference from silence, not a measurement. A default pending the
 * maintainer's word (D-456 point 3).
 */
export const CONSOLE_SILENT_HOURS = 26;

export const CONSOLE_HEARTBEAT_STATES = ['fresh', 'late', 'silent', 'never'] as const;
export type ConsoleHeartbeatState = (typeof CONSOLE_HEARTBEAT_STATES)[number];

const MINUTE = 60_000;

/** The sync's instants on the wall-clock day of `instant` and the days either side, in order. */
function slotsAround(instant: Date): Date[] {
  const day = isoToDay(wallClock(instant, CONSOLE_SYNC_TIME_ZONE).date);
  if (day === null) return [];
  const slots: Date[] = [];
  for (const offset of [-2, -1, 0, 1, 2])
    for (const time of CONSOLE_SYNC_TIMES) {
      const minutes = timeToMinutes(time);
      if (minutes !== null)
        slots.push(wallTimeToInstant(day + offset, minutes, CONSOLE_SYNC_TIME_ZONE));
    }
  return slots.sort((a, b) => a.getTime() - b.getTime());
}

/** The first sync time strictly after `instant`. */
export function syncSlotAfter(instant: Date): Date {
  const slot = slotsAround(instant).find((s) => s.getTime() > instant.getTime());
  // Never reached with a valid date: two days of slots lie either side of it.
  return slot ?? new Date(Number.NaN);
}

/** The last sync time at or before `instant`. */
export function syncSlotAtOrBefore(instant: Date): Date {
  const slot = slotsAround(instant)
    .reverse()
    .find((s) => s.getTime() <= instant.getTime());
  return slot ?? new Date(Number.NaN);
}

/** What the last sync's time says about the computer, at `now`. */
export interface ConsolePcState {
  state: ConsoleHeartbeatState;
  /** The newest snapshot's arrival, or `null` in `never`. */
  lastSync: Date | null;
  /** Whole minutes since `lastSync`, never negative; `null` in `never`. */
  ageMinutes: number | null;
  /** The first sync time after `now`, whatever the state: the schedule's, not a promise. */
  nextSlot: Date;
  /**
   * `late` only: the newest sync time whose grace has run out with no sync
   * since the one before it.
   */
  missedSlot: Date | null;
  /**
   * `fresh` only: a sync time that has passed, inside its grace, with no sync
   * yet. The page says it is awaited instead of naming a later one as "next".
   */
  dueSlot: Date | null;
}

/**
 * The computer's state from the newest snapshot's `loaded_at`, pure, with
 * the clock handed in:
 *
 * - `never`: no snapshot has ever arrived (not "nothing exists");
 * - `silent`: the last one is more than `CONSOLE_SILENT_HOURS` old;
 * - `late`: the first sync time after it passed more than
 *   `CONSOLE_SYNC_GRACE_MINUTES` ago;
 * - `fresh`: otherwise, that is, within one slot and the grace.
 *
 * Exactly at a limit is still the milder state ("more than").
 */
export function consolePcState(loadedAt: string | null, now: Date): ConsolePcState {
  const nextSlot = syncSlotAfter(now);
  const last = loadedAt === null ? null : new Date(loadedAt);
  if (last === null || Number.isNaN(last.getTime()))
    return {
      state: 'never',
      lastSync: null,
      ageMinutes: null,
      nextSlot,
      missedSlot: null,
      dueSlot: null,
    };
  const age = Math.max(0, now.getTime() - last.getTime());
  const base = { lastSync: last, ageMinutes: Math.floor(age / MINUTE), nextSlot };
  if (age > CONSOLE_SILENT_HOURS * 60 * MINUTE)
    return { ...base, state: 'silent', missedSlot: null, dueSlot: null };
  const grace = CONSOLE_SYNC_GRACE_MINUTES * MINUTE;
  const expected = syncSlotAfter(last);
  if (now.getTime() > expected.getTime() + grace)
    return {
      ...base,
      state: 'late',
      // One millisecond short of the grace: a slot exactly at its limit is not missed yet.
      missedSlot: syncSlotAtOrBefore(new Date(now.getTime() - grace - 1)),
      dueSlot: null,
    };
  return {
    ...base,
    state: 'fresh',
    missedSlot: null,
    dueSlot: expected.getTime() <= now.getTime() ? expected : null,
  };
}
