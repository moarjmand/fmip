/**
 * `GET /health` on `apps/api`.
 *
 * Liveness only: it says the process is serving HTTP. It reports nothing about
 * Postgres or Redis, because the API checks neither yet. Readiness arrives with
 * T-008 and will be a separate shape, not a quiet widening of this one.
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
