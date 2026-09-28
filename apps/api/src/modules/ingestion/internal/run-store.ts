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

  /**
   * How much of the catalogue the fixtures job can ask this provider about.
   * `getPollTargets` joins the same three tables to decide what to fetch; this
   * counts them, so a health report can say "the schedule is on and there is
   * nothing to poll" instead of only "the schedule is on".
   */
  async pollableCatalogue(
    provider: string | null,
  ): Promise<{ competitions: number; withCurrentSeason: number }> {
    if (provider === null) return { competitions: 0, withCurrentSeason: 0 };
    const { rows } = await this.pool.query<{ competitions: number; with_current_season: number }>(
      `SELECT count(*)::int AS competitions,
              count(*) FILTER (
                WHERE EXISTS (SELECT 1 FROM season s
                               WHERE s.competition_id = c.id AND s.is_current)
              )::int AS with_current_season
         FROM provider_mapping pm
         JOIN competition c ON c.id = pm.internal_id
        WHERE pm.provider = $1 AND pm.entity_type = 'competition'`,
      [provider],
    );
    return {
      competitions: rows[0]!.competitions,
      withCurrentSeason: rows[0]!.with_current_season,
    };
  }

  /**
   * A backfill is a deliberate act by an administrator: it spends the
   * provider's quota and rewrites a season's rows, so it is audited like any
   * other (rule 10). The run itself is recorded as an ordinary `ingest_run`;
   * this says who asked for it and why.
   */
  async auditBackfill(
    actorId: string,
    reason: string,
    seasonLabel: string | null = null,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO audit_log (actor_id, action, target_type, target_id, reason, previous, next)
       VALUES ($1, 'ingestion.backfill', 'ingestion', 'fixtures', $2, NULL,
               CASE WHEN $3::text IS NULL THEN NULL ELSE jsonb_build_object('season', $3::text) END)`,
      [actorId, reason, seasonLabel],
    );
  }

  /**
   * Closes the open runs of `(provider, job)` that started before `before`, as
   * failed (T-537). A run is open only while its process works on it; a process
   * that stops mid-run -- a deploy, a crash -- leaves the row `running`, and
   * the lock index then skips every later tick of that job for good.
   */
  async closeStale(provider: string, job: string, before: Date, error: string): Promise<number> {
    const { rowCount } = await this.pool.query(
      `UPDATE ingest_run SET status = 'failed', finished_at = now(), error = $4
        WHERE provider = $1 AND job = $2 AND status = 'running' AND started_at < $3`,
      [provider, job, before, error],
    );
    return rowCount ?? 0;
  }

  async finish(
    id: string,
    outcome: {
      status: Exclude<IngestRunStatus, 'running'>;
      itemsSeen: number;
      itemsWritten: number;
      error: string | null;
      requests?: number | null;
    },
  ): Promise<IngestRun | null> {
    const { rows } = await this.pool.query<Row>(
      `UPDATE ingest_run
          SET status = $2, finished_at = now(), items_seen = $3, items_written = $4, error = $5,
              requests = $6
        WHERE id = $1 AND status = 'running'
        RETURNING ${COLUMNS}`,
      [
        id,
        outcome.status,
        outcome.itemsSeen,
        outcome.itemsWritten,
        outcome.error,
        outcome.requests ?? null,
      ],
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

  /**
   * Requests sent to `provider` by runs started since `since` (T-501). Runs
   * recorded before requests were counted add nothing, which undercounts the
   * first day and no other.
   */
  async requestsSince(provider: string, since: Date): Promise<number> {
    const { rows } = await this.pool.query<{ n: string }>(
      `SELECT COALESCE(sum(requests), 0)::text AS n FROM ingest_run
        WHERE provider = $1 AND started_at >= $2`,
      [provider, since],
    );
    return Number(rows[0]?.n ?? 0);
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

  /**
   * Per (provider, job): when the newest completed run (succeeded or partial)
   * finished, and when the newest run of any outcome started (T-801). Each is
   * one backward walk of `ingest_run_recent_idx`.
   */
  async lastCompleted(
    pairs: { provider: string; job: string }[],
  ): Promise<{ provider: string; job: string; completed: Date | null; started: Date | null }[]> {
    if (pairs.length === 0) return [];
    const { rows } = await this.pool.query<{
      provider: string;
      job: string;
      completed: Date | null;
      started: Date | null;
    }>(
      `SELECT p.provider, p.job,
              (SELECT r.finished_at FROM ingest_run r
                WHERE r.provider = p.provider AND r.job = p.job
                  AND r.status IN ('succeeded', 'partial')
                ORDER BY r.started_at DESC LIMIT 1) AS completed,
              (SELECT r.started_at FROM ingest_run r
                WHERE r.provider = p.provider AND r.job = p.job
                ORDER BY r.started_at DESC LIMIT 1) AS started
         FROM unnest($1::text[], $2::text[]) AS p(provider, job)`,
      [pairs.map((p) => p.provider), pairs.map((p) => p.job)],
    );
    return rows;
  }
}

const COLUMNS =
  'id, provider, job, scope, status, started_at, finished_at, items_seen, items_written, error, requests';

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
  requests: number | null;
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
  requests: r.requests,
});
