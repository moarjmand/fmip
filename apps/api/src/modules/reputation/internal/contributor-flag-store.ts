import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../../../database/database.module';
import type { FlagToRaise, LiveHolder, OpenFlag, RatingPoint } from './contributor-flag';

/**
 * The SQL for contributor flags (T-1031, D-137). All of it, and nothing
 * else: which flags to raise or close is `contributor-flag.ts`, and what a
 * grant's standing is stays `contributor_grant_standing()`.
 */

export interface FlagRow {
  id: string;
  username: string;
  below_since: Date;
  rating: string;
  rating_now: string | null;
  threshold: string;
  period_days: number;
  rules_version: string;
  raised_at: Date;
  standing: string;
  closed_at: Date | null;
  closed_reason: string | null;
  closed_by: string | null;
  close_note: string | null;
}

const FLAG_COLUMNS = `f.id, u.username, f.below_since, f.rating::text AS rating,
       (SELECT s.rating::text FROM rating_snapshot s
         WHERE s.user_id = f.user_id
         ORDER BY s.computed_at DESC, s.id DESC LIMIT 1) AS rating_now,
       f.threshold::text AS threshold, f.period_days, f.rules_version, f.raised_at,
       contributor_grant_standing(f.grant_id) AS standing,
       f.closed_at, f.closed_reason, closer.username AS closed_by, f.close_note`;

const FLAG_FROM = `contributor_flag f
  JOIN user_account u ON u.id = f.user_id
  LEFT JOIN user_account closer ON closer.id = f.closed_by`;

@Injectable()
export class PostgresContributorFlagStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** Every member whose grant is live and not paused: the contributors the check looks at. */
  async liveHolders(): Promise<LiveHolder[]> {
    const { rows } = await this.pool.query<{ user_id: string; id: string; created_at: Date }>(
      `SELECT g.user_id, g.id, g.created_at
         FROM contributor_grant g
        WHERE contributor_grant_standing(g.id) = 'active'`,
    );
    return rows.map((row) => ({ userId: row.user_id, grantId: row.id, grantedAt: row.created_at }));
  }

  async openFlags(): Promise<OpenFlag[]> {
    const { rows } = await this.pool.query<{ id: string; user_id: string; below_since: Date }>(
      `SELECT id, user_id, below_since FROM contributor_flag WHERE closed_at IS NULL`,
    );
    return rows.map((row) => ({ id: row.id, userId: row.user_id, belowSince: row.below_since }));
  }

  /** Each member's stored ratings, oldest first (rule 8: the flag is recomputable from these). */
  async ratings(userIds: string[]): Promise<Map<string, RatingPoint[]>> {
    const out = new Map<string, RatingPoint[]>();
    if (userIds.length === 0) return out;
    const { rows } = await this.pool.query<{ user_id: string; rating: string; computed_at: Date }>(
      `SELECT user_id, rating::text AS rating, computed_at
         FROM rating_snapshot
        WHERE user_id = ANY($1::uuid[])
        ORDER BY user_id, computed_at, id`,
      [userIds],
    );
    for (const row of rows) {
      const list = out.get(row.user_id) ?? [];
      list.push({ rating: Number(row.rating), at: row.computed_at });
      out.set(row.user_id, list);
    }
    return out;
  }

  /** Closes a flag the check found over. Idempotent: an already closed flag is left alone. */
  async close(flagId: string, reason: 'recovered' | 'grant_not_live'): Promise<void> {
    await this.pool.query(
      `UPDATE contributor_flag SET closed_at = now(), closed_reason = $2
        WHERE id = $1 AND closed_at IS NULL`,
      [flagId, reason],
    );
  }

  /**
   * Raises a flag for a stretch, or nothing when one was already raised for
   * it (open or dismissed): the id when written, else null.
   */
  async raise(
    flag: FlagToRaise,
    threshold: number,
    periodDays: number,
    rulesVersion: string,
  ): Promise<string | null> {
    const { rows } = await this.pool.query<{ id: string }>(
      `INSERT INTO contributor_flag
         (user_id, grant_id, below_since, threshold, period_days, rules_version, rating)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [
        flag.userId,
        flag.grantId,
        flag.belowSince,
        threshold,
        periodDays,
        rulesVersion,
        flag.rating,
      ],
    );
    return rows[0]?.id ?? null;
  }

  /** The open flags, oldest stretch first. */
  async listOpen(): Promise<FlagRow[]> {
    const { rows } = await this.pool.query<FlagRow>(
      `SELECT ${FLAG_COLUMNS} FROM ${FLAG_FROM}
        WHERE f.closed_at IS NULL
        ORDER BY f.below_since, f.id`,
    );
    return rows;
  }

  async byId(flagId: string): Promise<FlagRow | null> {
    const { rows } = await this.pool.query<FlagRow>(
      `SELECT ${FLAG_COLUMNS} FROM ${FLAG_FROM} WHERE f.id = $1`,
      [flagId],
    );
    return rows[0] ?? null;
  }

  /**
   * An administrator dismissing an open flag with a reason, and the audit row
   * naming them, the reason and the flag as it was, in one transaction (rule
   * 10). False when there is no open flag with that id.
   */
  async dismiss(flagId: string, actorId: string, reason: string): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{ user_id: string; below_since: Date }>(
        `UPDATE contributor_flag
            SET closed_at = now(), closed_reason = 'dismissed', closed_by = $2, close_note = $3
          WHERE id = $1 AND closed_at IS NULL
          RETURNING user_id, below_since`,
        [flagId, actorId, reason],
      );
      const flag = rows[0];
      if (flag === undefined) {
        await client.query('ROLLBACK');
        return false;
      }
      await client.query(
        `INSERT INTO audit_log (actor_id, action, target_type, target_id, reason, previous, next)
         VALUES ($1, 'contributor.flag_dismiss', 'user_account', $2, $3, $4::jsonb, $5::jsonb)`,
        [
          actorId,
          flag.user_id,
          reason,
          JSON.stringify({ flag_id: flagId, state: 'open', below_since: flag.below_since }),
          JSON.stringify({ flag_id: flagId, state: 'dismissed' }),
        ],
      );
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
