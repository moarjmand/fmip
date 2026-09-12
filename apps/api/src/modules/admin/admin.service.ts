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
  ELIGIBILITY_V1,
  LEADERBOARD_RULES_V1,
  POINTS_RULES_V1,
  RATING_FORMULA_V1,
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
  ) {}

  async overview(): Promise<AdminOverview> {
    const [coverage, freshness, ingestion] = await Promise.all([
      this.store.coverage(),
      this.store.freshness(),
      this.ingestRuns.ingestionHealth(new Date()),
    ]);
    return {
      checked_at: new Date().toISOString(),
      coverage,
      freshness,
      ingestion,
      rating: ratingConfig(),
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

  audit(limit = AUDIT_LIMIT): Promise<AuditRecord[]> {
    return this.store.audit(limit);
  }
}

/** The rule objects in force, as the admin page shows them. */
export function ratingConfig(): RatingConfig {
  return {
    formula: { ...RATING_FORMULA_V1 },
    points: { ...POINTS_RULES_V1 },
    eligibility: { ...ELIGIBILITY_V1 },
    leaderboard: { ...LEADERBOARD_RULES_V1 },
  };
}
