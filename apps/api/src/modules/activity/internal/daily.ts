/**
 * The anonymous daily roll-up of sign-ins and active members (T-1727, D-353):
 * which days to keep before the retention purge deletes their sessions, and
 * how the kept days and the live rows meet in one report without a day being
 * counted twice. Pure, so the boundary is unit-tested.
 */
import type { CountRow } from './series';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The metrics read from `session`, which the purge deletes 30 days after expiry. */
export const ROLLED_UP_METRICS: ReadonlySet<string> = new Set(['sign_ins', 'active_members']);

/** Prefix of a metric read from `activity_daily` in the Activity statement. */
export const DAILY_PREFIX = 'daily:';

/** The Activity statement's one row naming the last kept day (`day`), absent while none is. */
export const DAILY_THROUGH = 'daily:through';

/** The day after a `YYYY-MM-DD` UTC day. */
export function nextDay(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
}

/** The instant a `YYYY-MM-DD` UTC day starts. */
export function dayStart(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

/** What the roll-up step reads before it writes, each a `YYYY-MM-DD` UTC day or null. */
export interface RollUpState {
  /** The last day already in `activity_daily`; null while the table is empty. */
  keptThrough: string | null;
  /** The latest creation day among the sessions this purge is about to delete; null if none. */
  purgeThrough: string | null;
  /** The earliest day either source of the two metrics has a row for; null if neither has. */
  firstDay: string | null;
}

/**
 * The days to write before the purge (inclusive both ends), or null when
 * there is nothing new. Days are kept contiguously from the first day with
 * any activity, so the last kept day is the whole boundary: every day up to
 * and including the latest creation day among the sessions about to go is
 * kept while all its sessions still exist, and no session created on a later
 * day is ever deleted before its day is kept. A day already kept is never
 * written again.
 */
export function daysToRollUp(state: RollUpState): { from: string; through: string } | null {
  const { keptThrough, purgeThrough, firstDay } = state;
  if (purgeThrough === null) return null;
  const from = keptThrough === null ? (firstDay ?? purgeThrough) : nextDay(keptThrough);
  return from <= purgeThrough ? { from, through: purgeThrough } : null;
}

/**
 * The Activity statement's rows, live and kept, to one set: for the two
 * rolled-up metrics a day up to and including the last kept day comes from
 * `activity_daily` and a later day from the live rows; every other metric is
 * live throughout. One source per day and metric, so nothing is added twice,
 * and a day's distinct-member count is never summed across sources.
 */
export function mergeRolledUp(rows: readonly CountRow[]): CountRow[] {
  const through = rows.find((row) => row.metric === DAILY_THROUGH)?.day ?? null;
  const merged: CountRow[] = [];
  for (const row of rows) {
    if (row.metric === DAILY_THROUGH) continue;
    const kept = through !== null && row.day <= through;
    if (row.metric.startsWith(DAILY_PREFIX)) {
      const metric = row.metric.slice(DAILY_PREFIX.length);
      if (kept && ROLLED_UP_METRICS.has(metric)) merged.push({ ...row, metric });
      continue;
    }
    if (kept && ROLLED_UP_METRICS.has(row.metric)) continue;
    merged.push(row);
  }
  return merged;
}
