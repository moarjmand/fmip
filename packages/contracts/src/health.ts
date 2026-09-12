/**
 * `GET /health` on `apps/api`.
 *
 * Liveness only: it says the process is serving HTTP. It reports nothing about
 * Postgres or Redis, because the API checks neither in this answer. The
 * ingestion and live-path views below are separate shapes (T-071), not a
 * quiet widening of this one.
 */
export interface HealthReport {
  status: 'ok';
  service: 'api';
  /** Seconds since the process started. */
  uptime_seconds: number;
  /** ISO 8601. */
  started_at: string;
  /** ISO 8601, the moment this report was produced. */
  checked_at: string;
}

export type IngestRunStatus = 'running' | 'succeeded' | 'partial' | 'failed';

/** One provider job run, as `ingest_run` records it (T-071). */
export interface IngestRun {
  id: string;
  provider: string;
  job: string;
  scope: string | null;
  status: IngestRunStatus;
  started_at: string;
  finished_at: string | null;
  items_seen: number;
  items_written: number;
  /** What went wrong, for a failed or partial run. */
  error: string | null;
}

/** `GET /health/ingestion`: an ingest failure, visible without SSH. */
export interface IngestionHealth {
  checked_at: string;
  last_run: IngestRun | null;
  /** The newest failed or partial run among the recent ones. */
  last_failure: IngestRun | null;
  failed_last_24h: number;
  running: number;
  /** Newest first. */
  recent: IngestRun[];
}

/** `GET /health/live`: the live path's gateway in numbers. */
export interface LiveHealth {
  checked_at: string;
  /** Server-sent-event clients attached to the change feed right now. */
  stream_subscribers: number;
}
