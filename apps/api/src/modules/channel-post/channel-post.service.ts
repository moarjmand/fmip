import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import type {
  ChannelPostHealth,
  ChannelPostKind,
  ChannelPostRecordSummary,
  ChannelPostState,
  ScoresFilters,
  ScoresGroup,
} from '@fmip/contracts';
import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import { FailureCountsService } from '../failure-counts/failure-counts.service';
import { FixturesService } from '../fixtures/fixtures.service';
import { EvaluationService } from '../forecast/evaluation.service';
import { ForecastService } from '../forecast/forecast.service';
import {
  CHANNEL_POST_CONFIG,
  ChannelRefusal,
  type ChannelPostConfig,
  type ChannelPublisher,
} from './channel-post.port';
import { type ChannelPostRecord, PostgresChannelPostStore } from './internal/channel-post-store';
import {
  type DailyPost,
  POST_TIME_ZONE,
  composeDailyPost,
  postDay,
  selectMatches,
} from './internal/daily-post';
import { composeResultsPost, pendingCount, selectResults } from './internal/results-post';
import { addDays, composeWeeklyPost, previousWeekStart } from './internal/weekly-post';

export const CHANNEL_POST_QUEUE = 'channel-post';
export const CHANNEL_POST_JOB = 'daily-post';
/**
 * Hourly, on a minute no other job ticks on. The post goes out on the first
 * tick at or after the post hour, so an instance that was down or being
 * replaced at that hour posts on the next one instead of skipping the day.
 */
export const CHANNEL_POST_SCHEDULE = '41 * * * *';

/**
 * How long past the post hour the results post waits for a finished match's
 * forecast to be scored (T-1430, D-222). Evaluation runs on the forecast
 * tick and is normally done hours before; past this the post goes out with
 * such a match marked "not scored yet" and left out of the count.
 */
export const RESULTS_WAIT_HOURS = 6;

/** What one tick did for one kind of post, for the log and for a test that must know. */
export type PostOutcome =
  | { kind: 'off' }
  | { kind: 'too_early'; day: string }
  /** Not this post's day: the weekly post goes out on Mondays only. */
  | { kind: 'not_due'; day: string }
  /** The day is on record already: this instance or another posted it, or is posting it. */
  | { kind: 'already'; day: string; state: ChannelPostState }
  /** Nothing to post; nothing sent and nothing recorded. */
  | { kind: 'nothing'; day: string }
  /** Finished matches whose forecast is not scored yet; a later tick looks again. */
  | { kind: 'waiting'; day: string; pending: number }
  | { kind: 'sent'; day: string; messages: number }
  | { kind: 'refused'; day: string; reason: string }
  | { kind: 'failed'; day: string; reason: string; delivered: number };

/** One tick, every kind: in the order they go out. */
export interface TickOutcome {
  results: PostOutcome;
  weekly: PostOutcome;
  forecast: PostOutcome;
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const LABEL: Record<ChannelPostKind, string> = {
  forecast: 'channel post',
  results: 'results post',
  weekly_accuracy: 'weekly accuracy post',
};

/**
 * The posts to a public channel: each day the day's matches with the
 * statistical model's forecast (T-525), each linking to its match page; the
 * previous day's finished matches against the model's last forecast before
 * kick-off; and on Mondays the model's accuracy over the week just ended
 * (T-1430, D-222). On the post hour's tick they go out in that order --
 * yesterday's results, the week, today's forecasts.
 *
 * **At most once per kind and day**, across restarts and across instances:
 * the row in `channel_post` is claimed before anything is sent, and whoever
 * holds the claim is the only sender. A tick that finds it on record stops;
 * a post refused by the channel before anything went out is the one that
 * may be taken over later that day.
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
  /** Per kind, the last day a "nothing to post" was logged, so an empty day is said once, not hourly. */
  private readonly quietDay = new Map<ChannelPostKind, string>();

  constructor(
    @Inject(CHANNEL_POST_CONFIG) private readonly config: ChannelPostConfig,
    private readonly store: PostgresChannelPostStore,
    private readonly fixtures: FixturesService,
    private readonly forecasts: ForecastService,
    private readonly evaluations: EvaluationService,
    /** Counts the worker's failed jobs (T-803); absent in the unit tests that build this by hand. */
    @Optional() private readonly failures?: FailureCountsService,
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
    this.worker = new Worker(CHANNEL_POST_QUEUE, async () => this.tick(), {
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
    this.failures?.watch(this.worker, CHANNEL_POST_QUEUE);
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
   * The hourly job: yesterday's results, the week's accuracy, today's
   * forecasts. One kind's database fault does not stop the others; the first
   * is thrown once all three have had their turn, so the job still fails.
   */
  async tick(now = new Date()): Promise<TickOutcome> {
    const errors: unknown[] = [];
    const guarded = async (step: () => Promise<PostOutcome>): Promise<PostOutcome> => {
      try {
        return await step();
      } catch (error) {
        errors.push(error);
        return { kind: 'failed', day: postDay(now), reason: reasonOf(error), delivered: 0 };
      }
    };
    const results = await guarded(() => this.runResults(now));
    const weekly = await guarded(() => this.runWeekly(now, results));
    const forecast = await guarded(() => this.run(now));
    if (errors.length > 0) throw errors[0];
    return { results, weekly, forecast };
  }

  /**
   * The day's forecasts: post the day if it is time, the day is not on
   * record, and it has a match. Never throws for a channel's failure -- that
   * is recorded on the day and returned; a database fault does throw, and
   * the day stays claimed rather than risk a second post.
   */
  async run(now = new Date()): Promise<PostOutcome> {
    const publisher = this.config.publisher;
    if (publisher === null) return { kind: 'off' };
    const day = postDay(now);
    if (now.getUTCHours() < this.config.postHour) return { kind: 'too_early', day };

    const existing = await this.store.get('forecast', day);
    if (existing !== null && existing.state !== 'refused') {
      return { kind: 'already', day, state: existing.state };
    }

    const post = await this.compose(day, now);
    if (post === null) return this.nothing('forecast', day);
    return this.send('forecast', post, publisher);
  }

  /**
   * The previous UTC day's results (T-1430), from the post hour: by then the
   * day's last kick-off (23:59 UTC at the latest) is more than six hours
   * past. Waits while a finished match's forecast is not scored yet, for at
   * most `RESULTS_WAIT_HOURS`.
   */
  async runResults(now = new Date()): Promise<PostOutcome> {
    const publisher = this.config.publisher;
    if (publisher === null) return { kind: 'off' };
    const day = addDays(postDay(now), -1);
    if (now.getUTCHours() < this.config.postHour) return { kind: 'too_early', day };

    const existing = await this.store.get('results', day);
    if (existing !== null && existing.state !== 'refused') {
      return { kind: 'already', day, state: existing.state };
    }

    const composed = await this.composeResults(day);
    if (composed.post === null) return this.nothing('results', day);
    if (
      composed.pending > 0 &&
      // Capped at the day's last tick, or a late post hour would never post the day.
      now.getUTCHours() < Math.min(this.config.postHour + RESULTS_WAIT_HOURS, 23)
    ) {
      return { kind: 'waiting', day, pending: composed.pending };
    }
    return this.send('results', composed.post, publisher);
  }

  /**
   * The ISO week just ended (T-1430), on Mondays from the post hour, with the
   * public accuracy page's figures for it. Waits while yesterday's results
   * do: Sunday's last matches belong to the week.
   */
  async runWeekly(now = new Date(), results?: PostOutcome): Promise<PostOutcome> {
    const publisher = this.config.publisher;
    if (publisher === null) return { kind: 'off' };
    const week = previousWeekStart(postDay(now));
    if (now.getUTCDay() !== 1) return { kind: 'not_due', day: week };
    if (now.getUTCHours() < this.config.postHour) return { kind: 'too_early', day: week };

    const existing = await this.store.get('weekly_accuracy', week);
    if (existing !== null && existing.state !== 'refused') {
      return { kind: 'already', day: week, state: existing.state };
    }
    if (results?.kind === 'waiting')
      return { kind: 'waiting', day: week, pending: results.pending };

    const post = composeWeeklyPost(
      week,
      await this.evaluations.publicAccuracy('week'),
      this.config.origin,
    );
    if (post === null) return this.nothing('weekly_accuracy', week);
    return this.send('weekly_accuracy', post, publisher);
  }

  private nothing(kind: ChannelPostKind, day: string): PostOutcome {
    if (this.quietDay.get(kind) !== day) {
      this.quietDay.set(kind, day);
      this.log.log(`${LABEL[kind]}: nothing to post for ${day}`, {
        event: 'channel_post.nothing',
        post: kind,
        day,
      });
    }
    return { kind: 'nothing', day };
  }

  /** Claims the kind's day and carries its messages, recording each step. */
  private async send(
    kind: ChannelPostKind,
    post: DailyPost,
    publisher: ChannelPublisher,
  ): Promise<PostOutcome> {
    const day = post.day;
    if (!(await this.store.claim(kind, post, publisher.provider))) {
      return { kind: 'already', day, state: 'sending' };
    }

    let delivered = 0;
    for (const text of post.messages) {
      try {
        await publisher.post(text);
      } catch (error) {
        const reason = reasonOf(error);
        if (error instanceof ChannelRefusal && delivered === 0) {
          await this.store.finish(kind, day, 'refused', reason);
          this.log.warn(`${LABEL[kind]} refused for ${day}: ${reason}`, {
            event: 'channel_post.refused',
            post: kind,
            day,
          });
          return { kind: 'refused', day, reason };
        }
        await this.store.finish(kind, day, 'failed', reason);
        this.log.error(
          `${LABEL[kind]} failed for ${day} after ${delivered} of ${post.messages.length} message(s): ${reason}`,
          { event: 'channel_post.failed', post: kind, day, delivered },
        );
        return { kind: 'failed', day, reason, delivered };
      }
      delivered += 1;
      await this.store.delivered(kind, day);
    }
    await this.store.finish(kind, day, 'sent');
    this.log.log(`${LABEL[kind]} sent for ${day}`, {
      event: 'channel_post.sent',
      post: kind,
      day,
      messages: post.messages.length,
      fixtures: post.fixtures,
      forecasts: post.forecasts,
    });
    return { kind: 'sent', day, messages: post.messages.length };
  }

  /** The scores list a guest is given for one UTC day, in the product's competition order. */
  private async dayGroups(day: string): Promise<ScoresGroup[] | null> {
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
    return outcome.kind === 'ok' ? outcome.response.groups : null;
  }

  /**
   * The day's post from the answers a guest is given: the scores list for
   * the day (the product's competition order) and the published model's
   * latest forecast for each match. Nothing else is read.
   */
  async compose(day: string, now: Date): Promise<DailyPost | null> {
    const groups = await this.dayGroups(day);
    if (groups === null) return null;
    const ids = groups.flatMap((group) => group.fixtures.map((card) => card.id));
    const latest = new Map(
      (await this.forecasts.latestFor(ids)).map((entry) => [entry.fixture_id, entry.latest]),
    );
    return composeDailyPost(day, selectMatches(groups, latest, now), this.config.origin);
  }

  /**
   * The results post for a day: its scores list and, per finished match, the
   * stored evaluation the accuracy figures count. Nothing is scored here.
   */
  async composeResults(day: string): Promise<{ post: DailyPost | null; pending: number }> {
    const groups = await this.dayGroups(day);
    if (groups === null) return { post: null, pending: 0 };
    const ids = groups.flatMap((group) =>
      group.fixtures.filter((card) => card.status === 'finished').map((card) => card.id),
    );
    const competitions = selectResults(groups, await this.evaluations.countedFor(ids));
    return {
      post: composeResultsPost(day, competitions, this.config.origin),
      pending: pendingCount(competitions),
    };
  }

  async health(now = new Date()): Promise<ChannelPostHealth> {
    const publisher = this.config.publisher;
    const [last, results, weekly] = await Promise.all([
      this.store.latest('forecast'),
      this.store.latest('results'),
      this.store.latest('weekly_accuracy'),
    ]);
    return {
      checked_at: now.toISOString(),
      channel:
        publisher === null
          ? { state: 'absent' }
          : { state: 'configured', provider: publisher.provider },
      scheduled: this.queue !== null,
      post_hour_utc: this.config.postHour,
      last: summary(last),
      results_last: summary(results),
      weekly_accuracy_last: summary(weekly),
    };
  }
}

function summary(record: ChannelPostRecord | null): ChannelPostRecordSummary | null {
  return record === null
    ? null
    : {
        day: record.day,
        state: record.state,
        messages: record.messages.length,
        delivered: record.delivered,
        finished_at: record.finishedAt,
      };
}
