import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { FailureCountsService } from '../failure-counts/failure-counts.service';
import { ContributorFlagService } from './contributor-flag.service';

export const CONTRIBUTOR_FLAG_QUEUE = 'contributor-flags';
export const CONTRIBUTOR_FLAG_JOB = 'check';
/** Once a day, in UTC (T-1031): the period is counted in days, and nothing is urgent. */
export const CONTRIBUTOR_FLAG_SCHEDULE = '20 4 * * *';

/**
 * The daily contributor-flag check's BullMQ queue and worker (T-1031, D-137).
 * It runs where the other scheduled jobs run (`INGESTION_SCHEDULE=on`), so a
 * test or a second API process does not raise flags.
 */
@Injectable()
export class ContributorFlagSchedulerService implements OnModuleInit, OnApplicationShutdown {
  private readonly log = new Logger('ContributorFlags');
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(
    private readonly flags: ContributorFlagService,
    private readonly failures: FailureCountsService,
  ) {}

  static enabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return (env.INGESTION_SCHEDULE ?? 'off').trim().toLowerCase() === 'on';
  }

  async onModuleInit(): Promise<void> {
    if (!ContributorFlagSchedulerService.enabled()) return;
    const url = process.env.REDIS_URL;
    if (url === undefined || url === '') {
      this.log.error(
        'INGESTION_SCHEDULE=on but REDIS_URL is not set; the contributor-flag check will not run',
        { event: 'contributor_flag.misconfigured' },
      );
      return;
    }
    await this.start(url);
  }

  async start(url: string): Promise<void> {
    const connection = { url, maxRetriesPerRequest: null };
    this.queue = new Queue(CONTRIBUTOR_FLAG_QUEUE, { connection });
    this.worker = new Worker(CONTRIBUTOR_FLAG_QUEUE, async () => this.flags.check(new Date()), {
      connection,
      concurrency: 1,
    });
    this.worker.on('failed', (job, error) => {
      this.log.error('contributor-flag check threw', {
        event: 'contributor_flag.check_threw',
        job: job?.name ?? null,
        error: error.message,
      });
    });
    this.failures.watch(this.worker, CONTRIBUTOR_FLAG_QUEUE);
    await this.queue.upsertJobScheduler(
      CONTRIBUTOR_FLAG_JOB,
      { pattern: CONTRIBUTOR_FLAG_SCHEDULE, tz: 'UTC' },
      { name: CONTRIBUTOR_FLAG_JOB, opts: { removeOnComplete: 20, removeOnFail: 20 } },
    );
    this.log.log('contributor-flag check on', { event: 'contributor_flag.schedule_on' });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    this.worker = null;
    this.queue = null;
  }
}
