import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../../../database/database.module';

/**
 * A member's devices for Web Push (T-330, D-074): one row per browser
 * registration -- the endpoint its push service handed out and the two keys
 * a message is encrypted with. Kept apart from the channel so the port can
 * count and register devices without the sender.
 */
export interface PushSubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** A device's registration is a row; the endpoint is unique across members because a browser hands it to one. */
@Injectable()
export class PostgresPushSubscriptionStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async forMember(userId: string): Promise<PushSubscriptionRow[]> {
    const { rows } = await this.pool.query<PushSubscriptionRow>(
      `SELECT id, endpoint, p256dh, auth FROM push_subscription WHERE user_id = $1 ORDER BY created_at`,
      [userId],
    );
    return rows;
  }

  async count(userId: string): Promise<number> {
    const { rows } = await this.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM push_subscription WHERE user_id = $1`,
      [userId],
    );
    return rows[0]?.n ?? 0;
  }

  /** The same endpoint registered again is the same device: its keys are refreshed, not doubled. */
  async add(
    userId: string,
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    userAgent: string | null,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO push_subscription (user_id, endpoint, p256dh, auth, user_agent)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (endpoint) DO UPDATE
         SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
             user_agent = EXCLUDED.user_agent, updated_at = now()`,
      [userId, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, userAgent],
    );
  }

  async remove(userId: string, endpoint: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `DELETE FROM push_subscription WHERE user_id = $1 AND endpoint = $2`,
      [userId, endpoint],
    );
    return rowCount === 1;
  }

  async removeGone(id: string): Promise<void> {
    await this.pool.query(`DELETE FROM push_subscription WHERE id = $1`, [id]);
  }

  async touch(id: string): Promise<void> {
    await this.pool.query(`UPDATE push_subscription SET last_used_at = now() WHERE id = $1`, [id]);
  }
}
