import { Inject, Injectable } from '@nestjs/common';
import { BREAKING_WINDOW_HOURS } from '@fmip/contracts';
import { Pool, type PoolClient } from 'pg';
import { PG_POOL } from '../../../database/database.module';

export type BreakingFilter = 'live' | 'all';

export interface BreakingRow {
  story_id: string;
  headline: string | null;
  marked_by: string;
  note: string;
  marked_at: Date;
  ends_at: Date;
  cleared_by: string | null;
  cleared_reason: string | null;
  cleared_at: Date | null;
  live: boolean;
}

export type MarkOutcome =
  { kind: 'marked'; markId: string; endsAt: Date } | { kind: 'already' } | { kind: 'no_story' };

/**
 * The editor's breaking mark (T-1004, D-125): marking and clearing, each with
 * its `audit_log` row in the same transaction (rule 10), target type `story`.
 * One mark in force per story is kept here, under the story's row lock,
 * because "in force" is `ends_at > now()` and no index can say that.
 */
@Injectable()
export class PostgresBreakingAdminStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async mark(storyId: string, actorId: string, note: string): Promise<MarkOutcome> {
    return this.transaction(async (client) => {
      const story = await client.query(`SELECT 1 FROM story WHERE id = $1 FOR UPDATE`, [storyId]);
      if ((story.rowCount ?? 0) === 0) return { kind: 'no_story' };
      const live = await client.query(
        `SELECT 1 FROM story_breaking
          WHERE story_id = $1 AND cleared_at IS NULL AND ends_at > now()`,
        [storyId],
      );
      if ((live.rowCount ?? 0) > 0) return { kind: 'already' };
      const previous = await client.query<{
        id: string;
        note: string;
        ends_at: Date;
        cleared_at: Date | null;
      }>(
        `SELECT id, note, ends_at, cleared_at FROM story_breaking
          WHERE story_id = $1 ORDER BY marked_at DESC LIMIT 1`,
        [storyId],
      );
      const { rows } = await client.query<{ id: string; ends_at: Date }>(
        `INSERT INTO story_breaking (story_id, marked_by, note, ends_at)
         VALUES ($1, $2, $3, now() + make_interval(hours => $4))
         RETURNING id, ends_at`,
        [storyId, actorId, note, BREAKING_WINDOW_HOURS],
      );
      const last = previous.rows[0];
      const mark = rows[0]!;
      await audit(client, {
        actorId,
        action: 'breaking.mark',
        storyId,
        reason: note,
        previous:
          last === undefined
            ? null
            : {
                mark_id: last.id,
                note: last.note,
                ends_at: last.ends_at.toISOString(),
                cleared_at: last.cleared_at?.toISOString() ?? null,
              },
        next: { mark_id: mark.id, note, ends_at: mark.ends_at.toISOString() },
      });
      return { kind: 'marked', markId: mark.id, endsAt: mark.ends_at };
    });
  }

  /** Clears the mark in force; false when none is (an expired mark has nothing left to clear). */
  async clear(storyId: string, actorId: string, reason: string): Promise<boolean> {
    return this.transaction(async (client) => {
      const { rows } = await client.query<{
        id: string;
        note: string;
        marked_at: Date;
        ends_at: Date;
      }>(
        `UPDATE story_breaking
            SET cleared_at = now(), cleared_by = $2, cleared_reason = $3
          WHERE story_id = $1 AND cleared_at IS NULL AND ends_at > now()
          RETURNING id, note, marked_at, ends_at`,
        [storyId, actorId, reason],
      );
      const cleared = rows[0];
      if (cleared === undefined) return false;
      await audit(client, {
        actorId,
        action: 'breaking.clear',
        storyId,
        reason,
        previous: {
          mark_id: cleared.id,
          note: cleared.note,
          marked_at: cleared.marked_at.toISOString(),
          ends_at: cleared.ends_at.toISOString(),
        },
        next: { mark_id: cleared.id, cleared: true },
      });
      return true;
    });
  }

  async list(filter: BreakingFilter, limit: number): Promise<BreakingRow[]> {
    const { rows } = await this.pool.query<BreakingRow>(
      `SELECT b.story_id,
              (SELECT v.headline FROM article_version v
                WHERE v.article_id = s.promoted_article_id
                ORDER BY v.created_at DESC, v.version_number DESC LIMIT 1) AS headline,
              mk.username AS marked_by, b.note, b.marked_at, b.ends_at,
              clr.username AS cleared_by, b.cleared_reason, b.cleared_at,
              (b.cleared_at IS NULL AND b.ends_at > now()) AS live
         FROM story_breaking b
         JOIN story s ON s.id = b.story_id
         JOIN user_account mk ON mk.id = b.marked_by
         LEFT JOIN user_account clr ON clr.id = b.cleared_by
        WHERE $2::boolean = FALSE OR (b.cleared_at IS NULL AND b.ends_at > now())
        ORDER BY b.marked_at DESC
        LIMIT $1`,
      [limit, filter === 'live'],
    );
    return rows;
  }

  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

async function audit(
  client: PoolClient,
  entry: {
    actorId: string;
    action: string;
    storyId: string;
    reason: string;
    previous: Record<string, unknown> | null;
    next: Record<string, unknown>;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO audit_log (actor_id, action, target_type, target_id, reason, previous, next)
     VALUES ($1, $2, 'story', $3, $4, $5::jsonb, $6::jsonb)`,
    [
      entry.actorId,
      entry.action,
      entry.storyId,
      entry.reason,
      entry.previous === null ? null : JSON.stringify(entry.previous),
      JSON.stringify(entry.next),
    ],
  );
}
