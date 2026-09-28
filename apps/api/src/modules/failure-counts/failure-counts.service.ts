import { Injectable, Logger } from '@nestjs/common';
import {
  FAILURE_RETENTION_DAYS,
  type FailureCountsReport,
  type JobFailureKind,
} from '@fmip/contracts';
import type { Worker } from 'bullmq';
import { FailureCountsStore } from './internal/failure-counts-store';
import {
  hourOf,
  queueFailures,
  retentionCutoff,
  routeErrors,
  routeKey,
  windowStart,
} from './internal/summarise';

/** How often, at most, a process deletes the buckets past the retention. */
const PRUNE_EVERY_MS = 60 * 60 * 1000;
/** A stall names no job; the count says so rather than guessing. */
export const UNNAMED_JOB = '*';

/**
 * API errors and job failures, counted (T-803). Public surface:
 *
 * - `recordHttpError`, called from the access log's response hook for every
 *   5xx (`main.ts`), counted under the route template, never the URL;
 * - `watch(worker, queue)`, which every BullMQ worker is handed so its
 *   `failed` and `stalled` events are counted;
 * - `report`, behind `GET /admin/health/failures`.
 *
 * Recording never throws and never delays a response: it is a background
 * upsert, and a failed one is a warning in the log. Only ids are stored -- a
 * request id or a job id -- so the log line can be found; the message, the
 * stack and the request body stay in the log (D-044).
 */
@Injectable()
export class FailureCountsService {
  private readonly log = new Logger('FailureCounts');
  private lastPrune = 0;

  constructor(private readonly store: FailureCountsStore) {}

  recordHttpError(e: {
    method: string;
    route: string | undefined;
    status: number;
    requestId: string;
    at?: Date;
  }): Promise<void> {
    const at = e.at ?? new Date();
    return this.quietly('http', () =>
      this.store.addHttpError({
        hour: hourOf(at),
        method: e.method,
        route: routeKey(e.route),
        status: e.status,
        requestId: e.requestId,
        at,
      }),
    );
  }

  recordJobFailure(e: {
    queue: string;
    job: string | null;
    jobId: string | null;
    kind: JobFailureKind;
    at?: Date;
  }): Promise<void> {
    const at = e.at ?? new Date();
    return this.quietly('job', () =>
      this.store.addJobFailure({
        hour: hourOf(at),
        queue: e.queue,
        job: e.job === null || e.job === '' ? UNNAMED_JOB : e.job,
        kind: e.kind,
        jobId: e.jobId,
        at,
      }),
    );
  }

  /** Counts a worker's failed and stalled jobs under `queue`. */
  watch(worker: Pick<Worker, 'on'>, queue: string): void {
    worker.on('failed', (job) => {
      void this.recordJobFailure({
        queue,
        job: job?.name ?? null,
        jobId: job?.id ?? null,
        kind: 'failed',
      });
    });
    worker.on('stalled', (jobId) => {
      void this.recordJobFailure({ queue, job: null, jobId, kind: 'stalled' });
    });
  }

  async report(hours: number, now: Date = new Date()): Promise<FailureCountsReport> {
    await this.pruneIfDue(now);
    const since = windowStart(now, hours);
    const [http, jobs] = await Promise.all([
      this.store.httpErrors(since),
      this.store.jobFailures(since),
    ]);
    return {
      generated_at: now.toISOString(),
      since: since.toISOString(),
      window_hours: hours,
      retention_days: FAILURE_RETENTION_DAYS,
      http_errors: routeErrors(http),
      job_failures: queueFailures(jobs),
    };
  }

  private async quietly(kind: 'http' | 'job', write: () => Promise<void>): Promise<void> {
    try {
      await write();
      await this.pruneIfDue(new Date());
    } catch (error: unknown) {
      this.log.warn(`a ${kind} failure was not counted`, {
        event: 'failure_counts.write_failed',
        kind,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async pruneIfDue(now: Date): Promise<void> {
    if (now.getTime() - this.lastPrune < PRUNE_EVERY_MS) return;
    this.lastPrune = now.getTime();
    await this.store.prune(retentionCutoff(now));
  }
}
