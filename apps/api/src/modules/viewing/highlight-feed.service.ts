import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import type { HighlightsFeedHealth, HighlightsFeedRun } from '@fmip/contracts';
import {
  type HighlightlyHighlights,
  type NormalisedHighlight,
  type Transport,
  createHighlightlyHighlights,
} from '@fmip/ingestion';
import { Queue, Worker } from 'bullmq';
import { FailureCountsService } from '../failure-counts/failure-counts.service';
import { EntityResolverService } from '../ingestion/ingestion.service';
import {
  FEED_WINDOW_HOURS,
  type FeedConfig,
  type FeedQuestion,
  GEO_TRIES_PER_MATCH,
  feedQuestions,
  matchClips,
} from './internal/highlight-feed';
import { PostgresHighlightFeedStore } from './internal/highlight-feed-store';
import {
  DailyBudgetTransport,
  HIGHLIGHT_FEED_TRANSPORT,
} from './internal/highlight-feed-transport';

/** The injection token for the feed's configuration, read from the environment once at boot. */
export const HIGHLIGHT_FEED_CONFIG = Symbol('HIGHLIGHT_FEED_CONFIG');

export const HIGHLIGHT_FEED_QUEUE = 'highlight-feed';
export const HIGHLIGHT_FEED_JOB = 'highlight-feed-run';
/** Every two hours, off the hour: a match in the 51-hour window is asked about up to 25 times. */
export const HIGHLIGHT_FEED_SCHEDULE = '29 */2 * * *';
/** Pages of 40 per league and day: a league's day is rarely more than one. */
const MAX_PAGES = 5;

/**
 * The highlights feed (T-1366, D-184): for each finished match of a mapped
 * competition, inside the 51-hour window, ask Highlightly for the day's
 * verified full-match highlights, place each clip on our match through
 * `provider_mapping` (rule 1), ask where the best clip may be watched, and
 * keep it once with that rule -- link only, the viewer sent to the original.
 *
 * Off -- no queue, no request, nothing written -- unless `HIGHLIGHTLY_KEY`
 * holds a key; scheduled only where `INGESTION_SCHEDULE=on`, like every job.
 * Its own daily ceiling (`HIGHLIGHTS_DAILY_BUDGET`), counted apart from the
 * match feed's. A team the feed names that we have not mapped goes to the
 * resolver's queue (`unresolved_entity`), where the operator places it with
 * `catalog.mjs --map --provider highlightly`; until then its clips are kept
 * out and the run says how many and why.
 */
@Injectable()
export class HighlightFeedService implements OnModuleInit, OnApplicationShutdown {
  private readonly log = new Logger('HighlightFeed');
  private readonly budget: DailyBudgetTransport | null;
  private readonly client: HighlightlyHighlights | null;
  private queue: Queue | null = null;
  private worker: Worker | null = null;
  private last: HighlightsFeedRun | null = null;

  constructor(
    @Inject(HIGHLIGHT_FEED_CONFIG) private readonly config: FeedConfig,
    @Inject(HIGHLIGHT_FEED_TRANSPORT) transport: Transport,
    private readonly store: PostgresHighlightFeedStore,
    private readonly resolver: EntityResolverService,
    private readonly failures: FailureCountsService,
  ) {
    if (config.state === 'configured') {
      this.budget = new DailyBudgetTransport(transport, config.dailyBudget);
      this.client = createHighlightlyHighlights(this.budget, config.apiKey);
    } else {
      this.budget = null;
      this.client = null;
    }
  }

  static scheduled(env: NodeJS.ProcessEnv = process.env): boolean {
    return (env.INGESTION_SCHEDULE ?? 'off').trim().toLowerCase() === 'on';
  }

  health(): HighlightsFeedHealth {
    return {
      feed: this.config.state,
      scheduled: this.config.state === 'configured' && HighlightFeedService.scheduled(),
      daily_budget: this.budget?.perDay ?? null,
      requests_today: this.budget?.used ?? null,
      last_run: this.last,
    };
  }

  /** One run; null when the feed is off. */
  async run(now: Date = new Date()): Promise<HighlightsFeedRun | null> {
    if (this.client === null) return null;
    const started = new Date();
    const candidates = await this.store.candidates(now, FEED_WINDOW_HOURS);
    const { questions, unmappedCompetitions } = feedQuestions(candidates);
    const summary: HighlightsFeedRun = {
      started_at: started.toISOString(),
      finished_at: started.toISOString(),
      waiting: candidates.filter((c) => !c.held).length,
      unmapped_competitions: unmappedCompetitions.size,
      questions: 0,
      stored: 0,
      unmatched: { team_unmapped: 0, no_fixture: 0, ambiguous: 0 },
      no_territory_rule: 0,
      requests: 0,
      stopped: null,
    };
    for (const competitionId of unmappedCompetitions) {
      this.log.log('competition not mapped to the highlights feed', {
        event: 'highlights.competition_unmapped',
        competition_id: competitionId,
      });
    }
    for (const question of questions) {
      summary.questions += 1;
      const outcome = await this.ask(this.client, question, summary);
      if (outcome === 'quota') {
        summary.stopped = 'quota';
        break;
      }
    }
    summary.finished_at = new Date().toISOString();
    this.last = summary;
    this.log.log('highlights feed ran', { event: 'highlights.ran', ...summary });
    return summary;
  }

  private async ask(
    client: HighlightlyHighlights,
    question: FeedQuestion,
    summary: HighlightsFeedRun,
  ): Promise<'done' | 'quota'> {
    const listed = await client.list({
      date: question.date,
      leagueExternalId: question.leagueExternalId,
      maxPages: MAX_PAGES,
    });
    summary.requests += listed.requests;
    if (!listed.ok) {
      this.log.warn('highlights list refused', {
        event: 'highlights.list_failed',
        competition_id: question.competitionId,
        date: question.date,
        kind: listed.error.kind,
        message: listed.error.message,
      });
      return listed.error.kind === 'quota' ? 'quota' : 'done';
    }
    const clips = listed.data.highlights;
    const teams = await this.teams(clips, question.competitionId);
    const { matched, unmatched } = matchClips(clips, question.candidates, teams);
    for (const { reason, clip } of unmatched) {
      summary.unmatched[reason] += 1;
      this.log.log('verified highlight kept out', {
        event: 'highlights.unmatched',
        reason,
        competition_id: question.competitionId,
        date: question.date,
        feed_match: clip.match.externalId,
        home: clip.match.home.name,
        away: clip.match.away.name,
      });
    }
    for (const [fixtureId, ranked] of matched) {
      const candidate = question.candidates.find((c) => c.fixtureId === fixtureId);
      if (candidate === undefined || candidate.held) continue;
      const outcome = await this.place(client, fixtureId, ranked, summary);
      if (outcome === 'quota') return 'quota';
    }
    return 'done';
  }

  /** Asks where each clip may be watched, best first, and keeps the first one with a known rule. */
  private async place(
    client: HighlightlyHighlights,
    fixtureId: string,
    ranked: NormalisedHighlight[],
    summary: HighlightsFeedRun,
  ): Promise<'done' | 'quota'> {
    for (const clip of ranked.slice(0, GEO_TRIES_PER_MATCH)) {
      const geo = await client.geo(clip.externalId);
      summary.requests += geo.requests;
      if (!geo.ok) {
        this.log.warn('highlight territory rule refused', {
          event: 'highlights.geo_failed',
          fixture_id: fixtureId,
          kind: geo.error.kind,
          message: geo.error.message,
        });
        return geo.error.kind === 'quota' ? 'quota' : 'done';
      }
      if (geo.data.state === 'unknown') {
        summary.no_territory_rule += 1;
        continue;
      }
      const stored = await this.store.store(fixtureId, {
        url: clip.url,
        title: clip.title,
        publisher: clip.publisher,
        allowed: geo.data.allowed,
        blocked: geo.data.blocked,
      });
      if (stored) summary.stored += 1;
      return 'done';
    }
    return 'done';
  }

  /** The feed's team ids -> ours, through the resolver; an unmapped one is queued for the operator. */
  private async teams(
    clips: NormalisedHighlight[],
    competitionId: string,
  ): Promise<Map<string, string | null>> {
    const named = new Map<string, string>();
    for (const clip of clips) {
      named.set(clip.match.home.externalId, clip.match.home.name);
      named.set(clip.match.away.externalId, clip.match.away.name);
    }
    const teams = new Map<string, string | null>();
    for (const [externalId, name] of named) {
      const resolution = await this.resolver.resolve(
        { provider: 'highlightly', entityType: 'team', externalId },
        { name, seenIn: competitionId },
      );
      teams.set(externalId, resolution.kind === 'resolved' ? resolution.internalId : null);
    }
    return teams;
  }

  async onModuleInit(): Promise<void> {
    const url = process.env.REDIS_URL;
    if (this.config.state === 'absent') {
      this.log.log('highlights feed off: no HIGHLIGHTLY_KEY', { event: 'highlights.feed_off' });
      return;
    }
    if (!HighlightFeedService.scheduled() || url === undefined || url === '') return;
    const connection = { url, maxRetriesPerRequest: null };
    this.queue = new Queue(HIGHLIGHT_FEED_QUEUE, { connection });
    this.worker = new Worker(HIGHLIGHT_FEED_QUEUE, async () => this.run(), {
      connection,
      concurrency: 1,
    });
    this.worker.on('failed', (job, error) => {
      this.log.error('highlights feed job threw', {
        event: 'highlights.job_threw',
        error: error.message,
      });
    });
    this.failures.watch(this.worker, HIGHLIGHT_FEED_QUEUE);
    await this.queue.upsertJobScheduler(
      HIGHLIGHT_FEED_JOB,
      { pattern: HIGHLIGHT_FEED_SCHEDULE, tz: 'UTC' },
      { name: HIGHLIGHT_FEED_JOB, opts: { removeOnComplete: 50, removeOnFail: 50 } },
    );
    this.log.log('highlights feed schedule on', {
      event: 'highlights.schedule_on',
      daily_budget: this.config.dailyBudget,
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    this.worker = null;
    this.queue = null;
  }
}
