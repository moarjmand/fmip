import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { IngestRun, IngestRunStatus, IngestionHealth } from '@fmip/contracts';
import { PostgresRunStore } from './internal/run-store';
import { withRequestTally, type RequestTally } from './internal/request-meter';
import { tierOfRun, withBudgetTier } from './internal/budget-tier';
import {
  INGEST_JOBS,
  INGESTION_SOURCES,
  type IngestJob,
  type IngestionSources,
} from './internal/sources';

/**
 * One ingestion job's newest completed run (T-801's watchdog). `provider` is
 * `null` when no configured source serves the job, and `reason` says why.
 */
export interface JobCompletion {
  job: IngestJob;
  provider: string | null;
  reason: string | null;
  /** When the newest succeeded or partial run finished; `null` when none has. */
  lastCompletedAt: Date | null;
  /** When the newest run of any outcome started; `null` when none has. */
  lastStartedAt: Date | null;
}

/** How far back "recent failures" looks. */
export const FAILURE_WINDOW_MS = 24 * 60 * 60 * 1000;
export const RECENT_RUNS = 20;

/**
 * How long a run may stay open before it counts as abandoned (T-537). Far
 * beyond the longest real run -- a season backfill or a backlog batch takes
 * minutes -- so only a run whose process is gone is ever reclaimed.
 */
export const STALE_RUN_MS = 2 * 60 * 60 * 1000;

/** Postgres unique violation: the "already running" lock on `ingest_run`. */
const UNIQUE_VIOLATION = '23505';

export interface RunOutcome {
  status: Exclude<IngestRunStatus, 'running'>;
  itemsSeen: number;
  itemsWritten: number;
  /** What went wrong, for a failed or partial run; the same text is logged. */
  error?: string | null;
  /** Requests the run sent to its provider (T-501); absent when not counted. */
  requests?: number;
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
export class IngestRunsService implements OnModuleInit {
  private readonly log = new Logger('Ingestion');

  constructor(
    private readonly store: PostgresRunStore,
    @Inject(INGESTION_SOURCES) private readonly sources: IngestionSources,
  ) {}

  /**
   * Opens a run. The partial unique index on `(provider, job)` while a run is
   * open refuses a second one, which is the lock; a run open for longer than
   * `STALE_RUN_MS` is one whose process stopped, so it is closed as failed and
   * the start tried once more (T-537).
   */
  /**
   * The budget counter lives in this process and starts at zero (T-1365): a
   * restart at 18:00 would otherwise hand the day's spent requests back. It
   * starts instead from what today's runs recorded. A database that cannot be
   * read leaves it at zero and says so; the provider's own limit still holds.
   */
  async onModuleInit(): Promise<void> {
    const seed = this.sources.seedBudget;
    const provider = this.sources.forJob('live')?.provider;
    if (seed === undefined || provider === undefined) return;
    try {
      const spent = await this.requestsToday(provider);
      seed(spent);
      this.log.log(`request budget seeded from today's runs: ${spent}`, {
        event: 'ingest.budget_seeded',
        provider,
        requests: spent,
      });
    } catch (error: unknown) {
      this.log.warn(`request budget not seeded: ${String(error)}`, {
        event: 'ingest.budget_unseeded',
        provider,
      });
    }
  }

  async start(
    provider: string,
    job: string,
    scope: string | null = null,
    now: Date = new Date(),
  ): Promise<string> {
    try {
      return await this.store.start(provider, job, scope);
    } catch (error: unknown) {
      if ((error as { code?: string }).code !== UNIQUE_VIOLATION) throw error;
      const closed = await this.store.closeStale(
        provider,
        job,
        new Date(now.getTime() - STALE_RUN_MS),
        `abandoned: still open after ${STALE_RUN_MS / 3_600_000} hours; the process running it stopped`,
      );
      if (closed === 0) throw error;
      this.log.warn(`closed an abandoned run: ${provider} ${job}`, {
        event: 'ingest.stale_run_closed',
        provider,
        job,
        closed,
      });
      return this.store.start(provider, job, scope);
    }
  }

  async finish(id: string, outcome: RunOutcome): Promise<IngestRun | null> {
    const run = await this.store.finish(id, {
      status: outcome.status,
      itemsSeen: outcome.itemsSeen,
      itemsWritten: outcome.itemsWritten,
      error: outcome.error ?? null,
      requests: outcome.requests ?? null,
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
        requests: run.requests,
        error: run.error,
      });
    } else {
      this.log.log(`ingest run succeeded: ${run.provider} ${run.job}`, {
        event: 'ingest.succeeded',
        run_id: run.id,
        provider: run.provider,
        job: run.job,
        items_written: run.items_written,
        requests: run.requests,
      });
    }
    return run;
  }

  /**
   * Who asked for a season backfill and why (rule 10), for the operator's
   * command (T-502); the admin page's route records the same row.
   */
  auditBackfill(actorId: string, reason: string, seasonLabel: string | null = null): Promise<void> {
    return this.store.auditBackfill(actorId, reason, seasonLabel);
  }

  /**
   * Runs a job inside a run record: the outcome, or the thrown error, closes the
   * run, with the requests the job sent on the way (T-501) -- a run that failed
   * half-way still spent what it spent.
   */
  async track<T>(
    provider: string,
    job: string,
    scope: string | null,
    work: () => Promise<{ result: T; itemsSeen: number; itemsWritten: number; partial?: string }>,
  ): Promise<T> {
    const id = await this.start(provider, job, scope);
    const tally: RequestTally = { requests: 0 };
    try {
      // Every request the run sends draws on its tier of the day's budget
      // (T-1365); a job may narrow part of its work to a lower one.
      const done = await withRequestTally(tally, () => withBudgetTier(tierOfRun(job, scope), work));
      const partial = withBudgetNote(done.partial, tally);
      await this.finish(id, {
        status: partial === undefined ? 'succeeded' : 'partial',
        itemsSeen: done.itemsSeen,
        itemsWritten: done.itemsWritten,
        error: partial ?? null,
        requests: tally.requests,
      });
      return done.result;
    } catch (error: unknown) {
      await this.finish(id, {
        status: 'failed',
        itemsSeen: 0,
        itemsWritten: 0,
        error:
          withBudgetNote(error instanceof Error ? error.message : String(error), tally) ?? null,
        requests: tally.requests,
      });
      throw error;
    }
  }

  /**
   * For every scheduled job, the newest run that completed (T-801): a partial
   * run counts, because it wrote what it could and the job is moving; a job
   * whose runs all fail, or that stopped running, does not move this.
   */
  async jobCompletions(): Promise<JobCompletion[]> {
    const served = INGEST_JOBS.map((job) => ({ job, source: this.sources.forJob(job) }));
    const rows = await this.store.lastCompleted(
      served.flatMap(({ job, source }) =>
        source === null ? [] : [{ provider: source.provider, job }],
      ),
    );
    return served.map(({ job, source }) => {
      if (source === null) {
        return {
          job,
          provider: null,
          reason: this.sources.reason ?? `no source serves ${job}`,
          lastCompletedAt: null,
          lastStartedAt: null,
        };
      }
      const row = rows.find((r) => r.job === job && r.provider === source.provider);
      return {
        job,
        provider: source.provider,
        reason: null,
        lastCompletedAt: row?.completed ?? null,
        lastStartedAt: row?.started ?? null,
      };
    });
  }

  /** The provider requests recorded by runs since 00:00 UTC of `now`'s day (T-501). */
  requestsToday(provider: string, now: Date = new Date()): Promise<number> {
    return this.store.requestsSince(provider, utcMidnight(now));
  }

  async ingestionHealth(now: Date = new Date()): Promise<IngestionHealth> {
    // The provider the fixtures job would ask, which is the only one whose
    // mappings decide whether anything is fetched at all.
    const provider = this.sources.forJob('fixtures')?.provider ?? null;
    const [recent, failed, pollable, requestsToday] = await Promise.all([
      this.store.recent(RECENT_RUNS),
      this.store.failedSince(new Date(now.getTime() - FAILURE_WINDOW_MS)),
      this.store.pollableCatalogue(provider),
      provider === null ? Promise.resolve(0) : this.store.requestsSince(provider, utcMidnight(now)),
    ]);
    const lastFailure = recent.find((r) => r.status === 'failed' || r.status === 'partial') ?? null;
    return {
      checked_at: now.toISOString(),
      last_run: recent[0] ?? null,
      last_failure: lastFailure,
      failed_last_24h: failed,
      running: recent.filter((r) => r.status === 'running').length,
      recent,
      pollable: {
        provider,
        // The resolver already knows why nothing serves the job; nothing until
        // now carried it out of the process.
        reason: provider === null ? this.sources.reason : null,
        competitions: pollable.competitions,
        with_current_season: pollable.withCurrentSeason,
      },
      requests_today: requestsToday,
      request_budget: this.sources.dailyBudget ?? null,
    };
  }
}

/** 00:00 UTC of `now`'s day: when every provider's plan resets. */
export function utcMidnight(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * A run the budget held back says so in words (T-1365): the adapter only
 * reports `quota: HTTP 429`, which reads the same as the provider's refusal.
 */
export function withBudgetNote(text: string | undefined, tally: RequestTally): string | undefined {
  const refused = tally.budgetRefused;
  if (refused === undefined) return text;
  const note = `budget: ${refused.count} request${refused.count === 1 ? '' : 's'} not sent -- ${refused.reason}`;
  return text === undefined || text === '' ? note : `${note}; ${text}`;
}
