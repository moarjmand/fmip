import { Injectable } from '@nestjs/common';
import type { CareerPoints } from '@fmip/contracts';
import { IdentityService } from '../identity/identity.service';
import { SettlementService } from '../predictions/predictions.service';
import { POINTS_RULES_V1, type PointsRules, awardsFor, currentStreak } from './internal/points';
import { PostgresPointsStore } from './internal/points-store';

/** How many ledger lines a member sees at once. */
export const RECENT_AWARDS = 20;

/**
 * Career Points (T-054): a ledger rebuilt from settlements under a versioned
 * rule set. Awarding is idempotent — the ledger holds one row per settlement
 * and reason — so the same pass can run after every settlement, and a member
 * can ask for it. Points never feed the rating or eligibility.
 */
@Injectable()
export class CareerPointsService {
  rules: PointsRules = POINTS_RULES_V1;

  constructor(
    private readonly store: PostgresPointsStore,
    private readonly settlements: SettlementService,
    private readonly identity: IdentityService,
  ) {}

  /** Writes every award the member's settlements have earned and are not yet in the ledger. */
  async award(userId: string): Promise<{ added: number }> {
    const history = await this.settlements.settledHistory(userId);
    const awards = awardsFor(
      history.map((h) => ({
        settlementId: h.settlementId,
        settledAt: h.settledAt,
        correct: h.outcomeCorrect,
        scoreCorrect: h.scoreCorrect,
      })),
      this.rules,
    );
    const added = await this.store.award(userId, awards, this.rules.version);
    return { added };
  }

  async summary(userId: string): Promise<CareerPoints | null> {
    const user = await this.identity.userById(userId);
    if (user === null) return null;
    const history = await this.settlements.settledHistory(userId);
    const [total, recent] = await Promise.all([
      this.store.total(userId),
      this.store.recent(userId, RECENT_AWARDS),
    ]);
    return {
      username: user.username,
      total,
      settled_predictions: history.length,
      correct_outcomes: history.filter((h) => h.outcomeCorrect).length,
      exact_scores: history.filter((h) => h.scoreCorrect === true).length,
      current_streak: currentStreak(
        history.map((h) => ({
          settlementId: h.settlementId,
          settledAt: h.settledAt,
          correct: h.outcomeCorrect,
          scoreCorrect: h.scoreCorrect,
        })),
      ),
      rules_version: this.rules.version,
      recent,
    };
  }
}
