import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { FailureCountsService } from '../failure-counts/failure-counts.service';
import { SettlementService } from '../predictions/settlement.service';
import { ReputationService } from './reputation.service';

export const SETTLEMENT_QUEUE = 'settlement';
export const SETTLEMENT_JOB = 'settle-due';
/**
 * Every five minutes, offset from the forecast tick (T-1380): a member sees
 * their prediction settled within minutes of the final whistle being stored.
 */
export const SETTLEMENT_SCHEDULE = '2-59/5 * * * *';
/** Passes per tick: `DUE_BATCH` fixtures each, so a backlog drains over a few ticks. */
export const SETTLEMENT_PASSES = 10;

export interface SettlementTickReport {
  fixtures: number;
  settled: number;
  voided: number;
  members: number;
  snapshots: number;
}

/**
 * The settlement tick's BullMQ queue and worker (T-1380).
 *
 * Settlement (T-052) and the rating recompute (T-053) were built with an
 * operator endpoint each "until the job runner calls the service directly",
 * and no job ever did: on production no prediction was settled. This is that
 * job. It settles every final fixture that still owes a settlement, then
 * recomputes the rating and Career Points of exactly the members who predicted
 * those fixtures. Both steps are idempotent (rule 8), so a tick that overlaps
 * a manual run or follows a crash writes nothing twice.
 *
 * It runs where the other scheduled jobs run (`INGESTION_SCHEDULE=on`).
 */
@Injectable()
export class SettlementSchedulerService implements OnModuleInit, OnApplicationShutdown {
  private readonly log = new Logger('Settlement');
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(
    private readonly settlement: SettlementService,
    private readonly reputation: ReputationService,
    private readonly failures: FailureCountsService,
  ) {}

  static enabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return (env.INGESTION_SCHEDULE ?? 'off').trim().toLowerCase() === 'on';
  }

  async onModuleInit(): Promise<void> {
    if (!SettlementSchedulerService.enabled()) return;
    const url = process.env.REDIS_URL;
    if (url === undefined || url === '') {
      this.log.error('INGESTION_SCHEDULE=on but REDIS_URL is not set; nothing will be settled', {
        event: 'settlement.misconfigured',
      });
      return;
    }
    await this.start(url);
  }

  async start(url: string): Promise<void> {
    const connection = { url, maxRetriesPerRequest: null };
    this.queue = new Queue(SETTLEMENT_QUEUE, { connection });
    this.worker = new Worker(SETTLEMENT_QUEUE, async () => this.tick(), {
      connection,
      concurrency: 1,
    });
    this.worker.on('failed', (job, error) => {
      this.log.error('settlement tick threw', {
        event: 'settlement.tick_threw',
        job: job?.name ?? null,
        error: error.message,
      });
    });
    this.failures.watch(this.worker, SETTLEMENT_QUEUE);
    await this.queue.upsertJobScheduler(
      SETTLEMENT_JOB,
      { pattern: SETTLEMENT_SCHEDULE, tz: 'UTC' },
      { name: SETTLEMENT_JOB, opts: { removeOnComplete: 50, removeOnFail: 50 } },
    );
    this.log.log('settlement tick on', { event: 'settlement.schedule_on' });
  }

  /** One tick: settle what is due, then recompute the members of what was settled. */
  async tick(): Promise<SettlementTickReport> {
    const report: SettlementTickReport = {
      fixtures: 0,
      settled: 0,
      voided: 0,
      members: 0,
      snapshots: 0,
    };
    const fixtureIds: string[] = [];
    for (let pass = 0; pass < SETTLEMENT_PASSES; pass += 1) {
      const due = await this.settlement.settleDue();
      report.fixtures += due.fixtures;
      report.settled += due.settled;
      report.voided += due.voided;
      fixtureIds.push(...due.fixtureIds);
      // A pass that wrote nothing would find the same fixtures again.
      if (due.settled + due.voided === 0) break;
    }
    for (const fixtureId of fixtureIds) {
      const { users, snapshots } = await this.reputation.recomputeForFixture(fixtureId);
      report.members += users;
      report.snapshots += snapshots;
    }
    if (report.fixtures > 0) {
      this.log.log('settled', { event: 'settlement.tick', ...report });
    }
    return report;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    this.worker = null;
    this.queue = null;
  }
}
