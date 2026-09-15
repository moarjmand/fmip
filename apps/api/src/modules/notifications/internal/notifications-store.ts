import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../../../database/database.module';

/**
 * The SQL for notifications (T-270, T-271). All of it, and nothing else.
 *
 * The block is not here. `notification_block_guard` refuses a notification
 * whose source the recipient blocked (`PL003`), and this file writes the row and
 * lets it — a check in front of the INSERT would be a second copy of a safety
 * rule, and the copy that is wrong is always the one somebody reads.
 */

export interface NotificationRow {
  id: string;
  kind: string;
  subject_type: string;
  subject_id: string;
  source: string | null;
  created_at: Date;
  read_at: Date | null;
  held_reason: string | null;
}

export interface NewNotification {
  userId: string;
  kind: string;
  subjectType: string;
  subjectId: string;
  /** The member who caused it, when there is one. */
  sourceId?: string | null;
  /** What the emitter considers "the same notification". Omit when there is nothing to say. */
  dedupeKey?: string | null;
}

@Injectable()
export class PostgresNotificationsStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /**
   * Write one, unless it is a duplicate.
   *
   * `ON CONFLICT DO NOTHING` rather than a lookup first: two events racing would
   * both pass a lookup and only one should write, and the partial unique index
   * on `dedupe_key` is what decides. Returns `false` when nothing was written,
   * so a caller can tell "already sent" from "sent" without asking again.
   */
  async write(entry: NewNotification): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `INSERT INTO notification (user_id, kind, subject_type, subject_id, source_id, dedupe_key)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT DO NOTHING`,
      [
        entry.userId,
        entry.kind,
        entry.subjectType,
        entry.subjectId,
        entry.sourceId ?? null,
        entry.dedupeKey ?? null,
      ],
    );
    return rowCount === 1;
  }

  /**
   * Which kinds this member has turned off.
   *
   * Only the departures, because that is all the table holds (T-270). The
   * defaults are overlaid in the service, where `NOTIFICATION_DEFAULTS` lives.
   */
  async mutedKinds(userId: string): Promise<Set<string>> {
    const { rows } = await this.pool.query<{ kind: string }>(
      `SELECT kind FROM notification_preference WHERE user_id = $1 AND in_product = false`,
      [userId],
    );
    return new Set(rows.map((row) => row.kind));
  }

  /** One member's inbox, newest first, only what is deliverable now (T-272). */
  async inbox(userId: string, limit: number): Promise<NotificationRow[]> {
    const { rows } = await this.pool.query<NotificationRow>(
      `SELECT n.id,
              n.kind,
              n.subject_type,
              n.subject_id,
              source.username AS source,
              n.created_at,
              n.read_at,
              n.held_reason
         FROM notification n
         LEFT JOIN user_account source ON source.id = n.source_id
        WHERE n.user_id = $1 AND n.deliver_after <= now()
        ORDER BY n.created_at DESC
        LIMIT $2`,
      [userId, limit],
    );
    return rows;
  }

  /** How many are unread across the whole inbox, not just a page. */
  async unreadCount(userId: string): Promise<number> {
    const { rows } = await this.pool.query<{ unread: string }>(
      `SELECT count(*)::text AS unread
         FROM notification
        WHERE user_id = $1 AND read_at IS NULL AND deliver_after <= now()`,
      [userId],
    );
    return Number(rows[0]?.unread ?? '0');
  }

  /** Mark everything deliverable as read. Returns how many changed. */
  async readAll(userId: string): Promise<number> {
    const { rowCount } = await this.pool.query(
      `UPDATE notification SET read_at = now()
        WHERE user_id = $1 AND read_at IS NULL AND deliver_after <= now()`,
      [userId],
    );
    return rowCount ?? 0;
  }

  /** Mark one as read. `false` when it is not theirs, which is also 404 above. */
  async read(notificationId: string, userId: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `UPDATE notification SET read_at = now()
        WHERE id = $1 AND user_id = $2 AND read_at IS NULL`,
      [notificationId, userId],
    );
    return rowCount === 1;
  }
}
