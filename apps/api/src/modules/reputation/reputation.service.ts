import { Injectable } from '@nestjs/common';
import type {
  Achievements,
  LeaderboardPeriod,
  LeaderboardResponse,
  Rating,
  RatingHistory,
} from '@fmip/contracts';
import { ForecastService } from '../forecast/forecast.service';
import { IdentityService } from '../identity/identity.service';
import { SettlementService, type SettledRecord } from '../predictions/predictions.service';
import { ProfileService } from '../profile/profile.service';
import { periodBoard, type PeriodBoardRow } from './internal/period-board';
import {
  RATING_FORMULA_V1,
  type RatingFormula,
  type RatingInput,
  computeRating,
  tierOf,
} from './internal/formula';
import { CareerPointsService } from './career-points.service';
import { deriveAchievements } from './internal/achievements';
import { ratingHistory } from './internal/history';
import {
  LEADERBOARD_RULES_V1,
  currentMonth,
  monthBounds,
  type LeaderboardQuery,
  type LeaderboardRules,
  type PeriodQuery,
} from './internal/leaderboard';
import { PostgresRatingStore, type SnapshotRow } from './internal/rating-store';

// The module's public surface. Other modules import from this file only.
export {
  RATING_FORMULA_V1,
  computeRating,
  tierOf,
  type RatingFormula,
  type RatingInput,
} from './internal/formula';
export { CareerPointsService } from './career-points.service';
export { ELIGIBILITY_V1, eligibilityFor, type EligibilityRules } from './internal/eligibility';
export { POINTS_RULES_V1, awardsFor, currentStreak, type PointsRules } from './internal/points';
export {
  LEADERBOARD_RULES_V1,
  parseLeaderboardQuery,
  type LeaderboardQuery,
  type LeaderboardRules,
} from './internal/leaderboard';

export type RecomputeOutcome =
  | { kind: 'unchanged'; rating: Rating }
  | { kind: 'snapshot'; rating: Rating }
  | { kind: 'nothing_settled' }
  | { kind: 'unknown_user' };

/**
 * The reputation boundary (T-053): Performance Rating from settled
 * predictions and the stored forecasts, under a versioned formula. Reads
 * other boundaries only through their public services (settlements from
 * predictions, difficulty from forecast, accounts from identity); writes only
 * its own snapshots, and only when the inputs changed.
 */
@Injectable()
export class ReputationService {
  /** Replaceable so a test can rate under a different version. */
  formula: RatingFormula = RATING_FORMULA_V1;
  leaderboardRules: LeaderboardRules = LEADERBOARD_RULES_V1;

  constructor(
    private readonly store: PostgresRatingStore,
    private readonly settlements: SettlementService,
    private readonly forecasts: ForecastService,
    private readonly identity: IdentityService,
    private readonly points: CareerPointsService,
    private readonly profiles: ProfileService,
  ) {}

  /**
   * The board (blueprint 9.3, T-055): current ratings, ranked, behind the
   * minimum-sample filter. Reads snapshots only, so it is as reproducible as
   * they are; the tier is derived from the rating under the formula.
   *
   * `among` scopes it to a set of members -- a group (T-243), the viewer and
   * their friends (T-641) -- and scopes nothing else: same rules version, same
   * floor, same formula, same tier. There is no second leaderboard here and
   * there is deliberately no second method, because a second method is where
   * a second formula begins.
   *
   * A month or season (T-641) changes only which settlements are rated: each
   * member's rating is `computeRating` over the period's settlements, computed
   * on read and written nowhere (`periodBoard`). Such a board says when a
   * member predicted, so it is drawn only from members whose prediction
   * history `viewerId` may read -- the rule `GET /users/:username/predictions`
   * and the rating history (T-640) follow. The all-time board shows what
   * blueprint 7.2 makes public (username and current rating), as before.
   *
   * A competition (T-843) likewise changes only which settlements are rated:
   * `computeRating` over each member's settlements on that competition's
   * fixtures (within the period, when there is one) -- exactly how the
   * rating history's per-competition figure is computed (T-640) -- behind
   * the same floor counted over those settlements alone (D-037), and under
   * the period boards' privacy rule, since it says where a member predicted.
   */
  async leaderboard(
    query: LeaderboardQuery,
    options: {
      among?: string[] | null;
      viewerId?: string | null;
      scope?: LeaderboardResponse['scope'];
      now?: Date;
    } = {},
  ): Promise<LeaderboardResponse> {
    const among = options.among ?? null;
    const now = options.now ?? new Date();
    const generatedAt = now.toISOString();
    const [available, competitions, competitionName] = await Promise.all([
      this.settlements.settledPeriods(PERIOD_CHOICES),
      this.settlements.settledCompetitions(COMPETITION_CHOICES),
      query.competition === null
        ? Promise.resolve(null)
        : this.settlements.competitionName(query.competition),
    ]);
    const period = resolvePeriod(query.period, available, now);
    const competition =
      query.competition === null ? null : { id: query.competition, name: competitionName ?? '' };

    let total: number;
    let entries: LeaderboardResponse['entries'];
    if (period.kind === 'all' && competition === null) {
      const page = await this.store.board(query.minSettled, query.limit, query.offset, among);
      total = page.total;
      entries = page.rows.map((r) => ({
        rank: r.rank,
        username: r.username,
        rating: r.rating,
        tier: tierOf(r.rating, this.formula),
        settled_count: r.settledCount,
        provisional: r.provisional,
        established: r.established,
        formula_version: r.formulaVersion,
        computed_at: r.computedAt,
      }));
    } else {
      const rows = await this.computedRows(
        period,
        competition?.id ?? null,
        among,
        options.viewerId ?? null,
        query,
      );
      total = rows.length;
      entries = rows.slice(query.offset, query.offset + query.limit).map((r) => ({
        rank: r.rank,
        username: r.username,
        rating: r.result.rating,
        tier: tierOf(r.result.rating, this.formula),
        settled_count: r.result.settledCount,
        provisional: r.result.provisional,
        established: r.result.established,
        formula_version: this.formula.version,
        computed_at: generatedAt,
      }));
    }

    return {
      scope: options.scope ?? query.scope,
      period,
      available_periods: available,
      competition,
      available_competitions: competitions,
      rules_version: this.leaderboardRules.version,
      min_settled: query.minSettled,
      floor: this.leaderboardRules.floor,
      presets: [...this.leaderboardRules.presets],
      total,
      limit: query.limit,
      offset: query.offset,
      generated_at: generatedAt,
      entries,
    };
  }

  /** Whether a competition exists, for the board's 404 (T-843). */
  async competitionExists(id: string): Promise<boolean> {
    return (await this.settlements.competitionName(id)) !== null;
  }

  /**
   * Every ranked row of a board computed on read -- a month, a season, a
   * competition, or a competition within a period -- before paging.
   */
  private async computedRows(
    period: LeaderboardPeriod,
    competitionId: string | null,
    among: string[] | null,
    viewerId: string | null,
    query: LeaderboardQuery,
  ): Promise<PeriodBoardRow[]> {
    if (period.kind === 'season' && period.label === null) return [];
    const inCompetition = competitionId === null ? {} : { competitionId };
    const records = await this.settlements.settledInPeriod(
      period.kind === 'month'
        ? { among, from: period.from, to: period.to, ...inCompetition }
        : period.kind === 'season'
          ? { among, seasonLabel: period.label ?? '', ...inCompetition }
          : { among, ...inCompetition },
    );
    if (records.length === 0) return [];
    const members = await this.profiles.predictionHistoryAudience(
      [...new Set(records.map((r) => r.userId))],
      viewerId,
    );
    const inputs = await this.withDifficulty(records);
    // `withDifficulty` keeps the records' order, so the zip is by position.
    return periodBoard(
      records.map((record, i) => ({ ...inputs[i]!, userId: record.userId })),
      members,
      query.minSettled,
      this.formula,
    );
  }

  /** The current rating, or null before the first settled prediction. Never computes. */
  async current(userId: string): Promise<Rating | null> {
    const user = await this.identity.userById(userId);
    if (user === null) return null;
    const latest = await this.store.latest(userId);
    return latest === null ? null : toRating(user.username, latest);
  }

  /**
   * The rating over time, by competition, and the highest (blueprint 9.3,
   * T-640), recomputed from the same stored settlements and forecasts a
   * recompute reads, through the same formula; nothing is written. Null
   * before the first settled prediction.
   */
  async history(userId: string): Promise<RatingHistory | null> {
    const records = await this.settlements.settledHistory(userId);
    const inputs = await this.withDifficulty(records);
    // `withDifficulty` keeps the records' order, so the zip is by position.
    return ratingHistory(
      records.map((record, i) => ({ ...inputs[i]!, competition: record.competition })),
      new Date().toISOString(),
      this.formula,
    );
  }

  /**
   * The member's achievements (T-643, D-091), derived on read from their
   * stored settlements and predictions and written nowhere. Read by the
   * profile only: nothing here feeds the rating, a board or eligibility.
   */
  async achievements(userId: string): Promise<Achievements> {
    const facts = await this.settlements.achievementFacts(userId);
    return deriveAchievements(
      {
        settlements: facts.settlements.map((r) => ({
          settlementId: r.settlementId,
          fixtureId: r.fixtureId,
          settledAt: r.settledAt,
          outcomeCorrect: r.outcomeCorrect,
          scoreCorrect: r.scoreCorrect,
        })),
        predictions: facts.predictions,
        rounds: facts.rounds,
      },
      new Date().toISOString(),
    );
  }

  /**
   * Recomputes from stored records (rule 8). A result identical in inputs to
   * the newest snapshot writes nothing; otherwise a snapshot is added.
   */
  async recompute(userId: string): Promise<RecomputeOutcome> {
    const user = await this.identity.userById(userId);
    if (user === null) return { kind: 'unknown_user' };
    // Points ride along: the same settlements feed both, and the ledger is idempotent.
    await this.points.award(userId);
    const history = await this.settlements.settledHistory(userId);
    const inputs = await this.withDifficulty(history);
    const result = computeRating(inputs, this.formula);
    if (result === null) return { kind: 'nothing_settled' };

    const latest = await this.store.latest(userId);
    if (latest !== null && latest.inputsHash === result.inputsHash) {
      return { kind: 'unchanged', rating: toRating(user.username, latest) };
    }
    const snapshot = await this.store.insert({
      userId,
      formulaVersion: this.formula.version,
      settledCount: result.settledCount,
      rating: result.rating,
      components: result.components,
      provisional: result.provisional,
      established: result.established,
      inputsHash: result.inputsHash,
    });
    return { kind: 'snapshot', rating: toRating(user.username, snapshot) };
  }

  /** After a fixture settles: every member with a prediction on it. */
  async recomputeForFixture(fixtureId: string): Promise<{ users: number; snapshots: number }> {
    let snapshots = 0;
    const users = await this.settlements.predictors(fixtureId);
    for (const userId of users) {
      if ((await this.recompute(userId)).kind === 'snapshot') snapshots += 1;
    }
    return { users: users.length, snapshots };
  }

  /** The job's pass: everyone settled recently; unchanged inputs write nothing. */
  async recomputeDue(): Promise<{ users: number; snapshots: number }> {
    let snapshots = 0;
    const users = await this.settlements.recentlySettledUsers(500);
    for (const userId of users) {
      if ((await this.recompute(userId)).kind === 'snapshot') snapshots += 1;
    }
    return { users: users.length, snapshots };
  }

  /**
   * Difficulty per record: the model's latest available forecast computed
   * before kick-off gives the probability of the outcome that happened. One
   * lookup per fixture; null when the model never said anything in time.
   */
  private async withDifficulty(history: SettledRecord[]): Promise<RatingInput[]> {
    const byFixture = new Map<string, Promise<Map<'home' | 'draw' | 'away', number> | null>>();
    const probabilitiesFor = (fixtureId: string, kickoffAt: string) => {
      let pending = byFixture.get(fixtureId);
      if (pending === undefined) {
        pending = this.forecasts.versions(fixtureId).then((response) => {
          const version = response?.versions
            .filter((v) => v.probabilities !== null && v.computed_at < kickoffAt)
            .at(-1);
          if (version === undefined || version.probabilities === null) return null;
          return new Map<'home' | 'draw' | 'away', number>([
            ['home', version.probabilities.home],
            ['draw', version.probabilities.draw],
            ['away', version.probabilities.away],
          ]);
        });
        byFixture.set(fixtureId, pending);
      }
      return pending;
    };
    const inputs: RatingInput[] = [];
    for (const record of history) {
      const probabilities = await probabilitiesFor(record.fixtureId, record.kickoffAt);
      inputs.push({
        settlementId: record.settlementId,
        settledAt: record.settledAt,
        correct: record.outcomeCorrect,
        scorePredicted: record.scorePredicted,
        scoreCorrect: record.scoreCorrect,
        confidence: record.confidence,
        difficulty: probabilities?.get(record.actualOutcome) ?? null,
      });
    }
    return inputs;
  }
}

/** How many months and seasons the pickers offer. */
const PERIOD_CHOICES = 36;

/** How many competitions the competition picker offers (T-843). */
const COMPETITION_CHOICES = 50;

/**
 * The period a board ranks, with its defaults filled in: the current UTC month,
 * or the newest season with a settled prediction (null when there is none).
 *
 * **What a season is (T-641).** A fixture belongs to exactly one `season` row,
 * and a season row belongs to one competition; the label (`2025/26`, or
 * `2026` for a calendar-year league) is the name every competition's edition
 * of that season shares. A season board is therefore the settlements on
 * fixtures whose season carries the label, in every competition -- the same
 * way the backfill reads "a season by its label" (T-512) -- rather than a
 * date range, because competitions' seasons do not start or end together and
 * a range would cut one of them in half.
 */
export function resolvePeriod(
  period: PeriodQuery,
  available: { seasons: string[] },
  now: Date,
): LeaderboardPeriod {
  switch (period.kind) {
    case 'all':
      return { kind: 'all' };
    case 'month': {
      const month = period.month ?? currentMonth(now);
      return { kind: 'month', month, ...monthBounds(month) };
    }
    case 'season':
      return { kind: 'season', label: period.label ?? available.seasons[0] ?? null };
  }
}

function toRating(username: string, snapshot: SnapshotRow): Rating {
  return {
    username,
    rating: snapshot.rating,
    tier: tierOfRating(snapshot.rating),
    provisional: snapshot.provisional,
    established: snapshot.established,
    settled_count: snapshot.settledCount,
    components: snapshot.components,
    formula_version: snapshot.formulaVersion,
    computed_at: snapshot.computedAt,
  };
}

function tierOfRating(rating: number): Rating['tier'] {
  const t = RATING_FORMULA_V1.tiers;
  return rating < t.bronze
    ? 'bronze'
    : rating < t.silver
      ? 'silver'
      : rating < t.gold
        ? 'gold'
        : rating < t.platinum
          ? 'platinum'
          : 'elite';
}
