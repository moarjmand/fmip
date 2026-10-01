import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { FailureCountsService } from '../failure-counts/failure-counts.service';
import { MediaFetchService } from './media-fetch.service';

export const MEDIA_QUEUE = 'media';
export const MEDIA_JOB = 'media-fetch';
/** Every five minutes; each tick asks at most `MediaPace.perTick`, one a second. */
export const MEDIA_SCHEDULE = '*/5 * * * *';

/**
 * The media fetch tick (T-1320, D-176): its own queue, one worker at a time.
 *
 * It runs where ingestion runs, and only there: `INGESTION_SCHEDULE=on` is the
 * one process that polls the provider, and it is the one that fetches the
 * provider's images, so a second API process (a rollout, a CLI container)
 * never doubles the requests.
 */
@Injectable()
export class MediaSchedulerService implements OnModuleInit, OnApplicationShutdown {
  private readonly log = new Logger('Media');
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(
    private readonly fetcher: MediaFetchService,
    private readonly failures: FailureCountsService,
  ) {}

  static enabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return (env.INGESTION_SCHEDULE ?? 'off').trim().toLowerCase() === 'on';
  }

  async onModuleInit(): Promise<void> {
    const url = process.env.REDIS_URL;
    if (!MediaSchedulerService.enabled() || url === undefined || url === '') return;
    const connection = { url, maxRetriesPerRequest: null };
    this.queue = new Queue(MEDIA_QUEUE, { connection });
    this.worker = new Worker(MEDIA_QUEUE, async () => this.fetcher.runDue(), {
      connection,
      concurrency: 1,
    });
    this.worker.on('failed', (job, error) => {
      this.log.error('media job threw', { event: 'media.job_threw', error: error.message });
    });
    this.failures.watch(this.worker, MEDIA_QUEUE);
    await this.queue.upsertJobScheduler(
      MEDIA_JOB,
      { pattern: MEDIA_SCHEDULE, tz: 'UTC' },
      { name: MEDIA_JOB, opts: { removeOnComplete: 50, removeOnFail: 50 } },
    );
    this.log.log('media schedule on', { event: 'media.schedule_on' });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    this.worker = null;
    this.queue = null;
  }
}
