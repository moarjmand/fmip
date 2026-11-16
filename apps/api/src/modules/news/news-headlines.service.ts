import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../../database/database.module';

/** At most this many headlines a read: enough for any match's 72 hours, bounded all the same. */
export const HEADLINES_LIMIT = 500;

/**
 * Headlines linked by canonical id to some entities (T-1838, D-427 point 5),
 * read only, for another module that must know what is being said about a
 * match before it posts about it: the social posts' sensitive-topic check.
 *
 * Every language's headline of every article linked (`article_entity`, by
 * UUID, never by name) to one of the ids, published or fetched since the
 * given instant, hidden or not: over-reading only sends a post to a person.
 * A failed read throws; the caller counts that as sensitive (fail closed).
 */
@Injectable()
export class NewsHeadlines {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async recent(entityIds: readonly string[], since: Date): Promise<string[]> {
    if (entityIds.length === 0) return [];
    const { rows } = await this.pool.query<{ headline: string }>(
      `SELECT v.headline
         FROM article_entity e
         JOIN article a ON a.id = e.article_id
         JOIN article_version v ON v.article_id = a.id
        WHERE e.entity_type IN ('fixture', 'team')
          AND e.entity_id = ANY($1::uuid[])
          AND (v.published_at >= $2 OR a.fetched_at >= $2)
        GROUP BY v.headline
        ORDER BY max(v.published_at) DESC
        LIMIT ${HEADLINES_LIMIT}`,
      [[...entityIds], since.toISOString()],
    );
    return rows.map((r) => r.headline);
  }
}
