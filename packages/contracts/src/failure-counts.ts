/**
 * API errors and job failures, counted (T-803): 5xx responses per route
 * template and failed or stalled BullMQ jobs per queue, in UTC-hour buckets,
 * kept for thirty days.
 *
 * `GET /admin/health/failures?hours=` answers `FailureCountsReport` (admin
 * role only). A count carries the request id (or job id) of the newest
 * failure so the log line can be found; no stack, message or request body is
 * stored -- those stay in the log.
 */

export const FAILURE_RETENTION_DAYS = 30;

/** One UTC hour and how many failures fell in it. Hours with none are absent. */
export interface FailureBucket {
  /** The start of the hour, ISO 8601 UTC. */
  hour: string;
  count: number;
}

/** 5xx responses of one route in the window. */
export interface RouteErrors {
  method: string;
  /** The route template (`/fixtures/:fixtureId`), never the requested URL; `(no route)` when none matched. */
  route: string;
  total: number;
  /** Count per status code, e.g. `{ "500": 3, "503": 1 }`. */
  by_status: Record<string, number>;
  /** The newest failure: quote its `request_id` to find the log line. */
  newest: { at: string; status: number; request_id: string };
  hours: FailureBucket[];
}

/** `failed`: the job threw (or exhausted its stall limit). `stalled`: its lock expired mid-run. */
export type JobFailureKind = 'failed' | 'stalled';

/** Failed or stalled jobs of one queue in the window. */
export interface QueueFailures {
  queue: string;
  total: number;
  by_kind: Record<JobFailureKind, number>;
  /** Count per job name; `*` when the event did not name the job (a stall). */
  by_job: Record<string, number>;
  newest: { at: string; kind: JobFailureKind; job: string; job_id: string | null };
  hours: FailureBucket[];
}

export interface FailureCountsReport {
  generated_at: string;
  /** The first hour the window covers. */
  since: string;
  window_hours: number;
  retention_days: number;
  /** Routes with at least one 5xx in the window, most failures first. Empty: none recorded. */
  http_errors: RouteErrors[];
  /** Queues with at least one failed or stalled job in the window, most first. Empty: none recorded. */
  job_failures: QueueFailures[];
}
