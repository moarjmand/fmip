import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../../../database/database.module';
import type { NewsRights } from './news-store';

/** The GNews row the migration seeds (T-1367, `1765844000000_gnews-source.sql`). */
export const GNEWS_SOURCE_ID = '00000000-0000-4000-8000-000000001367';

/** The words a run refused by the daily ceiling carries; such a run sent nothing. */
export const BUDGET_SPENT = 'daily request budget';

/** The aggregator's own row: what its publishers inherit, and whether it is still carried. */
export interface AggregatorRow {
  id: string;
  name: string;
  rights: NewsRights;
  language: string;
  same_language_only: boolean;
  dropped: boolean;
}

/** A publisher's row under the aggregator. */
export interface PublisherRow {
  id: string;
  rights: NewsRights;
  language: string;
  dropped: boolean;
}

/** `lower(host)` without `www.`, of a URL column, in SQL (mirrors `siteHost`). */
const HOST_OF = (column: string): string =>
  `lower(regexp_replace(substring(${column} from '^[a-zA-Z][a-zA-Z0-9+.-]*://([^/:?#]+)'), '^www\\.', ''))`;

/** LIKE's own characters escaped, so a URL fragment matches only itself. */
function likeLiteral(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * The SQL of the GNews job (T-1367, D-185): the aggregator row, its
 * publishers, the day's request count and the URLs other sources already
 * carry. Everything else is written through `PostgresNewsStore` exactly as a
 * feed's items are.
 */
@Injectable()
export class PostgresGNewsStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async aggregator(id: string): Promise<AggregatorRow | null> {
    const { rows } = await this.pool.query<AggregatorRow>(
      `SELECT id, name, rights, language, same_language_only, dropped_at IS NOT NULL AS dropped
         FROM news_source WHERE id = $1 AND kind = 'licensed'`,
      [id],
    );
    return rows[0] ?? null;
  }

  /**
   * The publisher's row under the aggregator, created the first time it is
   * named with the aggregator's rights, language and language setting. An
   * existing row is returned as it is -- its name, rights and setting are the
   * console's from then on, and a dropped one stays dropped.
   */
  async publisher(
    aggregator: AggregatorRow,
    name: string,
    homepage: string,
  ): Promise<PublisherRow> {
    await this.pool.query(
      `INSERT INTO news_source
         (name, homepage_url, feed_url, kind, rights, language, same_language_only, via_source_id)
       VALUES ($1, $2, NULL, 'licensed', $3, $4, $5, $6)
       ON CONFLICT (via_source_id, homepage_url) WHERE via_source_id IS NOT NULL DO NOTHING`,
      [
        name,
        homepage,
        aggregator.rights,
        aggregator.language,
        aggregator.same_language_only,
        aggregator.id,
      ],
    );
    const { rows } = await this.pool.query<PublisherRow>(
      `SELECT id, rights, language, dropped_at IS NOT NULL AS dropped
         FROM news_source WHERE via_source_id = $1 AND homepage_url = $2`,
      [aggregator.id, homepage],
    );
    return rows[0]!;
  }

  /**
   * Whether a source read some other way, on this host, has been dropped: a
   * publisher who asked to be dropped is not brought back through an
   * aggregator (D-061).
   */
  async hostDropped(host: string, aggregatorId: string): Promise<boolean> {
    const { rows } = await this.pool.query<{ dropped: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM news_source
          WHERE dropped_at IS NOT NULL
            AND via_source_id IS DISTINCT FROM $2
            AND (${HOST_OF('homepage_url')} = $1 OR ${HOST_OF('feed_url')} = $1)
       ) AS dropped`,
      [host, aggregatorId],
    );
    return rows[0]!.dropped;
  }

  /**
   * Requests sent today (UTC) through the aggregator: its runs, less the one
   * open now and those the ceiling refused before asking anything.
   */
  async requestsToday(aggregatorId: string, exceptRunId: string): Promise<number> {
    const { rows } = await this.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM news_fetch
        WHERE source_id = $1 AND id <> $2
          AND started_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
          AND (error IS NULL OR error NOT LIKE $3)`,
      [aggregatorId, exceptRunId, `${BUDGET_SPENT}%`],
    );
    return rows[0]!.n;
  }

  /**
   * The stored article URLs, from sources not under this aggregator, that
   * contain any of `fragments` (host and path, as `articleUrlKey` begins):
   * candidates the caller compares by key. A narrowing, never the decision.
   */
  async urlsLike(fragments: readonly string[], aggregatorId: string): Promise<string[]> {
    if (fragments.length === 0) return [];
    const { rows } = await this.pool.query<{ url: string }>(
      `SELECT a.url
         FROM article a
         JOIN news_source s ON s.id = a.source_id
        WHERE s.via_source_id IS DISTINCT FROM $2
          AND a.url ILIKE ANY ($1::text[])`,
      [fragments.map((f) => `%${likeLiteral(f)}%`), aggregatorId],
    );
    return rows.map((r) => r.url);
  }
}
