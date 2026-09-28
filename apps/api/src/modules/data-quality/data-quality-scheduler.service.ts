import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { FailureCountsService } from '../failure-counts/failure-counts.service';
import { DataQualityService } from './data-quality.service';

export const DATA_QUALITY_QUEUE = 'data-quality';
export const DATA_QUALITY_JOB = 'sweep';
/**
 * Every five minutes, in UTC (D-096): the live job writes every minute, and a
 * contradiction in a live match should reach the watchdog within a few of
 * them, while a sweep over every stored fixture each minute would be most of
 * the database's work for nothing new.
 */
export const DATA_QUALITY_SCHEDULE = '*/5 * * * *';

/**
 * The data-quality sweep's BullMQ queue and worker (T-820). It runs where the
 * ingestion schedule runs (`INGESTION_SCHEDULE=on`), like the watchdog: the
 * process that writes the feed is the one that checks it, and a test or a
 * second API process does neither.
 */
@Injectable()
export class DataQualitySchedulerService implements OnModuleInit, OnApplicationShutdown {
  private readonly log = new Logger('DataQuality');
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(
    private readonly dataQuality: DataQualityService,
    private readonly failures: FailureCountsService,
  ) {}

  static enabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return (env.INGESTION_SCHEDULE ?? 'off').trim().toLowerCase() === 'on';
  }

  async onModuleInit(): Promise<void> {
    if (!DataQualitySchedulerService.enabled()) return;
    const url = process.env.REDIS_URL;
    if (url === undefined || url === '') {
      this.log.error(
        'INGESTION_SCHEDULE=on but REDIS_URL is not set; the data-quality checks will not run',
        { event: 'data_quality.misconfigured' },
      );
      return;
    }
    await this.start(url);
  }

  /** Starts the queue and the worker; `queueName` and `schedule: false` are for the queue test. */
  async start(
    url: string,
    options: { queueName?: string; schedule?: boolean } = {},
  ): Promise<Queue> {
    const connection = { url, maxRetriesPerRequest: null };
    const name = options.queueName ?? DATA_QUALITY_QUEUE;
    this.queue = new Queue(name, { connection });
    this.worker = new Worker(name, async () => this.dataQuality.sweep(new Date()), {
      connection,
      concurrency: 1,
    });
    this.worker.on('failed', (job, error) => {
      this.log.error('data-quality sweep threw', {
        event: 'data_quality.sweep_threw',
        job: job?.name ?? null,
        error: error.message,
      });
    });
    this.failures.watch(this.worker, name);
    if (options.schedule !== false) {
      await this.queue.upsertJobScheduler(
        DATA_QUALITY_JOB,
        { pattern: DATA_QUALITY_SCHEDULE, tz: 'UTC' },
        { name: DATA_QUALITY_JOB, opts: { removeOnComplete: 50, removeOnFail: 50 } },
      );
      this.log.log('data-quality checks on', { event: 'data_quality.schedule_on' });
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
