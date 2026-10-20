import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import type { BoxScoreFeedHealth, BoxScoreFeedRun } from '@fmip/contracts';
import {
  type BoxScoreMatch,
  type HighlightlyBoxScores,
  type NormalisedBoxScore,
  createHighlightlyBoxScores,
} from '@fmip/ingestion';
import { Queue, Worker } from 'bullmq';
import { FailureCountsService } from '../failure-counts/failure-counts.service';
import { EntityResolverService } from '../ingestion/ingestion.service';
import { HighlightFeedService } from './highlight-feed.service';
import { HighlightlyQuota } from './highlightly-quota.service';
import {
  BOX_SCORE_BATCH,
  type BoxScoreCandidate,
  type PlayerPlacement,
  REASK_AFTER_HOURS,
  boxScoreRows,
} from './internal/box-score-feed';
import { PostgresBoxScoreStore } from './internal/box-score-store';
import {
  FEED_WINDOW_HOURS,
  type FeedConfig,
  type FeedQuestion,
  HIGHLIGHT_FEED_CONFIG,
  KICKOFF_TOLERANCE_MS,
  feedQuestions,
  placeOnFixture,
} from './internal/highlight-feed';

export const BOX_SCORE_QUEUE = 'box-score-feed';
export const BOX_SCORE_JOB = 'box-score-feed-run';
/** Every two hours, twenty minutes after the highlights feed, so the two never ask at once. */
export const BOX_SCORE_SCHEDULE = '49 */2 * * *';

const HOUR_MS = 60 * 60 * 1000;

/**
 * Per-player expected goals from Highlightly's box score (T-1432, D-224):
 * for each finished match of a competition mapped to Highlightly, inside the
 * highlights feed's 51-hour window, find the source's match on its list for
 * the league and day (placed through `provider_mapping`, never a name), ask
 * once for its box score, place each player through `provider_mapping`, and
 * keep the expected-goals figures as a source of their own
 * (`fixture_player_expected`), never blended with API-Football's numbers.
 *
 * A player the source names that we have not mapped is queued for review
 * (`unresolved_entity`, with the match's line-up shirt beside it as a hint)
 * and counted; a box score with players still unplaced is asked for again
 * after `REASK_AFTER_HOURS` inside the window.
 *
 * Off without `HIGHLIGHTLY_KEY`; scheduled only where `INGESTION_SCHEDULE=on`.
 * Draws on the daily ceiling it shares with the highlights feed
 * (`HighlightlyQuota`, `HIGHLIGHTS_DAILY_BUDGET`), at most `BOX_SCORE_BATCH`
 * box scores a run. Highlightly's terms let us show the data in our product
 * and forbid gambling use (D-224).
 */
@Injectable()
export class BoxScoreFeedService implements OnModuleInit, OnApplicationShutdown {
  private readonly log = new Logger('BoxScoreFeed');
  private readonly client: HighlightlyBoxScores | null;
  private queue: Queue | null = null;
  private worker: Worker | null = null;
  private last: BoxScoreFeedRun | null = null;

  constructor(
    @Inject(HIGHLIGHT_FEED_CONFIG) private readonly config: FeedConfig,
    @Inject(BOX_SCORE_BATCH) private readonly batch: number,
    private readonly quota: HighlightlyQuota,
    private readonly store: PostgresBoxScoreStore,
    private readonly resolver: EntityResolverService,
    private readonly failures: FailureCountsService,
  ) {
    this.client =
      config.state === 'configured' && quota.transport !== null
        ? createHighlightlyBoxScores(quota.transport, config.apiKey)
        : null;
  }

  health(): BoxScoreFeedHealth {
    const reading = this.quota.reading();
    return {
      feed: this.config.state,
      scheduled: this.config.state === 'configured' && HighlightFeedService.scheduled(),
      batch: this.config.state === 'configured' ? this.batch : null,
      daily_budget: reading.configured ? reading.budget : null,
      requests_today: reading.configured ? reading.requestsToday : null,
      last_run: this.last,
    };
  }

  /** One run; null when the job is off. */
  async run(now: Date = new Date()): Promise<BoxScoreFeedRun | null> {
    if (this.client === null) return null;
    const started = new Date();
    const candidates = await this.store.candidates(
      now,
      FEED_WINDOW_HOURS,
      new Date(now.getTime() - REASK_AFTER_HOURS * HOUR_MS),
    );
    const { questions, unmappedCompetitions } = feedQuestions(candidates);
    const summary: BoxScoreFeedRun = {
      started_at: started.toISOString(),
      finished_at: started.toISOString(),
      waiting: candidates.filter((c) => !c.held).length,
      unmapped_competitions: unmappedCompetitions.size,
      questions: 0,
      asked: 0,
      stored: 0,
      not_ready: 0,
      unmatched: { team_unmapped: 0, no_fixture: 0, ambiguous: 0 },
      players_unresolved: 0,
      requests: 0,
      stopped: null,
    };
    for (const competitionId of unmappedCompetitions) {
      this.log.log('competition not mapped to Highlightly: no box scores', {
        event: 'box_score.competition_unmapped',
        competition_id: competitionId,
      });
    }
    for (const question of questions) {
      summary.questions += 1;
      const outcome = await this.ask(this.client, question, summary);
      if (outcome !== 'done') {
        summary.stopped = outcome;
        break;
      }
    }
    summary.finished_at = new Date().toISOString();
    this.last = summary;
    this.log.log('box scores ran', { event: 'box_score.ran', ...summary });
    return summary;
  }

  private async ask(
    client: HighlightlyBoxScores,
    question: FeedQuestion<BoxScoreCandidate>,
    summary: BoxScoreFeedRun,
  ): Promise<'done' | 'quota' | 'batch'> {
    const listed = await client.matches({
      date: question.date,
      leagueExternalId: question.leagueExternalId,
    });
    summary.requests += listed.requests;
    if (!listed.ok) {
      this.log.warn('box-score match list refused', {
        event: 'box_score.list_failed',
        competition_id: question.competitionId,
        date: question.date,
        kind: listed.error.kind,
        message: listed.error.message,
      });
      return listed.error.kind === 'quota' ? 'quota' : 'done';
    }
    const teams = await this.teams(listed.data, question.competitionId);
    const placed = new Map<string, BoxScoreMatch[]>();
    const unmappedAt: number[] = [];
    for (const match of listed.data) {
      const fit = placeOnFixture(
        teams.get(match.home.externalId) ?? null,
        teams.get(match.away.externalId) ?? null,
        match.kickoffAt,
        question.candidates,
      );
      if ('candidate' in fit) {
        placed.set(fit.candidate.fixtureId, [
          ...(placed.get(fit.candidate.fixtureId) ?? []),
          match,
        ]);
      } else if (fit.reason === 'team_unmapped') {
        unmappedAt.push(Date.parse(match.kickoffAt));
      }
    }
    for (const candidate of question.candidates) {
      if (candidate.held) continue;
      const matches = placed.get(candidate.fixtureId) ?? [];
      if (matches.length !== 1) {
        const reason =
          matches.length > 1
            ? 'ambiguous'
            : unmappedAt.some(
                  (at) => Math.abs(at - candidate.kickoffAt.getTime()) <= KICKOFF_TOLERANCE_MS,
                )
              ? 'team_unmapped'
              : 'no_fixture';
        summary.unmatched[reason] += 1;
        this.log.log('match not found on the box-score source', {
          event: 'box_score.unmatched',
          reason,
          fixture_id: candidate.fixtureId,
          competition_id: question.competitionId,
          date: question.date,
        });
        continue;
      }
      const match = matches[0]!;
      if (!match.finished) {
        summary.not_ready += 1;
        continue;
      }
      if (summary.asked >= this.batch) return 'batch';
      summary.asked += 1;
      const answered = await client.boxScore(match.externalId);
      summary.requests += answered.requests;
      if (!answered.ok) {
        this.log.warn('box score refused', {
          event: 'box_score.failed',
          fixture_id: candidate.fixtureId,
          kind: answered.error.kind,
          message: answered.error.message,
        });
        if (answered.error.kind === 'quota') return 'quota';
        continue;
      }
      await this.keep(
        candidate,
        question.competitionId,
        answered.data,
        answered.fetchedAt,
        teams,
        summary,
      );
    }
    return 'done';
  }

  /** Places the players and stores the figures; a box score with nobody in it is asked for again later. */
  private async keep(
    candidate: BoxScoreCandidate,
    competitionId: string,
    score: NormalisedBoxScore,
    fetchedAt: string,
    teams: ReadonlyMap<string, string | null>,
    summary: BoxScoreFeedRun,
  ): Promise<void> {
    const listed = score.sides.reduce((sum, side) => sum + side.players.length, 0);
    if (listed === 0) {
      summary.not_ready += 1;
      return;
    }
    const people = await this.people(candidate, competitionId, score, teams);
    const decided = boxScoreRows(score, candidate, teams, people);
    if (decided.kind === 'not_ready') {
      summary.not_ready += 1;
      return;
    }
    if (decided.kind === 'side_mismatch') {
      this.log.warn("a box score's side is neither of the match's teams; nothing stored", {
        event: 'box_score.side_mismatch',
        fixture_id: candidate.fixtureId,
        feed_team: decided.teamExternalId,
      });
      return;
    }
    await this.store.store(candidate, { ...decided, fetchedAt });
    summary.stored += 1;
    summary.players_unresolved += decided.unresolved;
  }

  /**
   * The source's player ids -> ours, through the resolver. An unmapped one is
   * queued for review with what a reviewer needs: the name the source gave,
   * our team and match, and the shirt number -- with the person our line-up
   * gives that shirt, as a hint to check, never a mapping (rule 1).
   */
  private async people(
    candidate: BoxScoreCandidate,
    competitionId: string,
    score: NormalisedBoxScore,
    teams: ReadonlyMap<string, string | null>,
  ): Promise<Map<string, PlayerPlacement>> {
    const sides = [candidate.homeParticipantId, candidate.awayParticipantId].filter(
      (id): id is string => id !== null,
    );
    const shirts = await this.store.lineupShirts(sides);
    const people = new Map<string, PlayerPlacement>();
    for (const side of score.sides) {
      const team = teams.get(side.team.externalId) ?? null;
      const participant =
        team === candidate.homeTeamId
          ? candidate.homeParticipantId
          : team === candidate.awayTeamId
            ? candidate.awayParticipantId
            : null;
      for (const player of side.players) {
        if (people.has(player.externalId)) continue;
        const hint =
          player.shirtNumber === null
            ? null
            : (shirts.find(
                (s) => s.participantId === participant && s.shirtNumber === player.shirtNumber,
              )?.personId ?? null);
        const resolution = await this.resolver.resolve(
          { provider: 'highlightly', entityType: 'person', externalId: player.externalId },
          {
            name: player.name,
            seenIn: competitionId,
            fixture: candidate.fixtureId,
            team,
            shirtNumber: player.shirtNumber,
            lineupPerson: hint,
          },
        );
        people.set(
          player.externalId,
          resolution.kind === 'resolved'
            ? { kind: 'resolved', personId: resolution.internalId }
            : { kind: 'unresolved' },
        );
      }
    }
    return people;
  }

  /** The source's team ids -> ours, through the resolver; an unmapped one is queued for the operator. */
  private async teams(
    matches: BoxScoreMatch[],
    competitionId: string,
  ): Promise<Map<string, string | null>> {
    const named = new Map<string, string>();
    for (const match of matches) {
      named.set(match.home.externalId, match.home.name);
      named.set(match.away.externalId, match.away.name);
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
    if (this.config.state === 'absent') return;
    if (!HighlightFeedService.scheduled() || url === undefined || url === '') return;
    const connection = { url, maxRetriesPerRequest: null };
    this.queue = new Queue(BOX_SCORE_QUEUE, { connection });
    this.worker = new Worker(BOX_SCORE_QUEUE, async () => this.run(), {
      connection,
      concurrency: 1,
    });
    this.worker.on('failed', (job, error) => {
      this.log.error('box-score job threw', { event: 'box_score.job_threw', error: error.message });
    });
    this.failures.watch(this.worker, BOX_SCORE_QUEUE);
    await this.queue.upsertJobScheduler(
      BOX_SCORE_JOB,
      { pattern: BOX_SCORE_SCHEDULE, tz: 'UTC' },
      { name: BOX_SCORE_JOB, opts: { removeOnComplete: 50, removeOnFail: 50 } },
    );
    this.log.log('box scores schedule on', { event: 'box_score.schedule_on', batch: this.batch });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    this.worker = null;
    this.queue = null;
  }
}
