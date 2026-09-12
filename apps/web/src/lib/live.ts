import { type Freshness, type IngestionHealth, STALE_LIVE_AFTER_MS } from '@fmip/contracts';

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

/**
 * Whether a fixture's own data is behind (T-083, D-045): live or suspended,
 * and unchanged for longer than `STALE_LIVE_AFTER_MS`. The API says the same
 * in `freshness` at snapshot time; the client re-asks as the clock moves, so
 * a feed that stops after the last snapshot is caught here too.
 */
export function isBehind(
  fixture: { status: string; last_updated_at: string; freshness?: Freshness | null },
  now: number,
): boolean {
  if (fixture.freshness === 'stale') return true;
  if (fixture.status !== 'live' && fixture.status !== 'suspended') return false;
  return now - Date.parse(fixture.last_updated_at) > STALE_LIVE_AFTER_MS;
}

/**
 * What the scores page says when the ingestion feed's latest run failed
 * (from `GET /health/ingestion`): the outage is named with its time, and the
 * page keeps showing what it has, labelled, rather than nothing.
 */
export function feedNotice(health: IngestionHealth | null, timeZone: string): string | null {
  if (health === null) return null;
  const last = health.last_run;
  if (last === null || (last.status !== 'failed' && last.status !== 'partial')) return null;
  const at = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(last.finished_at ?? last.started_at));
  return `The live data feed reported a ${last.status === 'failed' ? 'failure' : 'partial update'} at ${at}. Scores may be behind; every card shows when its data last changed.`;
}

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
