import { Inject, Injectable } from '@nestjs/common';
import type { JobFailureKind } from '@fmip/contracts';
import type { Pool } from 'pg';
import { PG_POOL } from '../../../database/database.module';
import type { HttpErrorRow, JobFailureRow } from './summarise';

/**
 * The SQL for `http_error_count` and `job_failure_count` (T-803). Every write
 * is one upsert that adds one to its hour's row and keeps the newest id; the
 * hour and the time come from the application, never the database clock.
 */
@Injectable()
export class FailureCountsStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async addHttpError(e: {
    hour: Date;
    method: string;
    route: string;
    status: number;
    requestId: string;
    at: Date;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO http_error_count AS c
         (hour, method, route, status, count, last_request_id, last_at)
       VALUES ($1, $2, $3, $4, 1, $5, $6)
       ON CONFLICT (hour, method, route, status) DO UPDATE SET
         count = c.count + 1,
         last_request_id = CASE WHEN EXCLUDED.last_at >= c.last_at
                                THEN EXCLUDED.last_request_id ELSE c.last_request_id END,
         last_at = GREATEST(c.last_at, EXCLUDED.last_at)`,
      [e.hour, e.method, e.route, e.status, e.requestId, e.at],
    );
  }

  async addJobFailure(e: {
    hour: Date;
    queue: string;
    job: string;
    kind: JobFailureKind;
    jobId: string | null;
    at: Date;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO job_failure_count AS c
         (hour, queue, job, kind, count, last_job_id, last_at)
       VALUES ($1, $2, $3, $4, 1, $5, $6)
       ON CONFLICT (hour, queue, job, kind) DO UPDATE SET
         count = c.count + 1,
         last_job_id = CASE WHEN EXCLUDED.last_at >= c.last_at
                            THEN EXCLUDED.last_job_id ELSE c.last_job_id END,
         last_at = GREATEST(c.last_at, EXCLUDED.last_at)`,
      [e.hour, e.queue, e.job, e.kind, e.jobId, e.at],
    );
  }

  /** Deletes every bucket before `cutoff`, in both tables. */
  async prune(cutoff: Date): Promise<void> {
    await this.pool.query('DELETE FROM http_error_count WHERE hour < $1', [cutoff]);
    await this.pool.query('DELETE FROM job_failure_count WHERE hour < $1', [cutoff]);
  }

  async httpErrors(since: Date): Promise<HttpErrorRow[]> {
    const { rows } = await this.pool.query<HttpErrorRow>(
      `SELECT hour, method, route, status, count, last_request_id, last_at
         FROM http_error_count WHERE hour >= $1 ORDER BY hour`,
      [since],
    );
    return rows;
  }

  async jobFailures(since: Date): Promise<JobFailureRow[]> {
    const { rows } = await this.pool.query<JobFailureRow>(
      `SELECT hour, queue, job, kind, count, last_job_id, last_at
         FROM job_failure_count WHERE hour >= $1 ORDER BY hour`,
      [since],
    );
    return rows;
  }
}
