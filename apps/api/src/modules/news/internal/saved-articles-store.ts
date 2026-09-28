import { Inject, Injectable } from '@nestjs/common';
import type { SavedArticle, SavedArticleState } from '@fmip/contracts';
import { Pool } from 'pg';
import { PG_POOL } from '../../../database/database.module';

export type SaveOutcome = 'saved' | 'unknown_story' | 'full';

interface SavedRow {
  story_id: string;
  saved_at: Date;
  article_id: string | null;
  headline: string | null;
  url: string | null;
  language: string | null;
  published_at: Date | null;
  source_id: string;
  source_name: string;
  homepage_url: string;
  dropped_at: Date | null;
}

/**
 * What a saved row reads as (T-842): the publisher's headline and link while
 * the report is held, otherwise the reason it is not -- a dropped publisher
 * named with no link to them (D-061), never a dead link and never a copy.
 */
export function savedArticleOf(row: SavedRow): SavedArticle {
  const state: SavedArticleState =
    row.article_id !== null && row.headline !== null && row.url !== null && row.dropped_at === null
      ? 'available'
      : row.dropped_at !== null
        ? 'source_dropped'
        : 'unavailable';
  const shown = state === 'available';
  return {
    story_id: row.story_id,
    saved_at: row.saved_at.toISOString(),
    state,
    headline: shown ? row.headline : null,
    url: shown ? row.url : null,
    language: shown ? row.language : null,
    published_at: shown && row.published_at !== null ? row.published_at.toISOString() : null,
    source: {
      id: row.source_id,
      name: row.source_name,
      homepage_url: row.dropped_at === null ? row.homepage_url : null,
      dropped_at: row.dropped_at?.toISOString() ?? null,
    },
  };
}

/**
 * A member's saved articles (T-842). Ids only are stored; the words are read
 * from the article each time, in the publisher's own language (a saved
 * headline is the publisher's, never a translation of it).
 */
@Injectable()
export class PostgresSavedArticlesStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async list(userId: string, limit: number): Promise<SavedArticle[]> {
    const { rows } = await this.pool.query<SavedRow>(
      `SELECT sa.story_id, sa.saved_at, a.id AS article_id, v.headline, a.url, v.language,
              v.published_at, src.id AS source_id, src.name AS source_name, src.homepage_url,
              src.dropped_at
         FROM saved_article sa
         JOIN news_source src ON src.id = sa.source_id
         LEFT JOIN article a ON a.id = sa.article_id
         LEFT JOIN LATERAL (
           SELECT headline, language, published_at
             FROM article_version
            WHERE article_id = a.id
            ORDER BY (language = src.language) DESC, created_at DESC, version_number DESC
            LIMIT 1
         ) v ON TRUE
        WHERE sa.user_id = $1
        ORDER BY sa.saved_at DESC, sa.story_id
        LIMIT $2`,
      [userId, limit],
    );
    return rows.map(savedArticleOf);
  }

  /**
   * Save the story's promoted original, from a publisher not dropped. Saving
   * one already saved is a no-op, not an error; a list at `limit` refuses.
   */
  async save(userId: string, storyId: string, limit: number): Promise<SaveOutcome> {
    const inserted = await this.pool.query<{ story_id: string }>(
      `INSERT INTO saved_article (user_id, story_id, article_id, source_id)
       SELECT $1, s.id, a.id, a.source_id
         FROM story s
         JOIN article a ON a.id = s.promoted_article_id
         JOIN news_source src ON src.id = a.source_id AND src.dropped_at IS NULL
        WHERE s.id = $2
          AND (SELECT count(*) FROM saved_article WHERE user_id = $1) < $3
       ON CONFLICT (user_id, story_id) DO NOTHING
       RETURNING story_id`,
      [userId, storyId, limit],
    );
    if (inserted.rows.length > 0) return 'saved';
    const { rows } = await this.pool.query<{ saved: boolean; exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM saved_article WHERE user_id = $1 AND story_id = $2) AS saved,
              EXISTS (SELECT 1 FROM story s
                        JOIN article a ON a.id = s.promoted_article_id
                        JOIN news_source src ON src.id = a.source_id AND src.dropped_at IS NULL
                       WHERE s.id = $2) AS exists`,
      [userId, storyId],
    );
    const r = rows[0];
    if (r?.saved === true) return 'saved';
    return r?.exists === true ? 'full' : 'unknown_story';
  }

  /** Remove one; removing one that is not there is a no-op. */
  async remove(userId: string, storyId: string): Promise<void> {
    await this.pool.query(`DELETE FROM saved_article WHERE user_id = $1 AND story_id = $2`, [
      userId,
      storyId,
    ]);
  }
}
