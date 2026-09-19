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
  subject_label: string | null;
  source: string | null;
  created_at: Date;
  read_at: Date | null;
  held_reason: string | null;
}

export interface MuteRow {
  scope: 'team' | 'competition' | 'category';
  target: string;
  label: string | null;
  created_at: Date;
}

/** One notification due to leave the building (T-330): past its hold, recent, and not yet claimed by a carrier. */
export interface DueNotification {
  id: string;
  user_id: string;
  kind: string;
  subject_type: string;
  subject_id: string;
  /** The handle the route needs, resolved as the inbox resolves it; null when the subject no longer resolves. */
  subject_label: string | null;
  /** Who caused it, by username; null for a sourceless kind. */
  source: string | null;
  /** The member's address, for the e-mail channel. */
  email: string;
  /** The member's language, for the route an e-mail or a push opens. */
  locale: string;
}

/** What each channel did with one notification, as `notification_delivery` records it. */
export interface DeliveryRecord {
  email: 'absent' | 'sent' | 'failed';
  push: 'absent' | 'sent' | 'failed';
}

export interface NewNotification {
  userId: string;
  kind: string;
  subjectType: string;
  subjectId: string;
  /** When it may be shown. Omitted means now (T-273). */
  deliverAfter?: string | null;
  /** Why it is waiting, when it is. */
  heldReason?: string | null;
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
      `INSERT INTO notification
         (user_id, kind, subject_type, subject_id, source_id, dedupe_key, deliver_after, held_reason)
       VALUES ($1, $2, $3, $4, $5, $6, coalesce($7::timestamptz, now()), $8)
       ON CONFLICT DO NOTHING`,
      [
        entry.userId,
        entry.kind,
        entry.subjectType,
        entry.subjectId,
        entry.sourceId ?? null,
        entry.dedupeKey ?? null,
        entry.deliverAfter ?? null,
        entry.heldReason ?? null,
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

  // --- mutes (T-331) ----------------------------------------------------

  /** The categories the member silenced as one. */
  async mutedCategories(userId: string): Promise<Set<string>> {
    const { rows } = await this.pool.query<{ target: string }>(
      `SELECT target FROM notification_mute WHERE user_id = $1 AND scope = 'category'`,
      [userId],
    );
    return new Set(rows.map((row) => row.target));
  }

  /**
   * The scope that silences what a notification is about -- `team` or
   * `competition` -- or null. Asked of the database, which knows which match
   * a subject points at; a friend request is about nobody's team and passes.
   */
  async mutedFor(userId: string, subjectType: string, subjectId: string): Promise<string | null> {
    const { rows } = await this.pool.query<{ scope: string | null }>(
      `SELECT notification_muted_for($1, $2, $3) AS scope`,
      [userId, subjectType, subjectId],
    );
    return rows[0]?.scope ?? null;
  }

  /** Every mute, with the team's or competition's name for the page. */
  async mutes(userId: string): Promise<MuteRow[]> {
    const { rows } = await this.pool.query<MuteRow>(
      `SELECT m.scope, m.target, m.created_at,
              CASE m.scope
                WHEN 'team' THEN (SELECT name FROM team WHERE id = m.target::uuid)
                WHEN 'competition' THEN (SELECT name FROM competition WHERE id = m.target::uuid)
              END AS label
         FROM notification_mute m
        WHERE m.user_id = $1
        ORDER BY m.scope, label NULLS LAST, m.target`,
      [userId],
    );
    return rows;
  }

  /** Silences a target; `unknown` when it is not a team, competition or category. */
  async mute(userId: string, scope: string, target: string): Promise<'muted' | 'unknown'> {
    try {
      await this.pool.query(
        `INSERT INTO notification_mute (user_id, scope, target) VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [userId, scope, target],
      );
      return 'muted';
    } catch (error: unknown) {
      const code = (error as { code?: string }).code;
      // foreign_key_violation from the trigger, check_violation from the shape,
      // invalid_text_representation should a cast ever run first.
      if (code === '23503' || code === '23514' || code === '22P02') return 'unknown';
      throw error;
    }
  }

  async unmute(userId: string, scope: string, target: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `DELETE FROM notification_mute WHERE user_id = $1 AND scope = $2 AND target = $3`,
      [userId, scope, target],
    );
    return (rowCount ?? 0) > 0;
  }

  /**
   * When this member's quiet window ends, or null when it is not quiet (T-273).
   *
   * Asked of the database rather than computed here, because the window is in
   * the member's own timezone and the wrap-around is the kind of three lines
   * that is wrong the second time somebody writes it.
   */
  async quietUntil(userId: string): Promise<Date | null> {
    const { rows } = await this.pool.query<{ ends: Date | null }>(
      `SELECT quiet_hours_end($1, now()) AS ends`,
      [userId],
    );
    return rows[0]?.ends ?? null;
  }

  /**
   * How many of one kind this member has been sent since the hour began, and
   * the newest of them.
   *
   * The same fixed window `rate_limit` uses (T-213), and the same cost stated
   * the same way: somebody who fills their allowance at the end of one hour and
   * again at the start of the next gets twice the ceiling across that boundary.
   * A sliding window needs every event kept; this needs one count.
   */
  async sentThisHour(
    userId: string,
    kind: string,
  ): Promise<{ count: number; newest: string | null }> {
    const { rows } = await this.pool.query<{ count: string; newest: string | null }>(
      `SELECT count(*)::text AS count,
              (SELECT id FROM notification
                WHERE user_id = $1 AND kind = $2 AND created_at >= date_trunc('hour', now())
                ORDER BY created_at DESC LIMIT 1) AS newest
         FROM notification
        WHERE user_id = $1 AND kind = $2 AND created_at >= date_trunc('hour', now())`,
      [userId, kind],
    );
    return { count: Number(rows[0]?.count ?? '0'), newest: rows[0]?.newest ?? null };
  }

  /**
   * Count one more as held behind an existing notification, and say so.
   *
   * The alternative was a row per suppressed event, which is the flood again
   * with a note attached. One row saying "and fourteen more" is what a member
   * can actually read.
   *
   * The count is incremented in SQL rather than read and written back: two
   * suppressions racing would otherwise both read the same number and one of
   * them would be lost, which is the failure this counter exists to prevent.
   */
  async noteHeldBehind(notificationId: string): Promise<void> {
    await this.pool.query(
      `UPDATE notification
          SET held_count = held_count + 1,
              held_reason = (held_count + 1)::text || ' more like this were held back this hour'
        WHERE id = $1`,
      [notificationId],
    );
  }

  /** Which kinds this member has an opinion about at all, either way. */
  async chosenKinds(userId: string): Promise<Set<string>> {
    const { rows } = await this.pool.query<{ kind: string }>(
      `SELECT kind FROM notification_preference WHERE user_id = $1`,
      [userId],
    );
    return new Set(rows.map((row) => row.kind));
  }

  /** Set or change one. Idempotent: the end state is what was asked for. */
  async setPreference(userId: string, kind: string, inProduct: boolean): Promise<void> {
    await this.pool.query(
      `INSERT INTO notification_preference (user_id, kind, in_product)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, kind) DO UPDATE SET in_product = EXCLUDED.in_product`,
      [userId, kind, inProduct],
    );
  }

  /** The member's quiet window, as they set it, or null. */
  async quietHours(userId: string): Promise<{ starts_at: string; ends_at: string } | null> {
    const { rows } = await this.pool.query<{ starts_at: string; ends_at: string }>(
      // `to_char` rather than the raw `time`, which pg renders as `23:00:00`.
      // The contract says `HH:MM` and the seconds were never asked for.
      `SELECT to_char(starts_at, 'HH24:MI') AS starts_at, to_char(ends_at, 'HH24:MI') AS ends_at
         FROM quiet_hours WHERE user_id = $1`,
      [userId],
    );
    return rows[0] ?? null;
  }

  async setQuietHours(userId: string, starts: string, ends: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO quiet_hours (user_id, starts_at, ends_at)
       VALUES ($1, $2::time, $3::time)
       ON CONFLICT (user_id) DO UPDATE SET starts_at = EXCLUDED.starts_at, ends_at = EXCLUDED.ends_at`,
      [userId, starts, ends],
    );
  }

  async clearQuietHours(userId: string): Promise<void> {
    await this.pool.query(`DELETE FROM quiet_hours WHERE user_id = $1`, [userId]);
  }

  /** One member's inbox, newest first, only what is deliverable now (T-272). */
  async inbox(userId: string, limit: number): Promise<NotificationRow[]> {
    const { rows } = await this.pool.query<NotificationRow>(
      // The handle the client routes by, resolved here because only the
      // database can (T-272). A member is reached at `/u/{username}` and a group
      // at `/groups/{slug}`, while `subject_id` is the canonical UUID (rule 1) --
      // so the pair alone cannot open two of the four things the criterion
      // names. Left null when the subject no longer resolves, and a client
      // without a label renders no link rather than a broken one.
      `SELECT n.id,
              n.kind,
              n.subject_type,
              n.subject_id,
              CASE n.subject_type
                WHEN 'member' THEN subject_member.username
                WHEN 'group' THEN subject_group.slug
                ELSE NULL
              END AS subject_label,
              source.username AS source,
              n.created_at,
              n.read_at,
              n.held_reason
         FROM notification n
         LEFT JOIN user_account source ON source.id = n.source_id
         -- Joined on a cast rather than a foreign key, because the subject is
         -- one of several tables chosen by its type (T-270), and a subject_id
         -- that is not a uuid must not fail the whole query.
         LEFT JOIN user_account subject_member
                ON n.subject_type = 'member'
               AND n.subject_id ~ '^[0-9a-f-]{36}$'
               AND subject_member.id = n.subject_id::uuid
         LEFT JOIN user_group subject_group
                ON n.subject_type = 'group'
               AND n.subject_id ~ '^[0-9a-f-]{36}$'
               AND subject_group.id = n.subject_id::uuid
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

  // --- carrying outward (T-330, T-432) ------------------------------------

  /**
   * Notifications that may leave the building now: past their hold (quiet
   * hours delay, and this respects the delay), **created within the last
   * day**, and with no delivery claim yet. The day is the difference between
   * a channel arriving and a flood: the first carrier after a provider is
   * configured must not send a member everything they were told last month.
   * Oldest first, a page at a time, with the label and the source resolved
   * as the inbox resolves them, because the route and the sentence need them.
   */
  async due(limit = 100): Promise<DueNotification[]> {
    const { rows } = await this.pool.query<DueNotification>(
      `SELECT n.id,
              n.user_id,
              n.kind,
              n.subject_type,
              n.subject_id,
              CASE n.subject_type
                WHEN 'member' THEN subject_member.username
                WHEN 'group' THEN subject_group.slug
                ELSE NULL
              END AS subject_label,
              source.username AS source,
              u.email,
              u.preferred_language AS locale
         FROM notification n
         JOIN user_account u ON u.id = n.user_id
         LEFT JOIN notification_delivery d ON d.notification_id = n.id
         LEFT JOIN user_account source ON source.id = n.source_id
         LEFT JOIN user_account subject_member
                ON n.subject_type = 'member'
               AND n.subject_id ~ '^[0-9a-f-]{36}$'
               AND subject_member.id = n.subject_id::uuid
         LEFT JOIN user_group subject_group
                ON n.subject_type = 'group'
               AND n.subject_id ~ '^[0-9a-f-]{36}$'
               AND subject_group.id = n.subject_id::uuid
        WHERE n.deliver_after <= now()
          AND n.created_at >= now() - interval '1 day'
          AND d.notification_id IS NULL
        ORDER BY n.deliver_after, n.created_at
        LIMIT $1`,
      [limit],
    );
    return rows;
  }

  /**
   * The claim, written before the send and unique per notification: a second
   * carrier finds it taken and returns `false`. This is what makes "never
   * sent twice" a property of the table rather than of the logs.
   */
  async claimDelivery(notificationId: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `INSERT INTO notification_delivery (notification_id) VALUES ($1) ON CONFLICT DO NOTHING`,
      [notificationId],
    );
    return rowCount === 1;
  }

  /** The outcome on each channel, written once; the trigger refuses a second. */
  async recordDelivery(notificationId: string, outcome: DeliveryRecord): Promise<void> {
    await this.pool.query(
      `UPDATE notification_delivery
          SET email = $2, push = $3, carried_at = now()
        WHERE notification_id = $1`,
      [notificationId, outcome.email, outcome.push],
    );
  }
}
