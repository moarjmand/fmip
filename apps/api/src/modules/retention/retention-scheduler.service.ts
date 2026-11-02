import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { FailureCountsService } from '../failure-counts/failure-counts.service';
import { RetentionService } from './retention.service';

export const RETENTION_QUEUE = 'retention';
export const RETENTION_JOB = 'purge';
/**
 * Once a day at 03:23 UTC (D-345): clear of the ingestion's 04:00 sweep, and
 * a period counted in days needs nothing finer.
 */
export const RETENTION_SCHEDULE = '23 3 * * *';

/**
 * The retention purge's BullMQ queue and worker (T-1715). It runs where the
 * ingestion schedule runs (`INGESTION_SCHEDULE=on`), like the data-quality
 * sweep: one process does the housekeeping, and a test, a CLI or a second API
 * process does none.
 */
@Injectable()
export class RetentionSchedulerService implements OnModuleInit, OnApplicationShutdown {
  private readonly log = new Logger('Retention');
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(
    private readonly retention: RetentionService,
    private readonly failures: FailureCountsService,
  ) {}

  static enabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return (env.INGESTION_SCHEDULE ?? 'off').trim().toLowerCase() === 'on';
  }

  async onModuleInit(): Promise<void> {
    if (!RetentionSchedulerService.enabled()) return;
    const url = process.env.REDIS_URL;
    if (url === undefined || url === '') {
      this.log.error(
        'INGESTION_SCHEDULE=on but REDIS_URL is not set; the retention purge will not run',
        {
          event: 'retention.misconfigured',
        },
      );
      return;
    }
    await this.start(url);
  }

  /** Starts the queue and the worker; `queueName` and `schedule: false` are for a queue test. */
  async start(
    url: string,
    options: { queueName?: string; schedule?: boolean } = {},
  ): Promise<Queue> {
    const connection = { url, maxRetriesPerRequest: null };
    const name = options.queueName ?? RETENTION_QUEUE;
    this.queue = new Queue(name, { connection });
    this.worker = new Worker(name, async () => this.retention.purge(new Date()), {
      connection,
      concurrency: 1,
    });
    this.worker.on('failed', (job, error) => {
      this.log.error('retention purge threw', {
        event: 'retention.purge_threw',
        job: job?.name ?? null,
        error: error.message,
      });
    });
    this.failures.watch(this.worker, name);
    if (options.schedule !== false) {
      await this.queue.upsertJobScheduler(
        RETENTION_JOB,
        { pattern: RETENTION_SCHEDULE, tz: 'UTC' },
        { name: RETENTION_JOB, opts: { removeOnComplete: 30, removeOnFail: 30 } },
      );
      this.log.log('retention purge on', { event: 'retention.schedule_on' });
    }
    return this.queue;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    this.worker = null;
    this.queue = null;
  }
}
