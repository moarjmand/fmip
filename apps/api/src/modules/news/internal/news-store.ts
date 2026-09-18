import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../../../database/database.module';

export type NewsRights = 'headline' | 'summary' | 'full_text';

export interface NewsSourceRow {
  id: string;
  name: string;
  homepage_url: string;
  feed_url: string;
  kind: 'rss' | 'atom';
  rights: NewsRights;
  language: string;
}

export type FetchStatus = 'succeeded' | 'partial' | 'failed';

export interface VersionFields {
  headline: string;
  summary: string | null;
  byline: string | null;
  published_at: string | null;
}

/** SQL for the news job (T-142). Writes only what the job may write. */
@Injectable()
export class PostgresNewsStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** Feed sources that may be read: not dropped, with a feed to read. */
  async activeSources(): Promise<NewsSourceRow[]> {
    const { rows } = await this.pool.query<NewsSourceRow>(
      `SELECT id, name, homepage_url, feed_url, kind, rights, language
         FROM news_source
        WHERE dropped_at IS NULL AND kind IN ('rss', 'atom') AND feed_url IS NOT NULL
        ORDER BY name`,
    );
    return rows;
  }

  /** Opens a run. Throws a unique violation when one is already open for the source. */
  async startFetch(sourceId: string): Promise<string> {
    const { rows } = await this.pool.query<{ id: string }>(
      `INSERT INTO news_fetch (source_id) VALUES ($1) RETURNING id`,
      [sourceId],
    );
    return rows[0]!.id;
  }

  async finishFetch(
    id: string,
    outcome: { status: FetchStatus; itemsSeen: number; itemsWritten: number; error: string | null },
  ): Promise<void> {
    await this.pool.query(
      `UPDATE news_fetch
          SET status = $2, finished_at = now(), items_seen = $3, items_written = $4, error = $5
        WHERE id = $1 AND status = 'running'`,
      [id, outcome.status, outcome.itemsSeen, outcome.itemsWritten, outcome.error],
    );
  }

  /**
   * The article for a feed item, by the identity the feed gave it. An item
   * seen before is touched (`fetched_at`, and the link, which publishers do
   * move); a new one gets a story of its own, which clustering may later merge.
   */
  async upsertArticle(
    sourceId: string,
    externalId: string,
    url: string,
  ): Promise<{ id: string; inserted: boolean }> {
    const existing = await this.pool.query<{ id: string }>(
      `UPDATE article SET fetched_at = now(), url = $3
        WHERE source_id = $1 AND external_id = $2
        RETURNING id`,
      [sourceId, externalId, url],
    );
    const found = existing.rows[0];
    if (found !== undefined) return { id: found.id, inserted: false };

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const story = await client.query<{ id: string }>(
        `INSERT INTO story DEFAULT VALUES RETURNING id`,
      );
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO article (source_id, story_id, external_id, url)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [sourceId, story.rows[0]!.id, externalId, url],
      );
      await client.query('COMMIT');
      return { id: rows[0]!.id, inserted: true };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** The newest version in a language, or null when there is none yet. */
  async newestVersion(
    articleId: string,
    language: string,
  ): Promise<(VersionFields & { version_number: number }) | null> {
    const { rows } = await this.pool.query<VersionFields & { version_number: number }>(
      `SELECT version_number, headline, summary, byline, published_at
         FROM article_version
        WHERE article_id = $1 AND language = $2
        ORDER BY version_number DESC
        LIMIT 1`,
      [articleId, language],
    );
    return rows[0] ?? null;
  }

  async addVersion(
    articleId: string,
    language: string,
    versionNumber: number,
    fields: VersionFields,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO article_version
         (article_id, language, version_number, headline, summary, byline, published_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        articleId,
        language,
        versionNumber,
        fields.headline,
        fields.summary,
        fields.byline,
        fields.published_at,
      ],
    );
  }
}
