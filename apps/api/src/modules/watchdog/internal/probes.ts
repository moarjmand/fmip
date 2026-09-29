import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { Queue } from 'bullmq';
import { CHANNEL_POST_QUEUE } from '../../channel-post/channel-post.service';
import { DATA_QUALITY_QUEUE } from '../../data-quality/data-quality-scheduler.service';
import { DataQualityService } from '../../data-quality/data-quality.service';
import { DeliveryService } from '../../delivery/delivery.service';
import { NO_MODEL_SERVICE } from '../../forecast/forecast.module';
import { ForecastService } from '../../forecast/forecast.service';
import { IngestRunsService } from '../../ingestion/ingest-runs.service';
import { INGESTION_QUEUE } from '../../ingestion/ingestion-scheduler.service';
import { MATCH_ALERTS_QUEUE } from '../../match-alerts/match-alerts.service';
import { NEWS_QUEUE } from '../../news/news-scheduler.service';
import { LIVE_FEED_THRESHOLD } from './conditions';
import type { Observations, Unreadable } from './readings';
import { WatchdogStore } from './watchdog-store';

/** The watchdog's own queue; its failures are watched like any other's. */
export const WATCHDOG_QUEUE = 'watchdog';

/** Every BullMQ queue this API runs a worker for. */
export const WATCHED_QUEUES = [
  INGESTION_QUEUE,
  NEWS_QUEUE,
  CHANNEL_POST_QUEUE,
  DATA_QUALITY_QUEUE,
  MATCH_ALERTS_QUEUE,
  WATCHDOG_QUEUE,
];

const HOUR_MS = 60 * 60 * 1000;
/** Each queue keeps its newest 50 failed jobs (`removeOnFail: 50`); read them all. */
const FAILED_READ = 100;

/** What a tick reads. A port so the queue test can hand the service fixed observations. */
export const WATCHDOG_PROBES = Symbol('WATCHDOG_PROBES');
export interface WatchdogProbes {
  observe(now: Date): Promise<Observations>;
}

const why = (error: unknown): Unreadable => ({
  unreadable: error instanceof Error ? error.message : String(error),
});

async function orUnreadable<T>(read: () => Promise<T>): Promise<T | Unreadable> {
  try {
    return await read();
  } catch (error: unknown) {
    return why(error);
  }
}

/**
 * The health views as the watchdog reads them (T-801): the ingestion view's
 * runs and budget (T-071, T-501), the live fixtures' last change (D-045), the
 * BullMQ failed sets, the model service's health check, the delivery
 * channels and their recorded outcomes (T-330), and what the backup and the
 * restore drill recorded in `backup_run` from the host (T-805).
 */
@Injectable()
export class LiveProbes implements WatchdogProbes, OnApplicationShutdown {
  private readonly queues = new Map<string, Queue>();

  constructor(
    private readonly runs: IngestRunsService,
    private readonly forecasts: ForecastService,
    private readonly delivery: DeliveryService,
    private readonly store: WatchdogStore,
    private readonly dataQuality: DataQualityService,
  ) {}

  async observe(now: Date): Promise<Observations> {
    const hourAgo = new Date(now.getTime() - HOUR_MS);
    const [ingest, live, budget, queues, health, delivery, dataQuality, backups] =
      await Promise.all([
        orUnreadable(async () => {
          const rows = await this.runs.jobCompletions();
          return rows.map((r) => ({ ...r, job: r.job as string }));
        }),
        orUnreadable(() => this.store.liveFixtures(now, LIVE_FEED_THRESHOLD.degraded * 1000)),
        orUnreadable(async () => {
          const health = await this.runs.ingestionHealth(now);
          return { requestsToday: health.requests_today, budget: health.request_budget };
        }),
        Promise.all(WATCHED_QUEUES.map((name) => this.failedSince(name, hourAgo))),
        this.model(now),
        orUnreadable(async () => {
          const channels = this.delivery.describe();
          const outcomes = await this.store.deliveryOutcomes(hourAgo);
          return {
            email:
              channels.email.state === 'configured'
                ? { configured: true as const, ...outcomes.email }
                : { configured: false as const },
            push:
              channels.push.state === 'configured'
                ? { configured: true as const, ...outcomes.push }
                : { configured: false as const },
          };
        }),
        orUnreadable(() => this.dataQuality.liveContradictions(now)),
        orUnreadable(() => this.store.backupRuns()),
      ]);
    const { model, elo, candidates } = health;
    return {
      ingest,
      live,
      budget,
      queues,
      model,
      elo,
      delivery,
      dataQuality,
      backups,
      candidates,
    };
  }

  /**
   * The model service's health check, Club Elo's state it carries (T-920),
   * and the candidates it lists with whether each answers (T-1165).
   */
  private async model(now: Date): Promise<{
    model: Observations['model'];
    elo: NonNullable<Observations['elo']>;
    candidates: NonNullable<Observations['candidates']>;
  }> {
    const url = (process.env.MODEL_SERVICE_URL ?? '').trim().toLowerCase();
    if (url === '' || url === NO_MODEL_SERVICE) {
      return {
        model: { configured: false },
        elo: { configured: false },
        candidates: { configured: false },
      };
    }
    try {
      const health = await this.forecasts.modelHealth();
      if (!health.ok) {
        return {
          model: { configured: true, ok: false, reason: health.reason },
          elo: { unreadable: health.reason },
          candidates: { unreadable: health.reason },
        };
      }
      const offered = health.candidateVersions;
      return {
        model: { configured: true, ok: true },
        elo: { source: health.eloSource },
        candidates: {
          offered,
          health:
            offered === null || offered.length === 0
              ? new Map()
              : await orUnreadable(() => this.forecasts.candidateShadow(now)),
        },
      };
    } catch (error: unknown) {
      const reason = why(error).unreadable;
      return {
        model: { configured: true, ok: false, reason },
        elo: { unreadable: reason },
        candidates: { unreadable: reason },
      };
    }
  }

  private async failedSince(
    name: string,
    since: Date,
  ): Promise<{ queue: string; failedLastHour: number } | { queue: string; unreadable: string }> {
    const url = process.env.REDIS_URL;
    if (url === undefined || url === '') return { queue: name, unreadable: 'REDIS_URL is not set' };
    try {
      let queue = this.queues.get(name);
      if (queue === undefined) {
        queue = new Queue(name, { connection: { url, maxRetriesPerRequest: null } });
        this.queues.set(name, queue);
      }
      const failed = await queue.getFailed(0, FAILED_READ - 1);
      const count = failed.filter(
        (job) => job !== undefined && (job.finishedOn ?? 0) >= since.getTime(),
      ).length;
      return { queue: name, failedLastHour: count };
    } catch (error: unknown) {
      return { queue: name, unreadable: why(error).unreadable };
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all([...this.queues.values()].map((q) => q.close()));
    this.queues.clear();
  }
}
