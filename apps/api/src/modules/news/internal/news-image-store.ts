import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../../../database/database.module';

/** A source's image right (T-1322, D-177); `null` licence means it grants none. */
export interface ImageRight {
  licence: 'cc-by-4.0';
  licenceUrl: string;
  credit: string;
  hosts: string[];
}

export type ImageState = 'stored' | 'refused' | 'failed';
export type ImageOverride = 'show' | 'hide';

export interface ArticleImageRow {
  id: string;
  article_id: string;
  source_url: string;
  state: ImageState;
  reason: string;
  file_key: string | null;
  content_type: string | null;
  editor_override: ImageOverride | null;
}

export interface StoredImage {
  fileKey: string;
  contentType: string;
  width: number;
  height: number;
  byteSize: number;
  credit: string;
  licence: string;
  licenceUrl: string;
}

/** A file a reader may be served: stored, not hidden, under a right its source still grants. */
export interface ServableImage {
  file_key: string;
  content_type: string;
}

/**
 * SQL for news photos (T-1322, D-177). Every write is one row per article;
 * the database's PL022 refuses a row whose source grants no image.
 */
@Injectable()
export class PostgresNewsImageStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async rightOf(sourceId: string): Promise<ImageRight | null> {
    const { rows } = await this.pool.query<{
      image_licence: 'cc-by-4.0' | null;
      image_licence_url: string | null;
      image_credit: string | null;
      image_hosts: string[] | null;
    }>(
      `SELECT image_licence, image_licence_url, image_credit, image_hosts
         FROM news_source WHERE id = $1`,
      [sourceId],
    );
    const r = rows[0];
    if (
      r === undefined ||
      r.image_licence === null ||
      r.image_licence_url === null ||
      r.image_credit === null ||
      r.image_hosts === null
    ) {
      return null;
    }
    return {
      licence: r.image_licence,
      licenceUrl: r.image_licence_url,
      credit: r.image_credit,
      hosts: r.image_hosts,
    };
  }

  async ofArticle(articleId: string): Promise<ArticleImageRow | null> {
    const { rows } = await this.pool.query<ArticleImageRow>(
      `SELECT id, article_id, source_url, state, reason, file_key, content_type, editor_override
         FROM article_image WHERE article_id = $1`,
      [articleId],
    );
    return rows[0] ?? null;
  }

  /** The article's source and link, for an editor's override; `null` when there is no article. */
  async articleOf(articleId: string): Promise<{ source_id: string; url: string } | null> {
    const { rows } = await this.pool.query<{ source_id: string; url: string }>(
      `SELECT source_id, url FROM article WHERE id = $1`,
      [articleId],
    );
    return rows[0] ?? null;
  }

  /**
   * Records what the job decided about an article's photo. A stored file
   * replaces whatever was there; an editor's override is kept while the
   * photo is the same one and dropped when the feed carries another.
   */
  async record(
    articleId: string,
    sourceUrl: string,
    state: ImageState,
    reason: string,
    stored: StoredImage | null,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO article_image
         (article_id, source_url, state, reason, file_key, content_type, width, height,
          byte_size, credit, licence, licence_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (article_id) DO UPDATE
         SET source_url = EXCLUDED.source_url, state = EXCLUDED.state, reason = EXCLUDED.reason,
             file_key = EXCLUDED.file_key, content_type = EXCLUDED.content_type,
             width = EXCLUDED.width, height = EXCLUDED.height, byte_size = EXCLUDED.byte_size,
             credit = EXCLUDED.credit, licence = EXCLUDED.licence,
             licence_url = EXCLUDED.licence_url,
             -- An editor decided about one photo; a different photo is a new decision.
             editor_override = CASE WHEN article_image.source_url = EXCLUDED.source_url
                                    THEN article_image.editor_override END`,
      [
        articleId,
        sourceUrl,
        state,
        reason,
        stored?.fileKey ?? null,
        stored?.contentType ?? null,
        stored?.width ?? null,
        stored?.height ?? null,
        stored?.byteSize ?? null,
        stored?.credit ?? null,
        stored?.licence ?? null,
        stored?.licenceUrl ?? null,
      ],
    );
  }

  /**
   * An editor's show or hide, with its audit row in the same transaction
   * (rule 10): actor, time, reason and the previous value.
   */
  async override(
    articleId: string,
    actorId: string,
    value: ImageOverride,
    reason: string,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const before = await client.query<{
        editor_override: ImageOverride | null;
        state: ImageState;
        reason: string;
      }>(
        `SELECT editor_override, state, reason FROM article_image WHERE article_id = $1 FOR UPDATE`,
        [articleId],
      );
      const previous = before.rows[0] ?? null;
      await client.query(`UPDATE article_image SET editor_override = $2 WHERE article_id = $1`, [
        articleId,
        value,
      ]);
      await client.query(
        `INSERT INTO audit_log (actor_id, action, target_type, target_id, reason, previous, next)
         VALUES ($1, 'article_image.override', 'article', $2, $3, $4::jsonb, $5::jsonb)`,
        [
          actorId,
          articleId,
          reason,
          previous === null ? null : JSON.stringify(previous),
          JSON.stringify({ editor_override: value }),
        ],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** The file behind `/media/news/<name>`, only while a reader may see it. */
  async servable(fileKey: string): Promise<ServableImage | null> {
    const { rows } = await this.pool.query<ServableImage>(
      `SELECT i.file_key, i.content_type
         FROM article_image i
         JOIN article a ON a.id = i.article_id
         JOIN news_source s ON s.id = a.source_id
        WHERE i.file_key = $1 AND i.state = 'stored'
          AND i.editor_override IS DISTINCT FROM 'hide'
          AND s.image_licence IS NOT NULL AND s.dropped_at IS NULL`,
      [fileKey],
    );
    return rows[0] ?? null;
  }
}

/**
 * The join every read uses to put a photo on a card: `alias` is the article,
 * `src` its source. The same conditions as `servable`, so a card never
 * points at a file the route would refuse.
 */
export function shownImageJoin(alias: string, as = 'img'): string {
  return `LEFT JOIN article_image ${as} ON ${as}.article_id = ${alias}.id AND ${as}.state = 'stored'
             AND ${as}.editor_override IS DISTINCT FROM 'hide' AND src.image_licence IS NOT NULL`;
}
