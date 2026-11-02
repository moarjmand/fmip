/** The retention purge's bounded delete statements, one per table (T-1715, D-345). */
import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_POOL } from '../../../database/database.module';

/** A table the purge deletes from, by the column its period is measured on. */
export type PurgeTarget = 'session' | 'console_session' | 'email_token' | 'notification_delivery';

/**
 * One bounded batch per table (T-1715, D-345): each method deletes at most
 * `limit` rows older than `cutoff` and says how many it deleted. The rows
 * belong to other boundaries (identity, notifications, the agents console);
 * this only removes the ones whose period is over, the way the activity
 * report only counts them.
 */
@Injectable()
export class RetentionStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** Expired member sessions, by `expires_at`. */
  deleteSessions(cutoff: Date, limit: number): Promise<number> {
    return this.deleteExpired('session', cutoff, limit);
  }

  /** Expired agents-console sessions, by `expires_at`. */
  deleteConsoleSessions(cutoff: Date, limit: number): Promise<number> {
    return this.deleteExpired('console_session', cutoff, limit);
  }

  /** Expired one-time e-mail tokens (verify_email, reset_password), by `expires_at`. */
  deleteEmailTokens(cutoff: Date, limit: number): Promise<number> {
    return this.deleteExpired('email_token', cutoff, limit);
  }

  /**
   * Delivery rows claimed before `cutoff`, oldest first, each added to
   * `notification_delivery_daily` in the same statement it is deleted in, so
   * a row is counted exactly once whether the statement commits or not.
   */
  async rollUpDeliveries(cutoff: Date, limit: number): Promise<number> {
    const { rows } = await this.pool.query<{ deleted: number }>(
      `WITH batch AS (
         SELECT notification_id
           FROM notification_delivery
          WHERE claimed_at < $1
          ORDER BY claimed_at
          LIMIT $2
       ),
       gone AS (
         DELETE FROM notification_delivery d
          USING batch b
          WHERE d.notification_id = b.notification_id
         RETURNING d.notification_id, d.claimed_at, d.email, d.push
       ),
       counted AS (
         INSERT INTO notification_delivery_daily (day, kind, email, push, n)
         SELECT (g.claimed_at AT TIME ZONE 'UTC')::date,
                coalesce(n.kind, 'unknown'),
                coalesce(g.email, 'uncarried'),
                coalesce(g.push, 'uncarried'),
                count(*)
           FROM gone g
           LEFT JOIN notification n ON n.id = g.notification_id
          GROUP BY 1, 2, 3, 4
         ON CONFLICT (day, kind, email, push)
           DO UPDATE SET n = notification_delivery_daily.n + EXCLUDED.n
       )
       SELECT count(*)::int AS deleted FROM gone`,
      [cutoff, limit],
    );
    return rows[0]?.deleted ?? 0;
  }

  private async deleteExpired(
    table: Exclude<PurgeTarget, 'notification_delivery'>,
    cutoff: Date,
    limit: number,
  ): Promise<number> {
    // `table` is one of three literals above, never input.
    const result = await this.pool.query(
      `DELETE FROM ${table}
        WHERE id IN (SELECT id FROM ${table} WHERE expires_at < $1 LIMIT $2)`,
      [cutoff, limit],
    );
    return result.rowCount ?? 0;
  }
}
