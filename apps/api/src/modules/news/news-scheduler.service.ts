import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import { FailureCountsService } from '../failure-counts/failure-counts.service';
import { GNewsIngestionService, gnewsConfig } from './gnews-ingestion.service';
import { NewsIngestionService } from './news-ingestion.service';

export const NEWS_QUEUE = 'news';
export const NEWS_JOB = 'fetch';
/** GNews' request (T-1367), on the same queue so the two never run at once. */
export const GNEWS_JOB = 'gnews';
/** Hourly, off the football jobs' minutes so the two never tick together. */
export const NEWS_SCHEDULE = '17 * * * *';

/**
 * The BullMQ queue and worker that read the publishers' feeds on a schedule
 * (T-142). The same shape and the same gate as the football scheduler: off
 * by default, `INGESTION_SCHEDULE=on` starts it, so a test, a CI run and a
 * second API process do not all read every feed once an hour each. One
 * process schedules; everything else answers HTTP.
 *
 * Two ticks cannot overlap per source: `news_fetch` has a partial unique index
 * on the open run, so the second tick is a skipped run, not a failure.
 */
@Injectable()
export class NewsSchedulerService implements OnModuleInit, OnApplicationShutdown {
  private readonly log = new Logger('News');
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(
    private readonly ingestion: NewsIngestionService,
    private readonly gnews: GNewsIngestionService,
    private readonly failures: FailureCountsService,
  ) {}

  static enabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return (env.INGESTION_SCHEDULE ?? 'off').trim().toLowerCase() === 'on';
  }

  async onModuleInit(): Promise<void> {
    if (!NewsSchedulerService.enabled()) {
      this.log.log('news schedule off', { event: 'news.schedule_off' });
      return;
    }
    const url = process.env.REDIS_URL;
    if (url === undefined || url === '') {
      this.log.error('INGESTION_SCHEDULE=on but REDIS_URL is not set; news schedule off', {
        event: 'news.schedule_misconfigured',
      });
      return;
    }
    await this.start(url);
  }

  /** Starts the queue and the worker. Separate from `onModuleInit` so a test can drive it. */
  async start(url: string): Promise<void> {
    const connection: ConnectionOptions = { url, maxRetriesPerRequest: null };
    this.queue = new Queue(NEWS_QUEUE, { connection });
    this.worker = new Worker(
      NEWS_QUEUE,
      async (job) => (job.name === GNEWS_JOB ? this.gnews.run() : this.ingestion.fetchAll()),
      { connection, concurrency: 1 },
    );
    this.worker.on('failed', (job, error) => {
      this.log.error('news job threw', {
        event: 'news.job_threw',
        job: job?.name ?? null,
        error: error.message,
      });
    });
    // Failed and stalled jobs are counted per hour (T-803).
    this.failures.watch(this.worker, NEWS_QUEUE);
    await this.queue.upsertJobScheduler(
      NEWS_JOB,
      { pattern: NEWS_SCHEDULE, tz: 'UTC' },
      { name: NEWS_JOB, opts: { removeOnComplete: 50, removeOnFail: 50 } },
    );
    this.log.log('news schedule on', { event: 'news.schedule_on', pattern: NEWS_SCHEDULE });

    // GNews (T-1367, D-185): its own repeat, only with a key. Without one the
    // repeat is removed, so emptying the key and restarting stops it.
    const gnews = gnewsConfig();
    if (gnews.on) {
      await this.queue.upsertJobScheduler(
        GNEWS_JOB,
        { every: gnews.intervalMinutes * 60_000 },
        { name: GNEWS_JOB, opts: { removeOnComplete: 50, removeOnFail: 50 } },
      );
      this.log.log('gnews schedule on', {
        event: 'news.gnews_schedule_on',
        every_minutes: gnews.intervalMinutes,
        daily_budget: gnews.dailyBudget,
      });
    } else {
      await this.queue.removeJobScheduler(GNEWS_JOB);
      this.log.log('gnews schedule off', {
        event: 'news.gnews_schedule_off',
        reason: gnews.reason,
      });
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    this.worker = null;
    this.queue = null;
  }
}
