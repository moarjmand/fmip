/**
 * Freshness for live surfaces (rule 4, T-032). Pure, so the thresholds are
 * unit-tested; the client component only feeds it clock readings.
 *
 * The server heartbeats every 15 s. Two missed heartbeats (plus slack) is
 * "stale"; a heartbeat, snapshot or reconnect makes it "live" again. Until the
 * first event arrives the state is "connecting", which the page shows as such
 * rather than as either fresh or stale.
 */

export type LiveState = 'connecting' | 'live' | 'stale' | 'unavailable';

/** Milliseconds without a heartbeat after which the picture is called stale. */
export const STALE_AFTER_MS = 45_000;

export interface LiveClock {
  /** When the last heartbeat or snapshot arrived, ms since epoch. */
  lastEventAt: number | null;
  /** When the last full snapshot arrived. */
  lastSnapshotAt: number | null;
  /** The server said its own feed broke, or the connection is down. */
  broken: boolean;
}

export const INITIAL_CLOCK: LiveClock = { lastEventAt: null, lastSnapshotAt: null, broken: false };

export function liveState(clock: LiveClock, now: number): LiveState {
  if (clock.broken) return clock.lastSnapshotAt === null ? 'unavailable' : 'stale';
  if (clock.lastEventAt === null) return 'connecting';
  return now - clock.lastEventAt > STALE_AFTER_MS ? 'stale' : 'live';
}

/** "Live · updated 20:31:07", "Stale · last update 20:29:40", … */
export function liveLabel(state: LiveState, clock: LiveClock, timeZone: string): string {
  const at = (ms: number): string =>
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(ms));
  switch (state) {
    case 'connecting':
      return 'Connecting to live updates…';
    case 'live':
      return clock.lastSnapshotAt === null ? 'Live' : `Live · updated ${at(clock.lastSnapshotAt)}`;
    case 'stale':
      return clock.lastSnapshotAt === null
        ? 'Stale · no update received'
        : `Stale · last update ${at(clock.lastSnapshotAt)}`;
    case 'unavailable':
      return 'Live updates unavailable';
  }
}
