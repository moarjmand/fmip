import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import {
  type CommunityConsensusResponse,
  MIN_CONSENSUS_SAMPLE,
  type CoverageState,
} from '@fmip/contracts';
import { PG_POOL } from '../../database/database.module';
import { ConsensusStore } from './internal/consensus-store';
import { crowd, weighted } from './internal/distribution';

/**
 * The community consensus boundary (blueprint 6.6, T-134).
 *
 * The third of the three prediction products, and the one that had a guard
 * before it had an implementation: `three-products.spec.ts` has been protecting
 * the consensus payload from being blended with the model since T-133, while
 * no endpoint produced one. This is that endpoint.
 *
 * It knows nothing about forecasts or founder analyses, and the page that shows
 * all three asks three services (rule 6).
 */
@Injectable()
export class ConsensusService {
  private readonly store: ConsensusStore;

  constructor(@Inject(PG_POOL) pool: Pool) {
    this.store = new ConsensusStore(pool);
  }

  /**
   * The consensus on a fixture, or `null` when there is no such fixture.
   *
   * **What the coverage states mean here**, because this is where rule 3 does
   * the work:
   *
   * * `not_supplied` — fewer than `MIN_CONSENSUS_SAMPLE` members have
   *   predicted. There is no consensus yet, and a percentage over three people
   *   would read as a finding while being one vote. It also keeps a very small
   *   group from becoming a way to read an individual's prediction they chose
   *   not to publish (T-056).
   * * `limited` — a crowd distribution, but no established rater among them, so
   *   blueprint 6.6's second distribution is genuinely absent rather than
   *   faked.
   * * `available` — both distributions.
   *
   * `last_updated_at` is the newest submission counted, not the time this ran:
   * a consensus nobody has added to in two days has not been updated in two
   * days, and rule 4 is about what the reader is actually looking at.
   */
  async forFixture(fixtureId: string): Promise<CommunityConsensusResponse | null> {
    if (!(await this.store.fixtureExists(fixtureId))) return null;

    const { votes, lastSubmittedAt } = await this.store.standing(fixtureId);
    const lastUpdatedAt = lastSubmittedAt === null ? null : lastSubmittedAt.toISOString();

    if (votes.length < MIN_CONSENSUS_SAMPLE) {
      return { coverage: 'not_supplied', last_updated_at: lastUpdatedAt, data: null };
    }

    const byRating = weighted(votes);
    const coverage: CoverageState = byRating === null ? 'limited' : 'available';

    return {
      coverage,
      last_updated_at: lastUpdatedAt,
      data: {
        fixture_id: fixtureId,
        sample: votes.length,
        crowd: crowd(votes),
        weighted: byRating,
        // Non-null: a sample this size has at least one submission behind it.
        last_submitted_at: lastUpdatedAt ?? new Date(0).toISOString(),
        computed_at: new Date().toISOString(),
      },
    };
  }
}
