import { Injectable } from '@nestjs/common';
import type { RatingThresholdListResponse, RatingThresholdValues } from '@fmip/contracts';
import { PostgresRatingThresholdStore, type SupersedeOutcome } from './internal/threshold-store';
import type { RatingThresholds } from './internal/thresholds';

// The module's public surface. Other modules import from this file only.
export { THRESHOLDS_V1, type RatingThresholds } from './internal/thresholds';
export type { SupersedeOutcome } from './internal/threshold-store';

/**
 * Rating thresholds as versioned rows (T-1160, D-152, D-164): which version is
 * in force, every version, and a new one. The reputation boundary reads
 * `inForce` for every rating, eligibility and flag it computes and records
 * the version it used; what the numbers mean stays there.
 */
@Injectable()
export class RatingThresholdsService {
  constructor(private readonly store: PostgresRatingThresholdStore) {}

  /** The version in force at `at`, or now by the database clock. */
  inForce(at: Date | null = null): Promise<RatingThresholds> {
    return this.store.inForce(at);
  }

  async list(): Promise<RatingThresholdListResponse> {
    const [versions, current] = await Promise.all([this.store.list(), this.store.inForce()]);
    return { generated_at: new Date().toISOString(), in_force: current.version, versions };
  }

  supersede(
    values: RatingThresholdValues,
    effectiveFrom: string | null,
    actorId: string,
    reason: string,
  ): Promise<SupersedeOutcome> {
    return this.store.supersede(values, effectiveFrom, actorId, reason);
  }
}
