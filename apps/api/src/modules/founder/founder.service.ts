import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import type {
  FounderAnalysesResponse,
  FounderAnalysisResponse,
  FounderAnalysisVersion,
} from '@fmip/contracts';
import { PG_POOL } from '../../database/database.module';
import { FounderStore, type NewVersion } from './internal/founder-store';

// The module's public surface. Other modules import from this file only.
export type { NewVersion } from './internal/founder-store';

/** The database's kick-off lock for an analysis (T-130). */
export const ANALYSIS_LOCKED = 'PL002';

export type PublishOutcome =
  | { kind: 'published'; version: FounderAnalysisVersion }
  | { kind: 'unknown_fixture' }
  /** The match has started; the database refused, by its own clock. */
  | { kind: 'locked' };

/**
 * The founder's analysis boundary (blueprint 6.5, T-131).
 *
 * One of three prediction products, and it never meets the other two here: this
 * service knows nothing about forecasts or member predictions, and the page
 * that shows all three gets them from three places (rule 6, guarded by
 * `three-products.spec.ts`).
 *
 * Publishing is thin on purpose. The rules that matter — versions rather than
 * edits, nothing after kick-off, a score that cannot contradict its outcome —
 * are in the schema, where no future caller can route around them. What is left
 * here is translating a refusal into something an endpoint can answer with.
 */
@Injectable()
export class FounderAnalysisService {
  private readonly store: FounderStore;

  constructor(@Inject(PG_POOL) pool: Pool) {
    this.store = new FounderStore(pool);
  }

  /** What the public sees. `analysis` is null for the many matches without one. */
  async forFixture(fixtureId: string): Promise<FounderAnalysisResponse | null> {
    if (!(await this.store.fixtureExists(fixtureId))) return null;
    return { fixture_id: fixtureId, analysis: await this.store.forFixture(fixtureId) };
  }

  /** The feed behind the homepage and the team and competition pages. */
  async feed(options: {
    limit: number;
    teamId?: string;
    competitionId?: string;
  }): Promise<FounderAnalysesResponse> {
    return { analyses: await this.store.feed(options) };
  }

  async publish(input: NewVersion): Promise<PublishOutcome> {
    if (!(await this.store.fixtureExists(input.fixtureId))) return { kind: 'unknown_fixture' };
    try {
      return { kind: 'published', version: await this.store.publish(input) };
    } catch (error: unknown) {
      if ((error as { code?: string }).code === ANALYSIS_LOCKED) return { kind: 'locked' };
      throw error;
    }
  }
}
