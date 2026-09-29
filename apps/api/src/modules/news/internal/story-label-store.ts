import { Inject, Injectable } from '@nestjs/common';
import type { StoryLabelOrigin, StoryType } from '@fmip/contracts';
import { Pool } from 'pg';
import { PG_POOL } from '../../../database/database.module';

export interface CurrentLabel {
  id: string;
  story_type: StoryType;
  origin: StoryLabelOrigin;
  created_at: Date;
}

export type EditorLabelOutcome = 'labelled' | 'unchanged' | 'no_story';

/**
 * A story's type (T-1001, D-123). A label is never edited: a new one
 * supersedes the current one (`superseded_at`) in the same transaction, and
 * the partial unique index keeps one current label per story even when two
 * writes race. An editor's label and its `audit_log` row are one transaction
 * (rule 10), with the label it replaced as `previous`.
 */
@Injectable()
export class PostgresStoryLabelStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async current(storyId: string): Promise<CurrentLabel | null> {
    const { rows } = await this.pool.query<CurrentLabel>(
      `SELECT id, story_type, origin, created_at
         FROM story_label WHERE story_id = $1 AND superseded_at IS NULL`,
      [storyId],
    );
    return rows[0] ?? null;
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
