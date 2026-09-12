import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { Queue, Worker, type ConnectionOptions, type JobSchedulerTemplateOptions } from 'bullmq';
import { IngestionJobsService } from './ingestion-jobs.service';
import { INGEST_JOBS, type IngestJob } from './internal/sources';

export const INGESTION_QUEUE = 'ingestion';

/**
 * How often each job runs, as a cron expression in UTC.
 *
 * The live job is the only frequent one, and 60 seconds is chosen against what
 * the free spine actually delivers: football-data.org refreshed an in-play
 * match roughly every minute in the 2026-09-12 measurement
 * (`docs/05-data-providers.md`), so polling faster would spend requests to
 * learn nothing. Lineups run every five minutes because an announcement lands
 * about an hour before kick-off and is worth having quickly; the schedule and
 * the post-match sweep are hourly and half-hourly, which is as often as their
 * data changes.
 */
export const SCHEDULE: Record<IngestJob, string> = {
  fixtures: '7 * * * *',
  live: '* * * * *',
  lineups: '*/5 * * * *',
  standings: '23 * * * *',
  post_match: '*/30 * * * *',
};

/** Job schedulers are keyed by id, so re-registering one replaces it. */
const TEMPLATE_OPTIONS: JobSchedulerTemplateOptions = {
  removeOnComplete: 50,
  removeOnFail: 50,
};

function connection(url: string): ConnectionOptions {
  return { url, maxRetriesPerRequest: null };
}

/**
 * The BullMQ queue and worker that run the ingestion jobs on a schedule
 * (T-026).
 *
 * Off by default. `INGESTION_SCHEDULE=on` is what starts it, so a test, a CI
 * run, a migration container and a second API process do not all poll a
 * provider at once — on the free plans of D-049 a duplicate poller is not a
 * performance problem, it is the daily quota gone by lunchtime. The one process
 * that should poll sets the variable; everything else answers HTTP.
 *
 * Two ticks of the same job cannot overlap: `ingest_run` has a partial unique
 * index on `(provider, job) WHERE status = 'running'`, so the second `start()`
 * raises a unique violation. That is caught here and logged as a skipped tick
 * rather than a failure, because it is the lock working, not the job breaking.
 */
@Injectable()
export class IngestionSchedulerService implements OnModuleInit, OnApplicationShutdown {
  private readonly log = new Logger('Ingestion');
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(private readonly jobs: IngestionJobsService) {}

  /** Whether this process schedules. Read once; changing it needs a restart. */
  static enabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return (env.INGESTION_SCHEDULE ?? 'off').trim().toLowerCase() === 'on';
  }

  async onModuleInit(): Promise<void> {
    if (!IngestionSchedulerService.enabled()) {
      this.log.log('ingestion schedule off', { event: 'ingest.schedule_off' });
      return;
    }
    const url = process.env.REDIS_URL;
    if (url === undefined || url === '') {
      this.log.error('INGESTION_SCHEDULE=on but REDIS_URL is not set; no job will run', {
        event: 'ingest.schedule_misconfigured',
      });
      return;
    }
    await this.start(url);
  }

  /** Starts the queue and the worker. Separate from `onModuleInit` so a test can drive it. */
  async start(url: string): Promise<void> {
    const conn = connection(url);
    this.queue = new Queue(INGESTION_QUEUE, { connection: conn });
    this.worker = new Worker(INGESTION_QUEUE, async (job) => this.jobs.run(job.name as IngestJob), {
      connection: conn,
      concurrency: 1,
    });

    this.worker.on('failed', (job, error) => {
      this.log.error(`ingestion job threw: ${job?.name ?? 'unknown'}`, {
        event: 'ingest.job_threw',
        job: job?.name ?? null,
        error: error.message,
      });
    });

    for (const name of INGEST_JOBS) {
      await this.queue.upsertJobScheduler(
        name,
        { pattern: SCHEDULE[name], tz: 'UTC' },
        { name, opts: TEMPLATE_OPTIONS },
      );
    }
    this.log.log('ingestion schedule on', {
      event: 'ingest.schedule_on',
      jobs: INGEST_JOBS.length,
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    this.worker = null;
    this.queue = null;
  }
}
