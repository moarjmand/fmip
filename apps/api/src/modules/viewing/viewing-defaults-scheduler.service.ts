import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { FailureCountsService } from '../failure-counts/failure-counts.service';
import { PostgresViewingAdminStore } from './internal/viewing-admin-store';

export const VIEWING_DEFAULTS_QUEUE = 'viewing-defaults';
export const VIEWING_DEFAULTS_JOB = 'viewing-defaults-apply';
/** Hourly, off the hour: new fixtures, a season declared covered, a match rescheduled. */
export const VIEWING_DEFAULTS_SCHEDULE = '17 * * * *';

/**
 * The defaults tick (T-1360, D-181): applies every standing default to the
 * covered upcoming fixtures it does not list yet, through the database's one
 * copy of the rule (`viewing_apply_defaults`). Its own queue, one worker at
 * a time, and only where the schedules run: `INGESTION_SCHEDULE=on` is the
 * one process that runs them, so a second API process never doubles a tick
 * (the unique listing per service would make a double harmless anyway).
 */
@Injectable()
export class ViewingDefaultsSchedulerService implements OnModuleInit, OnApplicationShutdown {
  private readonly log = new Logger('ViewingDefaults');
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(
    private readonly store: PostgresViewingAdminStore,
    private readonly failures: FailureCountsService,
  ) {}

  static enabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return (env.INGESTION_SCHEDULE ?? 'off').trim().toLowerCase() === 'on';
  }

  /** One tick: apply, and say how many listings each default created. */
  async run(): Promise<number> {
    const applied = await this.store.applyDefaults();
    const total = [...applied.values()].reduce((sum, n) => sum + n, 0);
    this.log.log('viewing defaults applied', {
      event: 'viewing.defaults_applied',
      created: total,
      by_default: Object.fromEntries(applied),
    });
    return total;
  }

  async onModuleInit(): Promise<void> {
    const url = process.env.REDIS_URL;
    if (!ViewingDefaultsSchedulerService.enabled() || url === undefined || url === '') return;
    const connection = { url, maxRetriesPerRequest: null };
    this.queue = new Queue(VIEWING_DEFAULTS_QUEUE, { connection });
    this.worker = new Worker(VIEWING_DEFAULTS_QUEUE, async () => this.run(), {
      connection,
      concurrency: 1,
    });
    this.worker.on('failed', (job, error) => {
      this.log.error('viewing defaults job threw', {
        event: 'viewing.defaults_job_threw',
        error: error.message,
      });
    });
    this.failures.watch(this.worker, VIEWING_DEFAULTS_QUEUE);
    await this.queue.upsertJobScheduler(
      VIEWING_DEFAULTS_JOB,
      { pattern: VIEWING_DEFAULTS_SCHEDULE, tz: 'UTC' },
      { name: VIEWING_DEFAULTS_JOB, opts: { removeOnComplete: 50, removeOnFail: 50 } },
    );
    this.log.log('viewing defaults schedule on', { event: 'viewing.defaults_schedule_on' });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    this.worker = null;
    this.queue = null;
  }
}
