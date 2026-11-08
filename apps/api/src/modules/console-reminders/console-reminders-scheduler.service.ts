import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { FailureCountsService } from '../failure-counts/failure-counts.service';
import { ConsoleReminders } from './console-reminders.service';

export const CONSOLE_REMINDER_QUEUE = 'console-reminders';
export const CONSOLE_REMINDER_JOB = 'send-due';
/** Every minute: a reminder is for a minute of the day. */
export const CONSOLE_REMINDER_SCHEDULE = '* * * * *';

/**
 * The calendar reminders' BullMQ queue and worker (T-1788, D-391). It runs
 * where the other scheduled jobs run (`INGESTION_SCHEDULE=on`), so a test,
 * the console's command-line tool or a second API process sends nothing;
 * the claim in `console_reminder_sent` keeps a reminder to one send even if
 * two did.
 */
@Injectable()
export class ConsoleRemindersScheduler implements OnModuleInit, OnApplicationShutdown {
  private readonly log = new Logger('ConsoleReminders');
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(
    private readonly reminders: ConsoleReminders,
    private readonly failures: FailureCountsService,
  ) {}

  static enabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return (env.INGESTION_SCHEDULE ?? 'off').trim().toLowerCase() === 'on';
  }

  async onModuleInit(): Promise<void> {
    if (!ConsoleRemindersScheduler.enabled()) return;
    const url = process.env.REDIS_URL;
    if (url === undefined || url === '') {
      this.log.error(
        'INGESTION_SCHEDULE=on but REDIS_URL is not set; calendar reminders will not be sent',
        { event: 'console_reminder.misconfigured' },
      );
      return;
    }
    const connection = { url, maxRetriesPerRequest: null };
    this.queue = new Queue(CONSOLE_REMINDER_QUEUE, { connection });
    this.worker = new Worker(CONSOLE_REMINDER_QUEUE, async () => this.reminders.run(new Date()), {
      connection,
      concurrency: 1,
    });
    this.worker.on('failed', (job, error) => {
      this.log.error('calendar reminder run threw', {
        event: 'console_reminder.run_threw',
        job: job?.name ?? null,
        error: error.message,
      });
    });
    this.failures.watch(this.worker, CONSOLE_REMINDER_QUEUE);
    await this.queue.upsertJobScheduler(
      CONSOLE_REMINDER_JOB,
      { pattern: CONSOLE_REMINDER_SCHEDULE, tz: 'UTC' },
      { name: CONSOLE_REMINDER_JOB, opts: { removeOnComplete: 20, removeOnFail: 50 } },
    );
    this.log.log('calendar reminders on', { event: 'console_reminder.schedule_on' });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    this.worker = null;
    this.queue = null;
  }
}
