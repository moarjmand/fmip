import { Inject, Injectable } from '@nestjs/common';
import { Pool, type PoolClient } from 'pg';
import { PG_POOL } from '../../../database/database.module';

export type DebateFilter = 'open' | 'cleared' | 'all';

export interface DebateRow {
  id: string;
  story_id: string;
  /** The promoted original's newest headline, so an editor can recognise the story. */
  headline: string | null;
  selected_by: string;
  note: string;
  selected_at: Date;
  cleared_by: string | null;
  cleared_reason: string | null;
  cleared_at: Date | null;
}

interface AuditEntry {
  actorId: string;
  action: string;
  targetId: string;
  reason: string;
  previous: Record<string, unknown> | null;
  next: Record<string, unknown>;
}

/**
 * The editor's half of the debate section (blueprint 3.1, T-143): selecting a
 * story and clearing one, each with its `audit_log` row in the same
 * transaction (rule 10). `target_type` is `story`, because the thing that
 * changed is a story, and "who put this on the debate page" is the question
 * the row is asked.
 */
@Injectable()
export class PostgresDebateAdminStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async storyExists(storyId: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(`SELECT 1 FROM story WHERE id = $1`, [storyId]);
    return (rowCount ?? 0) > 0;
  }

  /** Selects a story; `already` when an open selection exists, which is not re-noted silently. */
  async select(storyId: string, actorId: string, note: string): Promise<'selected' | 'already'> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const open = await client.query<{ id: string }>(
        `SELECT id FROM story_debate WHERE story_id = $1 AND cleared_at IS NULL FOR UPDATE`,
        [storyId],
      );
      if (open.rows.length > 0) {
        await client.query('ROLLBACK');
        return 'already';
      }
      const previous = await client.query<{ id: string; note: string; cleared_at: Date }>(
        `SELECT id, note, cleared_at FROM story_debate
          WHERE story_id = $1 ORDER BY selected_at DESC LIMIT 1`,
        [storyId],
      );
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO story_debate (story_id, selected_by, note) VALUES ($1, $2, $3) RETURNING id`,
        [storyId, actorId, note],
      );
      const last = previous.rows[0];
      await record(client, {
        actorId,
        action: 'debate.select',
        targetId: storyId,
        reason: note,
        previous:
          last === undefined
            ? null
            : { selection_id: last.id, note: last.note, cleared_at: last.cleared_at.toISOString() },
        next: { selection_id: rows[0]!.id, note },
      });
      await client.query('COMMIT');
      return 'selected';
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** Clears the open selection; false when there is none to clear. */
  async clear(storyId: string, actorId: string, reason: string): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{ id: string; note: string; selected_at: Date }>(
        `UPDATE story_debate
            SET cleared_at = now(), cleared_by = $2, cleared_reason = $3
          WHERE story_id = $1 AND cleared_at IS NULL
          RETURNING id, note, selected_at`,
        [storyId, actorId, reason],
      );
      const cleared = rows[0];
      if (cleared === undefined) {
        await client.query('ROLLBACK');
        return false;
      }
      await record(client, {
        actorId,
        action: 'debate.clear',
        targetId: storyId,
        reason,
        previous: {
          selection_id: cleared.id,
          note: cleared.note,
          selected_at: cleared.selected_at.toISOString(),
        },
        next: { selection_id: cleared.id, cleared: true },
      });
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async list(filter: DebateFilter, limit: number): Promise<DebateRow[]> {
    const state =
      filter === 'open'
        ? 'AND d.cleared_at IS NULL'
        : filter === 'cleared'
          ? 'AND d.cleared_at IS NOT NULL'
          : '';
    const { rows } = await this.pool.query<DebateRow>(
      `SELECT d.id, d.story_id,
              (SELECT v.headline FROM article_version v
                WHERE v.article_id = s.promoted_article_id
                ORDER BY v.created_at DESC, v.version_number DESC LIMIT 1) AS headline,
              sel.username AS selected_by, d.note, d.selected_at,
              clr.username AS cleared_by, d.cleared_reason, d.cleared_at
         FROM story_debate d
         JOIN story s ON s.id = d.story_id
         JOIN user_account sel ON sel.id = d.selected_by
         LEFT JOIN user_account clr ON clr.id = d.cleared_by
        WHERE TRUE ${state}
        ORDER BY d.selected_at DESC
        LIMIT $1`,
      [limit],
    );
    return rows;
  }
}

async function record(client: PoolClient, entry: AuditEntry): Promise<void> {
  await client.query(
    `INSERT INTO audit_log (actor_id, action, target_type, target_id, reason, previous, next)
     VALUES ($1, $2, 'story', $3, $4, $5::jsonb, $6::jsonb)`,
    [
      entry.actorId,
      entry.action,
      entry.targetId,
      entry.reason,
      entry.previous === null ? null : JSON.stringify(entry.previous),
      JSON.stringify(entry.next),
    ],
  );
}
