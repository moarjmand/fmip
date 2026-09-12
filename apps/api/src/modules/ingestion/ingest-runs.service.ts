import { Injectable, Logger } from '@nestjs/common';
import type { IngestRun, IngestRunStatus, IngestionHealth } from '@fmip/contracts';
import { PostgresRunStore } from './internal/run-store';

/** How far back "recent failures" looks. */
export const FAILURE_WINDOW_MS = 24 * 60 * 60 * 1000;
export const RECENT_RUNS = 20;

export interface RunOutcome {
  status: Exclude<IngestRunStatus, 'running'>;
  itemsSeen: number;
  itemsWritten: number;
  /** What went wrong, for a failed or partial run; the same text is logged. */
  error?: string | null;
}

/**
 * Ingest runs (T-071, D-044): every provider job opens a run, and closes it
 * with its outcome; a failure is recorded in `ingest_run` and logged as a
 * structured `ingest.failed` event, and `ingestionHealth()` puts the newest
 * runs and the failure count on `GET /health/ingestion` — so an ingest
 * failure is visible without SSH, in the log and over HTTP. The E2 jobs
 * call `start` and `finish`; nothing else writes `ingest_run`.
 */
@Injectable()
export class IngestRunsService {
  private readonly log = new Logger('Ingestion');

  constructor(private readonly store: PostgresRunStore) {}

  start(provider: string, job: string, scope: string | null = null): Promise<string> {
    return this.store.start(provider, job, scope);
  }

  async finish(id: string, outcome: RunOutcome): Promise<IngestRun | null> {
    const run = await this.store.finish(id, {
      status: outcome.status,
      itemsSeen: outcome.itemsSeen,
      itemsWritten: outcome.itemsWritten,
      error: outcome.error ?? null,
    });
    if (run === null) {
      this.log.warn(`finish() for a run that is not open`, {
        event: 'ingest.finish_unknown',
        run_id: id,
      });
      return null;
    }
    if (run.status === 'failed' || run.status === 'partial') {
      this.log.error(`ingest run ${run.status}: ${run.provider} ${run.job}`, {
        event: 'ingest.failed',
        run_id: run.id,
        provider: run.provider,
        job: run.job,
        scope: run.scope,
        status: run.status,
        items_seen: run.items_seen,
        items_written: run.items_written,
        error: run.error,
      });
    } else {
      this.log.log(`ingest run succeeded: ${run.provider} ${run.job}`, {
        event: 'ingest.succeeded',
        run_id: run.id,
        provider: run.provider,
        job: run.job,
        items_written: run.items_written,
      });
    }
    return run;
  }

  /** Runs a job inside a run record: the outcome, or the thrown error, closes the run. */
  async track<T>(
    provider: string,
    job: string,
    scope: string | null,
    work: () => Promise<{ result: T; itemsSeen: number; itemsWritten: number; partial?: string }>,
  ): Promise<T> {
    const id = await this.start(provider, job, scope);
    try {
      const done = await work();
      await this.finish(id, {
        status: done.partial === undefined ? 'succeeded' : 'partial',
        itemsSeen: done.itemsSeen,
        itemsWritten: done.itemsWritten,
        error: done.partial ?? null,
      });
      return done.result;
    } catch (error: unknown) {
      await this.finish(id, {
        status: 'failed',
        itemsSeen: 0,
        itemsWritten: 0,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async ingestionHealth(now: Date = new Date()): Promise<IngestionHealth> {
    const [recent, failed] = await Promise.all([
      this.store.recent(RECENT_RUNS),
      this.store.failedSince(new Date(now.getTime() - FAILURE_WINDOW_MS)),
    ]);
    const lastFailure = recent.find((r) => r.status === 'failed' || r.status === 'partial') ?? null;
    return {
      checked_at: now.toISOString(),
      last_run: recent[0] ?? null,
      last_failure: lastFailure,
      failed_last_24h: failed,
      running: recent.filter((r) => r.status === 'running').length,
      recent,
    };
  }
}
