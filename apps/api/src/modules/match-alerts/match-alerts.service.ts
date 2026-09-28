import {
  Injectable,
  Logger,
  Optional,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import type { MatchAlertKind } from '@fmip/contracts';
import { MATCH_ALERT_KINDS, notificationLine, notificationPath } from '@fmip/contracts';
import { type ConnectionOptions, type Job, type JobsOptions, Queue, Worker } from 'bullmq';
import { FailureCountsService } from '../failure-counts/failure-counts.service';
import {
  type DueNotification,
  NotificationsService,
  type OutboundMessages,
} from '../notifications/notifications.service';
import {
  MatchAlertsStore,
  type MatchReading,
  type PendingAlert,
  type TeamNewsReading,
} from './internal/match-alerts-store';
import { batchBody, deriveMatchEvents, eventLine, keyEvents } from './internal/match-events';
import { deriveTeamNews, keyTeamNews, teamNewsLine } from './internal/team-news';

/** The queue the ingestion jobs hand their events to (T-835). */
export const MATCH_ALERTS_QUEUE = 'match-alerts';
export const MATCH_ALERTS_JOB = 'expand';
/** What a job carries: the keys of the events one run recorded (none for the sweep at start). */
interface AlertJob {
  events?: string[];
}
/**
 * A job that throws is tried again: the event it could not write is
 * released and stays pending. Five tries over about eight minutes; after
 * that, the next event's job sweeps whatever is still pending.
 */
const JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: 100,
  removeOnFail: 50,
};
/** The push's title, as every notification's is. */
const PUSH_TITLE = 'FMIP';
/**
 * The page a match-alert `carry()` pass reads. Larger than the timer's
 * hundred: a member's alerts of one pass leave as one push, so the fewer
 * pages a burst is cut into, the fewer members hear it twice.
 */
const CARRY_PAGE = 500;
/**
 * A bound on one expansion's delivery passes, so a carrier that keeps
 * finding work cannot hold the worker forever: 200 pages is 100,000
 * notifications, far past a Saturday (T-834); whatever is left leaves on the
 * timer.
 */
const MAX_DELIVERY_PASSES = 200;
/** A bound on the events one expansion takes on; the next job takes the rest. */
const MAX_EVENTS_PER_EXPANSION = 2_000;

/**
 * Match alerts (blueprint 12.2, T-830, D-098).
 *
 * The ingestion jobs hand over two readings of a match -- before and after
 * one write -- and this turns the difference into events (`match-events.ts`)
 * and records each once in `match_alert`. **That is all a job run does**
 * (T-835): at its end it hands the word to a BullMQ job (`dispatch`), and the
 * worker expands each pending event to its audience -- every member who
 * follows either team or the competition -- in one set-based insert
 * (`NotificationsService.emitToAudience`: their kind preference, their team,
 * competition and category mutes, their quiet hours), then carries what it
 * wrote. So the live job's minute never waits on an audience.
 *
 * The event key is the notification's dedupe key, so a retry, a replay or a
 * second process reaches nobody twice. The claim on an event
 * (`claimPending`: `SKIP LOCKED`, a two-minute lease) keeps two workers from
 * doing the same work; it is not what makes doing it twice safe.
 *
 * Without a queue -- no `REDIS_URL`, not the process that runs the jobs, a
 * test, or a queue that refused the job -- the events are expanded and
 * carried at the end of the caller's run, as before T-835.
 *
 * **A disallowed goal is a correction, and only to those told.** It goes to
 * the members who hold a notification for the goal it withdraws; a member
 * who never heard of the goal is not told it did not happen. It is not
 * expanded until that goal has been.
 *
 * **It never fails the ingestion.** Every method a job run calls catches
 * and logs: a match's score is the product, and an alert about it is a
 * consequence.
 */
@Injectable()
export class MatchAlertsService implements OnModuleInit, OnApplicationShutdown {
  private readonly log = new Logger(MatchAlertsService.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(
    private readonly store: MatchAlertsStore,
    private readonly notifications: NotificationsService,
    /** Counts the worker's failed jobs (T-803); absent in the unit tests that build this by hand. */
    @Optional() private readonly failures?: FailureCountsService,
  ) {}

  /** Whether this instance runs the jobs, and so the alerts' queue and worker. */
  static scheduleOn(env: NodeJS.ProcessEnv = process.env): boolean {
    return (env.INGESTION_SCHEDULE ?? 'off').trim().toLowerCase() === 'on';
  }

  /** A member's alerts of one pass leave as one push (T-830's burst rule). */
  async onModuleInit(): Promise<void> {
    this.notifications.registerBatch(MATCH_ALERT_KINDS, (due) => composeBatch(due));
    if (!MatchAlertsService.scheduleOn()) return;
    const url = process.env.REDIS_URL;
    if (url === undefined || url === '') {
      this.log.error(
        'INGESTION_SCHEDULE=on but REDIS_URL is not set; match alerts are written inside the job runs',
        { event: 'match_alert.queue_misconfigured' },
      );
      return;
    }
    await this.start(url);
  }

  /**
   * Starts the queue and, unless told not to, the worker. Separate from
   * `onModuleInit` so a test can drive it -- and hold the worker back, to see
   * what a job run alone leaves behind.
   */
  async start(url: string, options: { worker?: boolean } = {}): Promise<void> {
    const connection: ConnectionOptions = { url, maxRetriesPerRequest: null };
    this.queue = new Queue(MATCH_ALERTS_QUEUE, { connection });
    if (options.worker !== false) this.startWorker(url);
    // Whatever a process that stopped left pending (two minutes and more) is swept at once.
    await this.queue.add(MATCH_ALERTS_JOB, { events: [] }, JOB_OPTIONS);
  }

  /** The worker alone: several processes may each run one on the same queue. */
  startWorker(url: string): void {
    const connection: ConnectionOptions = { url, maxRetriesPerRequest: null };
    this.worker = new Worker(
      MATCH_ALERTS_QUEUE,
      async (job: Job<AlertJob>) => this.expandPending(job.data.events ?? [], true),
      {
        connection,
        concurrency: 1,
      },
    );
    this.worker.on('failed', (job, error) => {
      this.log.error('match alert job threw', {
        event: 'match_alert.job_threw',
        job: job?.id ?? null,
        error: error.message,
      });
    });
    // Failed and stalled jobs are counted per hour (T-803).
    this.failures?.watch(this.worker, MATCH_ALERTS_QUEUE);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    this.worker = null;
    this.queue = null;
  }

  /** The match as it stands before a write; null when it cannot be read, and then nothing is derived. */
  async before(fixtureId: string): Promise<MatchReading | null> {
    try {
      return await this.store.reading(fixtureId);
    } catch (error) {
      this.fault('read', fixtureId, error);
      return null;
    }
  }

  /**
   * After the write: the events between the two readings, recorded. Returns
   * the keys newly recorded, for the caller to `dispatch` at the end of its
   * run. Nobody is told here.
   */
  async after(before: MatchReading, hints: { halfTimeBreak?: boolean } = {}): Promise<string[]> {
    try {
      const after = await this.store.reading(before.fixtureId);
      if (after === null) return [];
      const events = deriveMatchEvents(before.state, after.state, hints);
      if (events.length === 0) return [];
      const keyed = keyEvents(before.fixtureId, events, await this.store.history(before.fixtureId));

      return await this.record(
        before.fixtureId,
        keyed.map((entry) => ({
          ...entry,
          line: eventLine(entry.event, after.teams, after.state),
        })),
      );
    } catch (error) {
      this.fault('derive', before.fixtureId, error);
      return [];
    }
  }

  /** A match's team news before the line-ups job writes it (T-832); null when it cannot be read. */
  async teamNewsBefore(fixtureId: string): Promise<TeamNewsReading | null> {
    try {
      return await this.store.teamNews(fixtureId);
    } catch (error) {
      this.fault('read', fixtureId, error);
      return null;
    }
  }

  /**
   * After the line-ups job's write (T-832, D-100): the line-ups announced
   * and each player newly listed out, recorded like any match alert.
   * Returns the keys newly recorded.
   */
  async teamNewsAfter(before: TeamNewsReading): Promise<string[]> {
    try {
      const after = await this.store.teamNews(before.fixtureId);
      if (after === null) return [];
      const events = deriveTeamNews(before.state, after.state);
      if (events.length === 0) return [];
      const keyed = keyTeamNews(
        before.fixtureId,
        events,
        await this.store.history(before.fixtureId),
      );
      return await this.record(
        before.fixtureId,
        keyed.map((entry) => ({
          key: entry.key,
          kind: entry.kind,
          withdraws: null,
          line: teamNewsLine(entry.event, after.teams),
        })),
      );
    } catch (error) {
      this.fault('team_news', before.fixtureId, error);
      return [];
    }
  }

  /**
   * Record each event once. A key already there is a race lost to a second
   * process, or a replay: not recorded again, and not returned.
   */
  private async record(
    fixtureId: string,
    entries: { key: string; kind: MatchAlertKind; withdraws: string | null; line: string }[],
  ): Promise<string[]> {
    const recorded: string[] = [];
    for (const entry of entries) {
      const fresh = await this.store.record({
        key: entry.key,
        fixtureId,
        kind: entry.kind,
        withdraws: entry.withdraws,
        line: entry.line,
      });
      if (fresh) recorded.push(entry.key);
    }
    return recorded;
  }

  /**
   * The end of a run that recorded events: hand them to the queue, so the
   * run -- the live job, which keeps the scores current -- ends at once
   * whatever the audience (T-835). The job names the run's events, and any
   * event pending for more than two minutes goes with them, so a job lost
   * with its process is made good by the next one. Without a queue, or when
   * the queue refuses the job, the events are expanded and carried here, as
   * before. Never throws.
   */
  async dispatch(eventKeys: string[]): Promise<void> {
    if (eventKeys.length === 0) return;
    if (this.queue !== null) {
      try {
        await this.queue.add(MATCH_ALERTS_JOB, { events: eventKeys }, JOB_OPTIONS);
        return;
      } catch (error) {
        this.log.error(
          `match_alert.enqueue_failed events=${String(eventKeys.length)}; written in this run instead`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
    await this.expandPending(eventKeys, false);
  }

  /**
   * The worker's job (T-835): claim each pending event of `keys` (and any
   * pending for more than two minutes), oldest first, write
   * its audience's notifications in one statement, mark it done, and at the
   * end carry what was written for now, one push per member.
   *
   * The audience is the match's followers; for a correction, the members
   * told of the goal it withdraws. An event that cannot be written is
   * released, what the pass did write is still carried, and then the job
   * fails so the queue tries again (`rethrow`); in a job run, it is logged.
   */
  async expandPending(keys: string[], rethrow: boolean): Promise<{ events: number; told: number }> {
    const told = new Set<string>();
    const followers = new Map<string, string[]>();
    let events = 0;
    let failure: unknown = null;
    for (let n = 0; n < MAX_EVENTS_PER_EXPANSION; n += 1) {
      let event: PendingAlert | null;
      try {
        event = await this.store.claimPending(keys);
      } catch (error) {
        failure = error;
        break;
      }
      if (event === null) break;
      try {
        for (const userId of await this.expand(event, followers)) told.add(userId);
        await this.store.markExpanded(event.key);
        events += 1;
      } catch (error) {
        failure = error;
        await this.store.release(event.key).catch(() => undefined);
        break;
      }
    }
    await this.deliver([...told]);
    if (failure !== null) {
      this.log.error(
        `match_alert.expand_failed after=${String(events)}`,
        failure instanceof Error ? failure.stack : String(failure),
      );
      if (rethrow) throw failure instanceof Error ? failure : new Error(String(failure));
    }
    return { events, told: told.size };
  }

  /** One event to its audience; the members who may be carried now. Throws when nothing could be written. */
  private async expand(event: PendingAlert, followers: Map<string, string[]>): Promise<string[]> {
    let audience = event.withdraws === null ? followers.get(event.fixtureId) : undefined;
    if (audience === undefined) {
      audience =
        event.withdraws === null
          ? await this.store.followers(event.fixtureId)
          : await this.store.toldOf(event.withdraws);
      if (event.withdraws === null) followers.set(event.fixtureId, audience);
    }
    const written = await this.notifications.emitToAudience(
      {
        kind: event.kind,
        subjectType: 'fixture',
        subjectId: event.fixtureId,
        dedupeKey: event.key,
      },
      audience,
    );
    if (written === null) throw new Error(`match alert ${event.key} could not be written`);
    // A worker that stopped part-way may have written notifications it never
    // carried; this insert found them taken and returned nobody. So a retried
    // event carries its whole audience: `carry` sends only what is due and
    // unclaimed, so nobody hears it twice.
    return event.retried ? audience : written.now;
  }

  /**
   * Carry what was just written for now, scoped to those members, rather than
   * on the five-minute timer: a goal that arrives five minutes late has been
   * seen on television. One push per member per pass (the batch).
   */
  async deliver(userIds: string[]): Promise<void> {
    if (userIds.length === 0) return;
    try {
      // One pass left everyone past the first page for the five-minute timer:
      // at a Saturday's load that was hours (T-834, docs/08-load-test.md). So
      // pass again until these members have nothing due; each pass claims
      // what it sends, so it shrinks.
      for (let pass = 0; pass < MAX_DELIVERY_PASSES; pass += 1) {
        const { due, carried } = await this.notifications.carry({ userIds }, CARRY_PAGE);
        if (due < CARRY_PAGE || carried === 0) break;
      }
    } catch (error) {
      this.log.error(
        `match_alert.deliver_failed members=${String(userIds.length)}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private fault(step: string, fixtureId: string, error: unknown): void {
    this.log.error(
      `match_alert.${step}_failed fixture=${fixtureId}`,
      error instanceof Error ? error.stack : String(error),
    );
  }
}

/**
 * One member's due match alerts as one message: a single alert is its own
 * line and opens its match; several are the first lines and a count, and
 * open the match when they are all about one, the inbox otherwise.
 */
export function composeBatch(due: DueNotification[]): OutboundMessages | null {
  const first = due[0];
  if (first === undefined) return null;
  const lines = due.map((item) =>
    notificationLine({
      kind: item.kind as MatchAlertKind,
      source: null,
      headline: item.headline,
    }),
  );
  const oneMatch = due.every((item) => item.subject_id === first.subject_id);
  // All of one kind about one match opens that kind's part of it (T-832).
  const oneKind = due.every((item) => item.kind === first.kind);
  const path = oneMatch
    ? notificationPath(first.locale, {
        subject_type: 'fixture',
        subject_id: first.subject_id,
        subject_label: null,
        ...(oneKind ? { kind: first.kind } : {}),
      })
    : null;
  const body = batchBody(lines);
  return {
    // E-mail is not for a minute-by-minute stream: a match alert is a push
    // and an inbox row (D-098).
    email: null,
    push: {
      userId: first.user_id,
      title: PUSH_TITLE,
      body,
      url: path ?? `/${first.locale}/notifications`,
    },
  };
}
