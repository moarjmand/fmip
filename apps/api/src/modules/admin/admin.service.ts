import { Injectable } from '@nestjs/common';
import type {
  AdminOverview,
  AdminUser,
  AuditRecord,
  CoverageState,
  RatingConfig,
} from '@fmip/contracts';
import { IngestRunsService } from '../ingestion/ingestion.service';
import {
  RatingThresholdsService,
  type RatingThresholds,
} from '../rating-thresholds/rating-thresholds.service';
import {
  LEADERBOARD_RULES_V1,
  POINTS_RULES_V1,
  RATING_FORMULA_V1,
  eligibilityRulesUnder,
  formulaUnder,
} from '../reputation/reputation.service';
import { PostgresAdminStore } from './internal/admin-store';

export const USER_SEARCH_LIMIT = 20;
export const AUDIT_LIMIT = 50;

/**
 * The administration area (blueprint 16, T-070, D-046): reads across the
 * platform for an operator, and the two high-impact writes Phase 1 has —
 * an account's status and a season's declared coverage — each in one
 * transaction with its audit record (rule 10). The rating configuration is
 * shown by version and value; changing it is a versioned code change
 * (D-035, D-036), which is what keeps every stored rating explainable.
 */
@Injectable()
export class AdminService {
  constructor(
    private readonly store: PostgresAdminStore,
    private readonly ingestRuns: IngestRunsService,
    private readonly thresholds: RatingThresholdsService,
  ) {}

  async overview(): Promise<AdminOverview> {
    const [coverage, freshness, ingestion, thresholds] = await Promise.all([
      this.store.coverage(),
      this.store.freshness(),
      this.ingestRuns.ingestionHealth(new Date()),
      this.thresholds.inForce(),
    ]);
    return {
      checked_at: new Date().toISOString(),
      coverage,
      freshness,
      ingestion,
      rating: ratingConfig(thresholds),
    };
  }

  searchUsers(query: string): Promise<AdminUser[]> {
    return this.store.searchUsers(query, USER_SEARCH_LIMIT);
  }

  setUserStatus(
    actorId: string,
    userId: string,
    status: 'active' | 'suspended',
    reason: string,
  ): Promise<{ previous: string; next: string; auditId: string } | null> {
    return this.store.setUserStatus(userId, status, { actorId, reason });
  }

  setCoverage(
    actorId: string,
    seasonId: string,
    module: string,
    next: { state: CoverageState; provider: string | null; note: string | null },
    reason: string,
  ): Promise<{ auditId: string } | null> {
    return this.store.setCoverage(seasonId, module, next, { actorId, reason });
  }

  /** Newest first; with `memberId`, only the rows whose target is that account (T-1164). */
  audit(limit = AUDIT_LIMIT, memberId: string | null = null): Promise<AuditRecord[]> {
    return this.store.audit(limit, memberId);
  }
}

/** The rule objects in force, as the admin page shows them, under the threshold version in force. */
export function ratingConfig(thresholds: RatingThresholds): RatingConfig {
  return {
    formula: { ...formulaUnder(RATING_FORMULA_V1, thresholds) },
    points: { ...POINTS_RULES_V1 },
    eligibility: { ...eligibilityRulesUnder(thresholds) },
    leaderboard: { ...LEADERBOARD_RULES_V1 },
    thresholds: {
      version: thresholds.version,
      provisional_below: thresholds.provisionalBelow,
      established_at: thresholds.establishedAt,
      contributor_min_rating: thresholds.contributorMinRating,
      contributor_min_settled: thresholds.contributorMinSettled,
      conduct_window_days: thresholds.conductWindowDays,
      flag_period_days: thresholds.flagPeriodDays,
    },
  };
}
