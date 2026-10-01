import { Inject, Injectable } from '@nestjs/common';
import type { StoryLabelOrigin, StoryType } from '@fmip/contracts';
import { Pool } from 'pg';
import { PG_POOL } from '../../../database/database.module';
import { CATEGORY_MAPPING, type CategoryMapping, mappedType } from './story-type-mapping';

export interface CurrentLabel {
  id: string;
  story_type: StoryType;
  origin: StoryLabelOrigin;
  created_at: Date;
}

export type EditorLabelOutcome = 'labelled' | 'unchanged' | 'no_story';

/**
 * What refreshing a story's publisher type did (T-1002): `editor` when an
 * editor's label stands and nothing was touched; `labelled` when a new
 * publisher label superseded whatever was current; `withdrawn` when the
 * current publisher label lost its basis and nothing replaced it;
 * `unchanged` otherwise.
 */
export type PublisherLabelOutcome = 'editor' | 'labelled' | 'withdrawn' | 'unchanged';

/**
 * A story's type (T-1001, D-123). A label is never edited: a new one
 * supersedes the current one (`superseded_at`) in the same transaction, and
 * the partial unique index keeps one current label per story even when two
 * writes race. An editor's label and its `audit_log` row are one transaction
 * (rule 10), with the label it replaced as `previous`.
 */
@Injectable()
export class PostgresStoryLabelStore {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(CATEGORY_MAPPING) private readonly mapping: readonly CategoryMapping[],
  ) {}

  async current(storyId: string): Promise<CurrentLabel | null> {
    const { rows } = await this.pool.query<CurrentLabel>(
      `SELECT id, story_type, origin, created_at
         FROM story_label WHERE story_id = $1 AND superseded_at IS NULL`,
      [storyId],
    );
    return rows[0] ?? null;
  }

  /**
   * Who a transfer or availability alert may reach (T-1032, D-166): every
   * member following a team or person any of the story's reports links, once
   * each, whose switch for `kind` is on -- their own choice, else the default
   * given. A competition is not enough: "a team or player I follow" is what
   * the member switched on. One statement whatever the audience; the
   * notifications boundary applies the mutes, quiet hours and dedupe key.
   */
  async audience(storyId: string, kind: string, onByDefault: boolean): Promise<string[]> {
    const { rows } = await this.pool.query<{ user_id: string }>(
      `SELECT DISTINCT f.user_id
         FROM article m
         JOIN article_entity e
           ON e.article_id = m.id AND e.entity_type IN ('team', 'person')
         JOIN followed_entity f ON f.entity_type = e.entity_type AND f.entity_id = e.entity_id
         -- D-178: only members shown the story in the language they chose.
         JOIN user_account u ON u.id = f.user_id
         JOIN story s ON s.id = m.story_id
         JOIN article shown
           ON shown.id = story_shown_article(s.id, s.promoted_article_id, u.preferred_language)
         LEFT JOIN notification_preference p ON p.user_id = f.user_id AND p.kind = $2
        WHERE m.story_id = $1
          AND COALESCE(p.in_product, $3::boolean)`,
      [storyId, kind, onByDefault],
    );
    return rows.map((r) => r.user_id);
  }

  /**
   * The story's publisher type, recomputed from its promoted original's
   * categories as stored (T-1002, D-123). An editor's label always wins and is
   * never superseded here. A publisher label is replaced only when the type,
   * the article or the category that gave it changed; when the original no
   * longer maps to anything the label is withdrawn (superseded with nothing
   * after it), so the story says it has no type rather than keeping a type
   * whose basis is gone.
   */
  async refreshPublisher(storyId: string): Promise<PublisherLabelOutcome> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: stories } = await client.query<{
        article_id: string | null;
        feed_url: string | null;
        categories: string[];
      }>(
        `SELECT a.id AS article_id, src.feed_url,
                COALESCE((SELECT array_agg(c.category ORDER BY c.position)
                            FROM article_category c WHERE c.article_id = a.id), '{}') AS categories
           FROM story s
           LEFT JOIN article a ON a.id = s.promoted_article_id
           LEFT JOIN news_source src ON src.id = a.source_id
          WHERE s.id = $1
          FOR UPDATE OF s`,
        [storyId],
      );
      const story = stories[0];
      const { rows: labels } = await client.query<{
        id: string;
        story_type: string;
        origin: string;
        source_article_id: string | null;
        source_category: string | null;
      }>(
        `SELECT id, story_type, origin, source_article_id, source_category
           FROM story_label WHERE story_id = $1 AND superseded_at IS NULL`,
        [storyId],
      );
      const current = labels[0];
      if (story === undefined || current?.origin === 'editor') {
        await client.query('ROLLBACK');
        return current?.origin === 'editor' ? 'editor' : 'unchanged';
      }
      const mapped =
        story.article_id === null || story.feed_url === null
          ? null
          : mappedType(story.feed_url, story.categories, this.mapping);
      if (
        mapped !== null &&
        current !== undefined &&
        current.story_type === mapped.type &&
        current.source_article_id === story.article_id &&
        current.source_category === mapped.category
      ) {
        await client.query('ROLLBACK');
        return 'unchanged';
      }
      if (mapped === null && current === undefined) {
        await client.query('ROLLBACK');
        return 'unchanged';
      }
      if (current !== undefined) {
        await client.query(
          `UPDATE story_label SET superseded_at = now() WHERE id = $1 AND superseded_at IS NULL`,
          [current.id],
        );
      }
      if (mapped !== null) {
        await client.query(
          `INSERT INTO story_label (story_id, story_type, origin, source_article_id, source_category)
           VALUES ($1, $2, 'publisher', $3, $4)`,
          [storyId, mapped.type, story.article_id, mapped.category],
        );
      }
      await client.query('COMMIT');
      return mapped === null ? 'withdrawn' : 'labelled';
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * An editor's label. `unchanged` when the current label is already this
   * editor-given type (nothing to supersede, and nothing is re-noted
   * silently); a publisher's label of the same type is superseded, because
   * the editor's word is what keeps a later fetch from changing it.
   */
  async labelByEditor(
    storyId: string,
    actorId: string,
    type: StoryType,
    reason: string,
  ): Promise<EditorLabelOutcome> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const story = await client.query(`SELECT 1 FROM story WHERE id = $1 FOR UPDATE`, [storyId]);
      if ((story.rowCount ?? 0) === 0) {
        await client.query('ROLLBACK');
        return 'no_story';
      }
      const { rows: before } = await client.query<CurrentLabel & { reason: string | null }>(
        `SELECT id, story_type, origin, created_at, reason
           FROM story_label WHERE story_id = $1 AND superseded_at IS NULL`,
        [storyId],
      );
      const previous = before[0];
      if (previous !== undefined && previous.origin === 'editor' && previous.story_type === type) {
        await client.query('ROLLBACK');
        return 'unchanged';
      }
      if (previous !== undefined) {
        await client.query(
          `UPDATE story_label SET superseded_at = now() WHERE id = $1 AND superseded_at IS NULL`,
          [previous.id],
        );
      }
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO story_label (story_id, story_type, origin, labelled_by, reason)
         VALUES ($1, $2, 'editor', $3, $4) RETURNING id`,
        [storyId, type, actorId, reason],
      );
      await client.query(
        `INSERT INTO audit_log (actor_id, action, target_type, target_id, reason, previous, next)
         VALUES ($1, 'story.type', 'story', $2, $3, $4::jsonb, $5::jsonb)`,
        [
          actorId,
          storyId,
          reason,
          previous === undefined
            ? null
            : JSON.stringify({
                label_id: previous.id,
                type: previous.story_type,
                origin: previous.origin,
                labelled_at: previous.created_at.toISOString(),
              }),
          JSON.stringify({ label_id: rows[0]!.id, type, origin: 'editor' }),
        ],
      );
      await client.query('COMMIT');
      return 'labelled';
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
