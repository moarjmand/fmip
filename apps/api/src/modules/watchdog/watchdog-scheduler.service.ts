import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { FailureCountsService } from '../failure-counts/failure-counts.service';
import { AdminAlertsService } from './admin-alerts.service';
import { WATCHDOG_QUEUE } from './internal/probes';
import { WatchdogService } from './watchdog.service';

export const WATCHDOG_JOB = 'watch';
/** Every minute, in UTC, like the live ingestion tick it mostly watches. */
export const WATCHDOG_SCHEDULE = '* * * * *';

/**
 * The watchdog's BullMQ queue and worker (T-801): a job scheduler that runs
 * `WatchdogService.tick` every minute, then delivers the alerts the tick
 * wrote, and any a previous run left behind, to administrators (T-802).
 *
 * It runs where the ingestion schedule runs (`INGESTION_SCHEDULE=on`): the
 * process that polls is the one that watches, so a test, a CI run or a second
 * API process neither polls nor watches. Two watching processes would still
 * be safe -- a tick takes an advisory lock and the second one skips -- but
 * there is no reason to have them.
 */
@Injectable()
export class WatchdogSchedulerService implements OnModuleInit, OnApplicationShutdown {
  private readonly log = new Logger('Watchdog');
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(
    private readonly watchdog: WatchdogService,
    private readonly failures: FailureCountsService,
    private readonly alerts: AdminAlertsService,
  ) {}

  static enabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return (env.INGESTION_SCHEDULE ?? 'off').trim().toLowerCase() === 'on';
  }

  async onModuleInit(): Promise<void> {
    if (!WatchdogSchedulerService.enabled()) return;
    const url = process.env.REDIS_URL;
    if (url === undefined || url === '') {
      this.log.error('INGESTION_SCHEDULE=on but REDIS_URL is not set; the watchdog will not run', {
        event: 'watchdog.misconfigured',
      });
      return;
    }
    await this.start(url);
  }

  /**
   * Starts the queue and the worker. `queueName` and `schedule: false` are for
   * the queue test, which adds its own jobs to a queue of its own.
   */
  async start(
    url: string,
    options: { queueName?: string; schedule?: boolean } = {},
  ): Promise<Queue> {
    const connection = { url, maxRetriesPerRequest: null };
    const name = options.queueName ?? WATCHDOG_QUEUE;
    this.queue = new Queue(name, { connection });
    this.worker = new Worker(
      name,
      async () => {
        const tick = await this.watchdog.tick(new Date());
        // After the tick has committed, so the events it wrote are readable;
        // a delivery that throws fails the job, which is counted (T-803) and
        // retried by the next tick from the cursor.
        const delivered = await this.alerts.deliver();
        return { tick, delivered };
      },
      {
        connection,
        concurrency: 1,
      },
    );
    this.worker.on('failed', (job, error) => {
      this.log.error('watchdog tick threw', {
        event: 'watchdog.tick_threw',
        job: job?.name ?? null,
        error: error.message,
      });
    });
    // Failed and stalled ticks are counted per hour like every other queue's (T-803).
    this.failures.watch(this.worker, name);
    if (options.schedule !== false) {
      await this.queue.upsertJobScheduler(
        WATCHDOG_JOB,
        { pattern: WATCHDOG_SCHEDULE, tz: 'UTC' },
        { name: WATCHDOG_JOB, opts: { removeOnComplete: 50, removeOnFail: 50 } },
      );
      this.log.log('watchdog on', { event: 'watchdog.schedule_on' });
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
