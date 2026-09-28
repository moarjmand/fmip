import type { FailureBucket, JobFailureKind, QueueFailures, RouteErrors } from '@fmip/contracts';
import { FAILURE_RETENTION_DAYS } from '@fmip/contracts';

/**
 * The arithmetic of T-803's counts, pure so it is tested without a database:
 * which hour a failure belongs to, how long a window may be, and how the
 * stored rows become one entry per route and per queue.
 */

const HOUR_MS = 60 * 60 * 1000;

/** The start of `at`'s UTC hour: the bucket a failure is counted in. */
export function hourOf(at: Date): Date {
  return new Date(Math.floor(at.getTime() / HOUR_MS) * HOUR_MS);
}

export const DEFAULT_WINDOW_HOURS = 24;
export const MAX_WINDOW_HOURS = FAILURE_RETENTION_DAYS * 24;

/** `?hours=`: a whole number from 1 to the retention, else `null` (a 400). Absent is the default. */
export function windowHours(raw: unknown): number | null {
  const value = Array.isArray(raw) ? (raw as unknown[])[0] : raw;
  if (value === undefined || value === '') return DEFAULT_WINDOW_HOURS;
  if (typeof value !== 'string' || !/^\d{1,4}$/.test(value)) return null;
  const hours = Number(value);
  return hours >= 1 && hours <= MAX_WINDOW_HOURS ? hours : null;
}

/** The first hour a window of `hours` covers, the current hour included. */
export function windowStart(now: Date, hours: number): Date {
  return new Date(hourOf(now).getTime() - (hours - 1) * HOUR_MS);
}

/** Rows older than this are deleted: thirty days before the current hour. */
export function retentionCutoff(now: Date): Date {
  return new Date(hourOf(now).getTime() - FAILURE_RETENTION_DAYS * 24 * HOUR_MS);
}

/** The route a 5xx is counted under: the template, never the URL (no ids, no query strings). */
export function routeKey(template: string | undefined): string {
  if (template === undefined || template === '') return '(no route)';
  return template.length > 300 ? template.slice(0, 300) : template;
}

export interface HttpErrorRow {
  hour: Date;
  method: string;
  route: string;
  status: number;
  count: number;
  last_request_id: string;
  last_at: Date;
}

export interface JobFailureRow {
  hour: Date;
  queue: string;
  job: string;
  kind: JobFailureKind;
  count: number;
  last_job_id: string | null;
  last_at: Date;
}

function addBucket(buckets: Map<number, number>, hour: Date, count: number): void {
  buckets.set(hour.getTime(), (buckets.get(hour.getTime()) ?? 0) + count);
}

function bucketsOf(buckets: Map<number, number>): FailureBucket[] {
  return [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([hour, count]) => ({ hour: new Date(hour).toISOString(), count }));
}

/** Rows to one entry per (method, route), most failures first. */
export function routeErrors(rows: readonly HttpErrorRow[]): RouteErrors[] {
  const groups = new Map<
    string,
    { entry: Omit<RouteErrors, 'hours'>; buckets: Map<number, number>; newestAt: number }
  >();
  for (const row of rows) {
    const key = `${row.method} ${row.route}`;
    let group = groups.get(key);
    if (group === undefined) {
      group = {
        entry: {
          method: row.method,
          route: row.route,
          total: 0,
          by_status: {},
          newest: {
            at: row.last_at.toISOString(),
            status: row.status,
            request_id: row.last_request_id,
          },
        },
        buckets: new Map(),
        newestAt: row.last_at.getTime(),
      };
      groups.set(key, group);
    }
    group.entry.total += row.count;
    const status = String(row.status);
    group.entry.by_status[status] = (group.entry.by_status[status] ?? 0) + row.count;
    addBucket(group.buckets, row.hour, row.count);
    if (row.last_at.getTime() > group.newestAt) {
      group.newestAt = row.last_at.getTime();
      group.entry.newest = {
        at: row.last_at.toISOString(),
        status: row.status,
        request_id: row.last_request_id,
      };
    }
  }
  return [...groups.values()]
    .map((g) => ({ ...g.entry, hours: bucketsOf(g.buckets) }))
    .sort((a, b) => b.total - a.total || a.route.localeCompare(b.route));
}

/** Rows to one entry per queue, most failures first. */
export function queueFailures(rows: readonly JobFailureRow[]): QueueFailures[] {
  const groups = new Map<
    string,
    { entry: Omit<QueueFailures, 'hours'>; buckets: Map<number, number>; newestAt: number }
  >();
  for (const row of rows) {
    let group = groups.get(row.queue);
    if (group === undefined) {
      group = {
        entry: {
          queue: row.queue,
          total: 0,
          by_kind: { failed: 0, stalled: 0 },
          by_job: {},
          newest: {
            at: row.last_at.toISOString(),
            kind: row.kind,
            job: row.job,
            job_id: row.last_job_id,
          },
        },
        buckets: new Map(),
        newestAt: row.last_at.getTime(),
      };
      groups.set(row.queue, group);
    }
    group.entry.total += row.count;
    group.entry.by_kind[row.kind] += row.count;
    group.entry.by_job[row.job] = (group.entry.by_job[row.job] ?? 0) + row.count;
    addBucket(group.buckets, row.hour, row.count);
    if (row.last_at.getTime() > group.newestAt) {
      group.newestAt = row.last_at.getTime();
      group.entry.newest = {
        at: row.last_at.toISOString(),
        kind: row.kind,
        job: row.job,
        job_id: row.last_job_id,
      };
    }
  }
  return [...groups.values()]
    .map((g) => ({ ...g.entry, hours: bucketsOf(g.buckets) }))
    .sort((a, b) => b.total - a.total || a.queue.localeCompare(b.queue));
}
