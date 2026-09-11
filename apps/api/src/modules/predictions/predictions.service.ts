import { Injectable } from '@nestjs/common';
import type { Prediction } from '@fmip/contracts';
import { PostgresPredictionStore } from './internal/prediction-store';
import { validateSubmission } from './internal/validation';

// The module's public surface. Other modules import from this file only.
export { validateSubmission, type PredictionInput, type Validated } from './internal/validation';

export interface Submitter {
  id: string;
  emailVerified: boolean;
}

export type SubmitOutcome =
  | { kind: 'submitted'; prediction: Prediction }
  | { kind: 'unknown_fixture' }
  | { kind: 'invalid'; fields: Record<string, string> }
  | { kind: 'email_unverified' }
  | { kind: 'locked'; locksAt: string };

/**
 * The predictions boundary (T-050): a member's stance on a fixture as a
 * series of immutable versions. Blueprint 6.6: only verified members
 * submit; predictions lock at kick-off (the database-level lock and the
 * clock-skew proof are T-051); the final version, its time and its
 * settlement (T-052) remain visible.
 */
@Injectable()
export class PredictionsService {
  /** Replaceable so the lock can be tested at a chosen instant (T-051). */
  clock: () => Date = () => new Date();

  constructor(private readonly store: PostgresPredictionStore) {}

  async submit(who: Submitter, fixtureId: string, body: unknown): Promise<SubmitOutcome> {
    if (!who.emailVerified) return { kind: 'email_unverified' };
    const fixture = await this.store.fixtureLock(fixtureId);
    if (fixture === null) return { kind: 'unknown_fixture' };
    if (fixture.kickoffAt.getTime() <= this.clock().getTime()) {
      return { kind: 'locked', locksAt: fixture.kickoffAt.toISOString() };
    }
    const validated = validateSubmission(body);
    if (!validated.ok) return { kind: 'invalid', fields: validated.fields };
    const prediction = await this.store.submit(who.id, fixtureId, validated.value);
    return { kind: 'submitted', prediction };
  }

  own(userId: string, fixtureId: string): Promise<Prediction | null> {
    return this.store.find(userId, fixtureId);
  }
}
