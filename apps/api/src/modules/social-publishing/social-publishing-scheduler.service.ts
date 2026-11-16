import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import type { SocialNetwork, SocialPublishingHealth } from '@fmip/contracts';
import { SOCIAL_NETWORKS } from '@fmip/contracts/console';
import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import { FailureCountsService } from '../failure-counts/failure-counts.service';
import {
  PostgresSocialPostStore,
  type SocialFinish,
  type SocialPostRecord,
} from './internal/social-post-store';
import { dueSlot, londonDay, rankCandidates, slotInstants } from './internal/social-rules';
import {
  type DraftReport,
  SOCIAL_OPTIONS,
  type SocialOptions,
  SocialPublishingService,
} from './social-publishing.service';
import { SOCIAL_PUBLISHER, SocialRefusal, type SocialPublisher } from './social-publisher.port';

export const SOCIAL_PUBLISHING_QUEUE = 'social-publishing';
export const SOCIAL_PUBLISHING_JOB = 'social-tick';
/** Every five minutes: the slots (08:30, 12:00, 16:30, 19:00, 21:45 London) fall on a tick. */
export const SOCIAL_PUBLISHING_SCHEDULE = '*/5 * * * *';
/**
 * A claim with no answer recorded after this long is `unknown`: the publisher
 * gives up after 15 s, so a claim this old lost its process between the call
 * and the record, and nothing says whether the post went out.
 */
export const SOCIAL_STALE_CLAIM_MS = 10 * 60 * 1000;
/** Candidates checked a network a tick (each check may end a post whose gate failed). */
export const SOCIAL_CHECKS_PER_TICK = 5;

/** What one tick did on one network, for the log and for a test that must know. */
export type PublishOutcome =
  | { kind: 'stopped' }
  | { kind: 'not_ready'; reason: 'not_set' | 'unreadable' | 'paused' | 'channel' }
  | { kind: 'no_slot' }
  | { kind: 'nothing' }
  /** Another scheduler took the slot first; it publishes, this one does not. */
  | { kind: 'lost_slot' }
  | { kind: 'published'; id: string; providerRef: string; slot: number }
  | { kind: 'refused'; id: string; error: string }
  /** Nothing was sent (no channel, unreachable, rate limit, too long, stopped): slot back, run kept. */
  | { kind: 'not_sent'; id: string; why: 'not_sent' | 'stopped'; error: string }
  | { kind: 'unknown'; id: string; error: string };

export interface SocialTick {
  drafted: DraftReport | null;
  stale: number | null;
  published: Partial<Record<SocialNetwork, PublishOutcome | null>>;
}

/**
 * The social posts' job (T-1837, D-427): every five minutes, on its own
 * BullMQ queue, on the one instance that runs the jobs
 * (`INGESTION_SCHEDULE=on`). Each tick drafts what is due
 * (`draftCandidates`), records as `unknown` any claim left without an
 * answer, then publishes at most one post a network:
 *
 * 1. nothing while the kill switch is on, with no key, an unreadable key, or
 *    while the provider asked for a pause (a 429);
 * 2. only at a slot whose time has come and that is still free (D-427 point
 *    4, `dueSlot`); a refused post only at a slot after its refusal;
 * 3. the best-ranked candidate (competition order, kick-off, kind) whose
 *    gates still pass and that has not turned sensitive (`checkAtPublishing`
 *    ends or withdraws the others);
 * 4. claimed in the database before the call (`approved`/`refused` ->
 *    `publishing`, the slot taken; the database refuses a second claim, a
 *    claim while stopped, and the job's claim for a kind no longer
 *    automatic), so a post is published at most once across restarts and
 *    instances;
 * 5. the answer recorded: a reference is `published`; a refusal `refused`
 *    (slot given back, tried again at a later slot while valid); anything
 *    else `unknown` (slot kept, never retried by the job; a person settles
 *    it from Buffer). Buffer refusing the post itself, or an unknown, is a
 *    publishing error: it resets the kind's run and lowers an automatic
 *    kind, audited (the store's `finish`). A refusal before anything was
 *    sent -- no channel, Buffer unreachable, a 429, a text over the limit,
 *    a stop that landed after the claim -- gives the slot back and keeps
 *    the run (T-1839). The channel is checked before any claim.
 *
 * A tick takes a database advisory lock, so two ticks never overlap even if
 * two instances were ever both told to run the jobs; the claim is what makes
 * that harmless, the lock what keeps the drafting single.
 */
@Injectable()
export class SocialPublishingScheduler implements OnModuleInit, OnApplicationShutdown {
  private readonly log = new Logger('SocialPublishing');
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(
    private readonly social: SocialPublishingService,
    private readonly store: PostgresSocialPostStore,
    @Inject(SOCIAL_PUBLISHER) private readonly publisher: SocialPublisher,
    @Inject(SOCIAL_OPTIONS) private readonly options: SocialOptions,
    /** Counts the worker's failed jobs (T-803); absent in tests that build this by hand. */
    @Optional() private readonly failures?: FailureCountsService,
  ) {}

  /** Whether this instance runs the jobs at all. Read once; changing it needs a restart. */
  static scheduleOn(env: NodeJS.ProcessEnv = process.env): boolean {
    return (env.INGESTION_SCHEDULE ?? 'off').trim().toLowerCase() === 'on';
  }

  async onModuleInit(): Promise<void> {
    if (!SocialPublishingScheduler.scheduleOn()) {
      this.log.log('social posts not scheduled here: this instance does not run the jobs', {
        event: 'social.not_scheduled',
      });
      return;
    }
    const url = process.env.REDIS_URL;
    if (url === undefined || url === '') {
      this.log.error(
        'the jobs run here but REDIS_URL is not set; no social post is drafted or published',
        {
          event: 'social.schedule_misconfigured',
        },
      );
      return;
    }
    await this.start(url);
  }

  /** Starts the queue and the worker. Separate from `onModuleInit` so a test can drive it. */
  async start(url: string): Promise<void> {
    const connection: ConnectionOptions = { url, maxRetriesPerRequest: null };
    this.queue = new Queue(SOCIAL_PUBLISHING_QUEUE, { connection });
    this.worker = new Worker(SOCIAL_PUBLISHING_QUEUE, async () => this.tick(), {
      connection,
      concurrency: 1,
    });
    this.worker.on('failed', (job, error) => {
      this.log.error('social posts job threw', {
        event: 'social.job_threw',
        job: job?.name ?? null,
        error: error.message,
      });
    });
    this.failures?.watch(this.worker, SOCIAL_PUBLISHING_QUEUE);
    await this.queue.upsertJobScheduler(
      SOCIAL_PUBLISHING_JOB,
      { pattern: SOCIAL_PUBLISHING_SCHEDULE, tz: 'UTC' },
      { name: SOCIAL_PUBLISHING_JOB, opts: { removeOnComplete: 50, removeOnFail: 50 } },
    );
    this.log.log('social posts on', {
      event: 'social.schedule_on',
      publisher: this.publisher.provider,
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    this.worker = null;
    this.queue = null;
  }

  /**
   * One tick: draft, settle lost claims, publish a post a network. One step's
   * fault does not stop the others; the first is thrown once all have had
   * their turn, so the job still fails. A tick that finds another running
   * does nothing.
   */
  async tick(now = new Date()): Promise<SocialTick | null> {
    return this.store.exclusive(async () => {
      const errors: unknown[] = [];
      const guarded = async <T>(step: () => Promise<T>): Promise<T | null> => {
        try {
          return await step();
        } catch (error) {
          errors.push(error);
          return null;
        }
      };
      const drafted = await guarded(() => this.social.draftCandidates(now));
      const stale = await guarded(() => this.settleStale(now));
      const published: SocialTick['published'] = {};
      for (const network of SOCIAL_NETWORKS) {
        published[network] = await guarded(() => this.publishDue(network, now));
      }
      if (errors.length > 0) throw errors[0];
      return { drafted, stale, published };
    });
  }

  /** The one post due on a network now, if any, published at most once. */
  async publishDue(network: SocialNetwork, now = new Date()): Promise<PublishOutcome> {
    if (await this.store.stopped()) return { kind: 'stopped' };
    const ready = await this.publisher.readiness(now);
    if (!ready.ready) return { kind: 'not_ready', reason: ready.reason };

    const due = dueSlot(now, await this.store.heldSlots(network, londonDay(now)));
    if (due === null) return { kind: 'no_slot' };
    // A refused post waits for a slot after its refusal ("tried again at the next slot").
    const slotStart = slotInstants(due.post_day)[due.slot - 1]!;
    const rows = (await this.store.publishable(network, now)).filter(
      (r) => r.state === 'approved' || r.updated_at.getTime() < slotStart.getTime(),
    );
    const ranked = rankCandidates(
      rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        competition_rank: r.competition_rank,
        kick_off: r.kick_off,
        expires_at: r.expires_at.toISOString(),
      })),
    );
    if (ranked.length === 0) return { kind: 'nothing' };
    // The network's channel, before anything is claimed (T-1839).
    const channel = await this.publisher.readiness(now, network);
    if (!channel.ready) return { kind: 'not_ready', reason: channel.reason };
    for (const candidate of ranked.slice(0, SOCIAL_CHECKS_PER_TICK)) {
      const check = await this.social.checkAtPublishing(candidate.id, now);
      if (!check.go) {
        if (check.why !== 'gone') {
          this.log.log('social post not published at its slot', {
            event: 'social.not_published',
            post: candidate.id,
            why: check.why,
            failed: check.failed ?? [],
          });
        }
        continue;
      }
      const claim = await this.social.claim(candidate.id, due.slot);
      if (!claim.ok) {
        if (claim.refusal === 'not_claimable' || claim.refusal === 'not_found') continue;
        return claim.refusal === 'stopped' ? { kind: 'stopped' } : { kind: 'lost_slot' };
      }
      return this.send(check.post, claim.value.slot);
    }
    return { kind: 'nothing' };
  }

  /** Claims older than `SOCIAL_STALE_CLAIM_MS` with no answer recorded become `unknown`. */
  async settleStale(now = new Date()): Promise<number> {
    let settled = 0;
    for (const id of await this.store.staleClaims(
      new Date(now.getTime() - SOCIAL_STALE_CLAIM_MS),
    )) {
      const finished = await this.social.finish(id, {
        state: 'unknown',
        error: 'no answer was recorded for this claim',
      });
      if (finished.ok) settled += 1;
    }
    if (settled > 0) {
      this.log.warn('social posts left publishing are unknown: a person settles them', {
        event: 'social.stale_claims',
        count: settled,
      });
    }
    return settled;
  }

  async health(now = new Date()): Promise<SocialPublishingHealth> {
    const [key, stopped, last] = await Promise.all([
      this.publisher.keyState(),
      this.store.stopped(),
      this.store.lastByNetwork(),
    ]);
    return {
      checked_at: now.toISOString(),
      publisher: this.publisher.provider,
      key,
      stopped,
      scheduled: this.queue !== null,
      paused_until: this.publisher.pausedUntil(now)?.toISOString() ?? null,
      networks: SOCIAL_NETWORKS.map((network) => {
        const row = last.find((r) => r.network === network);
        return {
          network,
          last_published_at: row?.published_at?.toISOString() ?? null,
          last_attempt:
            row?.state === null || row?.state === undefined || row.at === null
              ? null
              : { state: row.state, at: row.at.toISOString() },
        };
      }),
    };
  }

  /** The card's public address: the web's `/social-card/<id>/card.png` (T-1835). */
  cardUrl(id: string): string {
    return `${this.options.origin}/social-card/${id}/card.png`;
  }

  private async send(post: SocialPostRecord, slot: number): Promise<PublishOutcome> {
    let answer: SocialFinish;
    try {
      // A stop that committed after the claim: nothing has been sent, and it is not the post's fault.
      if (await this.store.stopped()) {
        answer = {
          state: 'refused',
          error: 'publishing was stopped before sending',
          notSent: 'stopped',
        };
      } else {
        const { providerRef } = await this.publisher.publish({
          network: post.network,
          text: post.body,
          imageUrl: this.cardUrl(post.id),
        });
        answer = { state: 'published', providerRef };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      answer = !(error instanceof SocialRefusal)
        ? { state: 'unknown', error: message }
        : error.beforeSend
          ? { state: 'refused', error: message, notSent: 'not_sent' }
          : { state: 'refused', error: message };
    }
    try {
      await this.social.finish(post.id, answer);
    } catch (error) {
      // The post stays `publishing`; `settleStale` makes it `unknown` later. The
      // reference is said here so a person can settle it from Buffer.
      this.log.error('a social post was sent but its answer could not be recorded', {
        event: 'social.finish_failed',
        post: post.id,
        answer: answer.state,
        provider_ref: answer.state === 'published' ? answer.providerRef : null,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    const event = {
      event: `social.${answer.state}`,
      post: post.id,
      network: post.network,
      kind: post.kind,
      slot,
    };
    if (answer.state === 'published') {
      this.log.log('social post published', { ...event, provider_ref: answer.providerRef });
      return { kind: 'published', id: post.id, providerRef: answer.providerRef, slot };
    }
    if (answer.state === 'refused' && answer.notSent !== undefined) {
      this.log.log('social post not sent: its slot given back, the run kept', {
        ...event,
        event: 'social.not_sent',
        why: answer.notSent,
        error: answer.error,
      });
      return { kind: 'not_sent', id: post.id, why: answer.notSent, error: answer.error };
    }
    this.log.warn(`social post ${answer.state}`, { ...event, error: answer.error });
    return { kind: answer.state, id: post.id, error: answer.error };
  }
}
