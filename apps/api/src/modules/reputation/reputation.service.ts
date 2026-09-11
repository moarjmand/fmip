import { Injectable } from '@nestjs/common';
import type { Rating } from '@fmip/contracts';
import { ForecastService } from '../forecast/forecast.service';
import { IdentityService } from '../identity/identity.service';
import { SettlementService, type SettledRecord } from '../predictions/predictions.service';
import {
  RATING_FORMULA_V1,
  type RatingFormula,
  type RatingInput,
  computeRating,
} from './internal/formula';
import { PostgresRatingStore, type SnapshotRow } from './internal/rating-store';

// The module's public surface. Other modules import from this file only.
export {
  RATING_FORMULA_V1,
  computeRating,
  tierOf,
  type RatingFormula,
  type RatingInput,
} from './internal/formula';

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

  constructor(
    private readonly store: PostgresRatingStore,
    private readonly settlements: SettlementService,
    private readonly forecasts: ForecastService,
    private readonly identity: IdentityService,
  ) {}

  /** The current rating, or null before the first settled prediction. Never computes. */
  async current(userId: string): Promise<Rating | null> {
    const user = await this.identity.userById(userId);
    if (user === null) return null;
    const latest = await this.store.latest(userId);
    return latest === null ? null : toRating(user.username, latest);
  }

  /**
   * Recomputes from stored records (rule 8). A result identical in inputs to
   * the newest snapshot writes nothing; otherwise a snapshot is added.
   */
  async recompute(userId: string): Promise<RecomputeOutcome> {
    const user = await this.identity.userById(userId);
    if (user === null) return { kind: 'unknown_user' };
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
