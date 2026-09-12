import { Inject, Injectable } from '@nestjs/common';
import type { IngestRun, IngestRunStatus } from '@fmip/contracts';
import { Pool } from 'pg';
import { PG_POOL } from '../../../database/database.module';

/** SQL for `ingest_run` (T-071). One row per job run; open while `running`. */
@Injectable()
export class PostgresRunStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async start(provider: string, job: string, scope: string | null): Promise<string> {
    const { rows } = await this.pool.query<{ id: string }>(
      `INSERT INTO ingest_run (provider, job, scope) VALUES ($1, $2, $3) RETURNING id`,
      [provider, job, scope],
    );
    return rows[0]!.id;
  }

  async finish(
    id: string,
    outcome: {
      status: Exclude<IngestRunStatus, 'running'>;
      itemsSeen: number;
      itemsWritten: number;
      error: string | null;
    },
  ): Promise<IngestRun | null> {
    const { rows } = await this.pool.query<Row>(
      `UPDATE ingest_run
          SET status = $2, finished_at = now(), items_seen = $3, items_written = $4, error = $5
        WHERE id = $1 AND status = 'running'
        RETURNING ${COLUMNS}`,
      [id, outcome.status, outcome.itemsSeen, outcome.itemsWritten, outcome.error],
    );
    const r = rows[0];
    return r === undefined ? null : toRun(r);
  }

  /** The newest runs first. */
  async recent(limit: number): Promise<IngestRun[]> {
    const { rows } = await this.pool.query<Row>(
      `SELECT ${COLUMNS} FROM ingest_run ORDER BY started_at DESC, id DESC LIMIT $1`,
      [limit],
    );
    return rows.map(toRun);
  }

  /** Runs that failed or were partial since `since`. */
  async failedSince(since: Date): Promise<number> {
    const { rows } = await this.pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM ingest_run
        WHERE status IN ('failed', 'partial') AND started_at >= $1`,
      [since],
    );
    return Number(rows[0]?.n ?? 0);
  }
}

const COLUMNS =
  'id, provider, job, scope, status, started_at, finished_at, items_seen, items_written, error';

interface Row {
  id: string;
  provider: string;
  job: string;
  scope: string | null;
  status: IngestRunStatus;
  started_at: Date;
  finished_at: Date | null;
  items_seen: number;
  items_written: number;
  error: string | null;
}

const toRun = (r: Row): IngestRun => ({
  id: r.id,
  provider: r.provider,
  job: r.job,
  scope: r.scope,
  status: r.status,
  started_at: r.started_at.toISOString(),
  finished_at: r.finished_at === null ? null : r.finished_at.toISOString(),
  items_seen: r.items_seen,
  items_written: r.items_written,
  error: r.error,
});
