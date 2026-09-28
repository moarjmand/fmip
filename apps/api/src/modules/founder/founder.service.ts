import { Inject, Injectable, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import type {
  FounderAnalysesResponse,
  FounderAnalysisResponse,
  FounderAnalysisVersion,
} from '@fmip/contracts';
import { PG_POOL } from '../../database/database.module';
import { NotificationsService } from '../notifications/notifications.service';
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
  private readonly log = new Logger(FounderAnalysisService.name);

  constructor(
    @Inject(PG_POOL) pool: Pool,
    private readonly notifications: NotificationsService,
  ) {
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
    let version: FounderAnalysisVersion;
    try {
      version = await this.store.publish(input);
    } catch (error: unknown) {
      if ((error as { code?: string }).code === ANALYSIS_LOCKED) return { kind: 'locked' };
      throw error;
    }
    // The first version only: a revision is the same analysis (T-833).
    if (version.version_number === 1) await this.tellFollowers(input.fixtureId, input.authorId);
    return { kind: 'published', version };
  }

  /**
   * "The founder published an analysis of a match you follow" (T-833,
   * D-100), to everyone following either team or the competition, once per
   * match however often it is revised. Sourceless: it is the platform's
   * editorial, not one member reaching another. Never fails the
   * publication, which is already committed.
   */
  private async tellFollowers(fixtureId: string, authorId: string): Promise<void> {
    try {
      const followers = await this.store.followers(fixtureId, authorId);
      await this.notifications.emitMany(
        followers.map((userId) => ({
          userId,
          kind: 'founder_analysis_published' as const,
          subjectType: 'fixture' as const,
          subjectId: fixtureId,
          dedupeKey: `founder_analysis:${fixtureId}`,
        })),
      );
    } catch (error) {
      this.log.error(
        `founder_analysis.notify_failed fixture=${fixtureId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
