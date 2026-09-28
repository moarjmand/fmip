/**
 * The watchdog (T-801): conditions evaluated on a schedule over the health
 * views, each with its threshold and its state, and the transitions between
 * states as a durable log. An alert is a transition, never a repeat: a
 * condition that stays bad for an hour is one `raised` event and, when it
 * ends, one `recovered` event.
 *
 * `GET /admin/health/watchdog` answers `WatchdogReport` (admin role only).
 * Delivering the alerts (T-802) and the System page (T-804) read this shape.
 */

/**
 * Where a condition stands.
 *
 * `unknown` is not "fine": it is a condition the watchdog could not evaluate
 * this tick (no source configured, no record to read, a check that could not
 * be made), and `reason` says which. It never opens or closes an incident.
 */
export type WatchdogLevel = 'ok' | 'degraded' | 'failing' | 'unknown';

export const WATCHDOG_LEVELS: readonly WatchdogLevel[] = ['ok', 'degraded', 'failing', 'unknown'];

/**
 * A change of level, named.
 *
 * - `raised`: a condition left `ok` (or its first reading was bad) and an
 *   incident opened. **An alert.**
 * - `escalated`: `degraded` to `failing` inside an open incident.
 * - `eased`: `failing` to `degraded` inside an open incident.
 * - `recovered`: back to `ok`; the incident is closed. **An alert.**
 * - `unobservable`: the condition could not be evaluated any more. An open
 *   incident stays open: not knowing is not recovering.
 * - `observable`: evaluable again, and `ok`, with no incident open.
 */
export type WatchdogEventKind =
  'raised' | 'escalated' | 'eased' | 'recovered' | 'unobservable' | 'observable';

/** The unit of a condition's observed value and of both its thresholds. */
export type WatchdogUnit = 'seconds' | 'percent' | 'count';

/** When a condition becomes `degraded` and when `failing`: at or above the number. */
export interface WatchdogThreshold {
  unit: WatchdogUnit;
  degraded: number;
  failing: number;
}

/**
 * One condition, as the newest tick left it.
 *
 * Keys are stable identifiers: `ingest:<job>` (the newest completed run of an
 * ingestion job), `live_feed` (live matches whose data stopped changing),
 * `request_budget` (the day's provider requests against the budget),
 * `jobs:<queue>` (failed BullMQ jobs in the last hour), `model_service`
 * (consecutive failed health checks), `delivery:<channel>` (failed outward
 * deliveries in the last hour), `backup` (the newest backup).
 */
export interface WatchdogCondition {
  key: string;
  level: WatchdogLevel;
  /** When the condition entered `level`. */
  since: string;
  /** The tick that last evaluated it. Older than the report's `checked_at`: no longer evaluated. */
  checked_at: string;
  /** The measured value in `threshold.unit`, or `null` when there was nothing to measure. */
  observed: number | null;
  threshold: WatchdogThreshold;
  /** What the number means in words, or why the level is `unknown`. English, for the log and the console. */
  note: string | null;
  /** The `raised` event's id while an incident is open; `null` otherwise. */
  incident: number | null;
}

export interface WatchdogEvent {
  id: number;
  condition: string;
  at: string;
  from: WatchdogLevel;
  to: WatchdogLevel;
  kind: WatchdogEventKind;
  /** True for `raised` and `recovered`: the two an administrator is told about (T-802). */
  alert: boolean;
  /** The incident this event belongs to (the `raised` event's id; its own for a `raised`). */
  incident: number | null;
  observed: number | null;
  note: string | null;
}

/**
 * `never_run`: no tick has written anything. `stale`: the newest tick is older
 * than three intervals, so the levels below are the last known, not the
 * current (rule 4) -- the watchdog itself has stopped.
 */
export type WatchdogFreshness = 'current' | 'stale' | 'never_run';

export interface WatchdogReport {
  /** When this answer was produced. */
  generated_at: string;
  /** The newest tick, or `null` when none has run. */
  checked_at: string | null;
  interval_seconds: number;
  freshness: WatchdogFreshness;
  conditions: WatchdogCondition[];
  /** The newest events first, at most fifty. */
  events: WatchdogEvent[];
}
