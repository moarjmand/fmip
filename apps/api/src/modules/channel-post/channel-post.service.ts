import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import type { ChannelPostHealth, ChannelPostState, ScoresFilters } from '@fmip/contracts';
import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import { FixturesService } from '../fixtures/fixtures.service';
import { ForecastService } from '../forecast/forecast.service';
import { CHANNEL_POST_CONFIG, ChannelRefusal, type ChannelPostConfig } from './channel-post.port';
import { PostgresChannelPostStore } from './internal/channel-post-store';
import {
  type DailyPost,
  POST_TIME_ZONE,
  composeDailyPost,
  postDay,
  selectMatches,
} from './internal/daily-post';

export const CHANNEL_POST_QUEUE = 'channel-post';
export const CHANNEL_POST_JOB = 'daily-post';
/**
 * Hourly, on a minute no other job ticks on. The post goes out on the first
 * tick at or after the post hour, so an instance that was down or being
 * replaced at that hour posts on the next one instead of skipping the day.
 */
export const CHANNEL_POST_SCHEDULE = '41 * * * *';

/** What one tick did, for the log and for a test that must know. */
export type PostOutcome =
  | { kind: 'off' }
  | { kind: 'too_early'; day: string }
  /** The day is on record already: this instance or another posted it, or is posting it. */
  | { kind: 'already'; day: string; state: ChannelPostState }
  /** No match to post; nothing sent and nothing recorded. */
  | { kind: 'nothing'; day: string }
  | { kind: 'sent'; day: string; messages: number }
  | { kind: 'refused'; day: string; reason: string }
  | { kind: 'failed'; day: string; reason: string; delivered: number };

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The daily post to a public channel (T-525): the day's matches with the
 * statistical model's forecast, each linking to its match page.
 *
 * **At most once a day**, across restarts and across instances: the day's
 * row in `channel_post` is claimed before anything is sent, and whoever
 * holds the claim is the only sender. A tick that finds the day on record
 * stops; a day refused by the channel before anything went out is the one
 * that may be taken over later that day.
 *
 * Off unless a channel is configured, and then run by the one instance that
 * runs the jobs (`INGESTION_SCHEDULE=on`), on its own BullMQ queue -- the
 * claim is what makes a second one harmless, not what makes it absent.
 */
@Injectable()
export class ChannelPostService implements OnModuleInit, OnApplicationShutdown {
  private readonly log = new Logger('ChannelPost');
  private queue: Queue | null = null;
  private worker: Worker | null = null;
  /** The last day a "nothing to post" was logged, so an empty day is said once, not hourly. */
  private quietDay: string | null = null;

  constructor(
    @Inject(CHANNEL_POST_CONFIG) private readonly config: ChannelPostConfig,
    private readonly store: PostgresChannelPostStore,
    private readonly fixtures: FixturesService,
    private readonly forecasts: ForecastService,
  ) {}

  /** Whether this instance runs the jobs at all. Read once; changing it needs a restart. */
  static scheduleOn(env: NodeJS.ProcessEnv = process.env): boolean {
    return (env.INGESTION_SCHEDULE ?? 'off').trim().toLowerCase() === 'on';
  }

  async onModuleInit(): Promise<void> {
    const publisher = this.config.publisher;
    if (publisher === null) {
      this.log.log('channel post off: no channel is configured, nothing will be posted', {
        event: 'channel_post.off',
      });
      return;
    }
    if (!ChannelPostService.scheduleOn()) {
      this.log.log(
        `channel post not scheduled here: a ${publisher.provider} channel is configured, but this instance does not run the jobs (INGESTION_SCHEDULE is not on)`,
        { event: 'channel_post.not_scheduled', provider: publisher.provider },
      );
      return;
    }
    const url = process.env.REDIS_URL;
    if (url === undefined || url === '') {
      this.log.error('a channel is configured but REDIS_URL is not set; nothing will be posted', {
        event: 'channel_post.schedule_misconfigured',
      });
      return;
    }
    await this.start(url);
  }

  /** Starts the queue and the worker. Separate from `onModuleInit` so a test can drive it. */
  async start(url: string): Promise<void> {
    const connection: ConnectionOptions = { url, maxRetriesPerRequest: null };
    this.queue = new Queue(CHANNEL_POST_QUEUE, { connection });
    this.worker = new Worker(CHANNEL_POST_QUEUE, async () => this.run(), {
      connection,
      concurrency: 1,
    });
    this.worker.on('failed', (job, error) => {
      this.log.error('channel post job threw', {
        event: 'channel_post.job_threw',
        job: job?.name ?? null,
        error: error.message,
      });
    });
    await this.queue.upsertJobScheduler(
      CHANNEL_POST_JOB,
      { pattern: CHANNEL_POST_SCHEDULE, tz: 'UTC' },
      { name: CHANNEL_POST_JOB, opts: { removeOnComplete: 50, removeOnFail: 50 } },
    );
    this.log.log('channel post on', {
      event: 'channel_post.schedule_on',
      provider: this.config.publisher?.provider ?? null,
      post_hour_utc: this.config.postHour,
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    this.worker = null;
    this.queue = null;
  }

  /**
   * One tick: post the day if it is time, the day is not on record, and it
   * has a match. Never throws for a channel's failure -- that is recorded on
   * the day and returned; a database fault does throw, and the day stays
   * claimed rather than risk a second post.
   */
  async run(now = new Date()): Promise<PostOutcome> {
    const publisher = this.config.publisher;
    if (publisher === null) return { kind: 'off' };
    const day = postDay(now);
    if (now.getUTCHours() < this.config.postHour) return { kind: 'too_early', day };

    const existing = await this.store.get(day);
    if (existing !== null && existing.state !== 'refused') {
      return { kind: 'already', day, state: existing.state };
    }

    const post = await this.compose(day, now);
    if (post === null) {
      if (this.quietDay !== day) {
        this.quietDay = day;
        this.log.log(`channel post: no match to post for ${day}`, {
          event: 'channel_post.nothing',
          day,
        });
      }
      return { kind: 'nothing', day };
    }

    if (!(await this.store.claim(post, publisher.provider))) {
      return { kind: 'already', day, state: 'sending' };
    }

    let delivered = 0;
    for (const text of post.messages) {
      try {
        await publisher.post(text);
      } catch (error) {
        const reason = reasonOf(error);
        if (error instanceof ChannelRefusal && delivered === 0) {
          await this.store.finish(day, 'refused', reason);
          this.log.warn(`channel post refused for ${day}: ${reason}`, {
            event: 'channel_post.refused',
            day,
          });
          return { kind: 'refused', day, reason };
        }
        await this.store.finish(day, 'failed', reason);
        this.log.error(
          `channel post failed for ${day} after ${delivered} of ${post.messages.length} message(s): ${reason}`,
          { event: 'channel_post.failed', day, delivered },
        );
        return { kind: 'failed', day, reason, delivered };
      }
      delivered += 1;
      await this.store.delivered(day);
    }
    await this.store.finish(day, 'sent');
    this.log.log(`channel post sent for ${day}`, {
      event: 'channel_post.sent',
      day,
      messages: post.messages.length,
      fixtures: post.fixtures,
      forecasts: post.forecasts,
    });
    return { kind: 'sent', day, messages: post.messages.length };
  }

  /**
   * The day's post from the answers a guest is given: the scores list for
   * the day (the product's competition order) and the published model's
   * latest forecast for each match. Nothing else is read.
   */
  async compose(day: string, now: Date): Promise<DailyPost | null> {
    const filters: ScoresFilters = {
      from: day,
      to: day,
      timezone: POST_TIME_ZONE,
      live: false,
      favourites: false,
      country_id: null,
      competition_id: null,
      stage_id: null,
      gender: null,
      age: null,
    };
    const outcome = await this.fixtures.scores(filters, null);
    if (outcome.kind !== 'ok') return null;
    const groups = outcome.response.groups;
    const ids = groups.flatMap((group) => group.fixtures.map((card) => card.id));
    const latest = new Map(
      (await this.forecasts.latestFor(ids)).map((entry) => [entry.fixture_id, entry.latest]),
    );
    return composeDailyPost(day, selectMatches(groups, latest, now), this.config.origin);
  }

  async health(now = new Date()): Promise<ChannelPostHealth> {
    const publisher = this.config.publisher;
    const last = await this.store.latest();
    return {
      checked_at: now.toISOString(),
      channel:
        publisher === null
          ? { state: 'absent' }
          : { state: 'configured', provider: publisher.provider },
      scheduled: this.queue !== null,
      post_hour_utc: this.config.postHour,
      last:
        last === null
          ? null
          : {
              day: last.day,
              state: last.state,
              messages: last.messages.length,
              delivered: last.delivered,
              finished_at: last.finishedAt,
            },
    };
  }
}
