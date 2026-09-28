import { Inject, Injectable } from '@nestjs/common';
import { Pool, type PoolClient } from 'pg';
import { PG_POOL } from '../../../database/database.module';

/** What one deletion did, beyond the account itself. Goes into the audit row's `next`. */
export interface DeletionSummary {
  groups_handed_over: number;
  groups_deleted: number;
  groups_closed: number;
  analyses_taken_down: number;
  grants_withdrawn: number;
}

export interface DeletionAudit {
  /** The member themselves for self-service; an administrator otherwise. */
  actorId: string;
  reason: string;
}

/**
 * The one transaction that deletes an account (T-812, D-094).
 *
 * **Why this touches other boundaries' tables.** "In one transaction" is the
 * acceptance criterion, and a deletion that half-happened -- the sessions gone
 * but the profile still public, or the password gone but the friendships
 * still there -- is worse than either end. So the statements live together
 * here, in the boundary that owns the account, and every table they touch is
 * named in D-094. Nothing here *reads* another boundary's rules; it only
 * removes a member's rows, and the reads everywhere else already filter on
 * `user_account.status = 'active'`.
 *
 * **The row stays.** Predictions, settlements, rating snapshots, points,
 * reports, moderation decisions and the audit trail hold the account with
 * ON DELETE RESTRICT, and rule 8 needs the settlements. So the account becomes
 * a tombstone: status `deleted`, a `deleted_…` username no live account may
 * take, a placeholder name, an address at `.invalid`, and every preference
 * back at its default.
 */
@Injectable()
export class PostgresAccountDeletionStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** The active account's username and password hash, or null. */
  async credentialsOf(
    userId: string,
  ): Promise<{ username: string; passwordHash: string | null } | null> {
    const { rows } = await this.pool.query<{ username: string; secret_hash: string | null }>(
      `SELECT u.username, c.secret_hash
         FROM user_account u
         LEFT JOIN credential c ON c.user_id = u.id AND c.kind = 'password'
        WHERE u.id = $1 AND u.status = 'active'`,
      [userId],
    );
    const row = rows[0];
    return row === undefined ? null : { username: row.username, passwordHash: row.secret_hash };
  }

  /**
   * Deletes the account. Null when there is no active account to delete (an
   * unknown id, or one already deleted -- deleting twice is not a second
   * audit row).
   */
  async delete(userId: string, audit: DeletionAudit): Promise<DeletionSummary | null> {
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const summary = await this.run(client, userId, audit);
      await client.query(summary === null ? 'ROLLBACK' : 'COMMIT');
      return summary;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async run(
    client: PoolClient,
    userId: string,
    audit: DeletionAudit,
  ): Promise<DeletionSummary | null> {
    const q = (sql: string) => client.query(sql, [userId]);

    const current = await client.query<{ username: string; status: string }>(
      `SELECT username, status FROM user_account WHERE id = $1 FOR UPDATE`,
      [userId],
    );
    const account = current.rows[0];
    if (account === undefined || account.status !== 'active') return null;

    // 1. The username is retired before it is replaced (D-094: never reusable).
    await client.query(
      `INSERT INTO retired_username (username) VALUES ($1) ON CONFLICT DO NOTHING`,
      [account.username],
    );

    // 2. The tombstone. Status first in the same statement, so the retired-name
    //    trigger sees a deleted account taking a `deleted_` name.
    await client.query(
      `UPDATE user_account
          SET status = 'deleted',
              username = 'deleted_' || substr(md5(gen_random_uuid()::text), 1, 12),
              display_name = 'Deleted member',
              email = 'deleted-' || id::text || '@deleted.invalid',
              email_verified_at = NULL,
              viewing_territory = NULL,
              first_run_done_at = NULL,
              preferred_language = 'en',
              timezone = 'UTC',
              theme = 'system',
              text_size = 'default',
              contrast = 'system',
              motion = 'system'
        WHERE id = $1`,
      [userId],
    );

    // 3. Credentials, sessions and e-mail tokens: nobody signs in as this again.
    await q(`DELETE FROM session WHERE user_id = $1`);
    await q(`DELETE FROM credential WHERE user_id = $1`);
    await q(`DELETE FROM email_token WHERE user_id = $1`);
    await q(`DELETE FROM user_role WHERE user_id = $1`);

    // 4. The profile and every preference.
    await q(`DELETE FROM profile WHERE user_id = $1`);
    await client.query(
      `INSERT INTO privacy_setting (user_id, profile_visibility, prediction_history_visibility)
       VALUES ($1, 'private', 'private')
       ON CONFLICT (user_id) DO UPDATE
         SET profile_visibility = 'private', prediction_history_visibility = 'private'`,
      [userId],
    );
    await q(`DELETE FROM followed_entity WHERE user_id = $1`);
    await q(`DELETE FROM notification_preference WHERE user_id = $1`);
    await q(`DELETE FROM notification_mute WHERE user_id = $1`);
    await q(`DELETE FROM quiet_hours WHERE user_id = $1`);
    await q(`DELETE FROM push_subscription WHERE user_id = $1`);
    await q(`DELETE FROM rate_window WHERE user_id = $1`);
    await q(`DELETE FROM member_briefing WHERE user_id = $1`);
    await q(`DELETE FROM saved_article WHERE user_id = $1`);

    // 5. The social graph, both directions.
    await q(`DELETE FROM member_follow WHERE follower_id = $1 OR followed_id = $1`);
    await q(`DELETE FROM friendship WHERE low_id = $1 OR high_id = $1`);
    await q(`DELETE FROM friend_request WHERE requester_id = $1 OR addressee_id = $1`);
    await q(`DELETE FROM user_block WHERE blocker_id = $1 OR blocked_id = $1`);

    // 6. Groups (D-057: exactly one owner). Each group this member owns goes
    //    to its longest-standing moderator, else its longest-standing member;
    //    a group with nobody else in it is deleted, or -- when a conversation
    //    in it holds messages, which are never deleted -- closed: made
    //    invite-only with the tombstone as its nominal owner, so nobody can
    //    find it or get in, and what former members wrote is kept.
    const owned = await client.query<{ group_id: string; heir: string | null; spoken: boolean }>(
      `SELECT gm.group_id,
              (SELECT other.user_id FROM group_member other
                WHERE other.group_id = gm.group_id AND other.user_id <> $1
                ORDER BY (other.role = 'moderator') DESC, other.joined_at, other.user_id
                LIMIT 1) AS heir,
              EXISTS (SELECT 1 FROM conversation c JOIN message m ON m.conversation_id = c.id
                       WHERE c.group_id = gm.group_id) AS spoken
         FROM group_member gm
        WHERE gm.user_id = $1 AND gm.role = 'owner'`,
      [userId],
    );
    const closed = owned.rows.filter((g) => g.heir === null && g.spoken).map((g) => g.group_id);
    const emptied = owned.rows.filter((g) => g.heir === null && !g.spoken).map((g) => g.group_id);
    const handed = owned.rows.filter((g) => g.heir !== null);

    await client.query(
      `DELETE FROM group_member WHERE user_id = $1 AND NOT (group_id = ANY($2::uuid[]))`,
      [userId, closed],
    );
    for (const group of handed) {
      await client.query(
        `UPDATE group_member SET role = 'owner' WHERE group_id = $1 AND user_id = $2`,
        [group.group_id, group.heir],
      );
    }
    if (emptied.length > 0) {
      await client.query(`DELETE FROM user_group WHERE id = ANY($1::uuid[])`, [emptied]);
    }
    if (closed.length > 0) {
      await client.query(
        `UPDATE user_group SET visibility = 'invite_only' WHERE id = ANY($1::uuid[])`,
        [closed],
      );
    }
    await q(`DELETE FROM group_invite WHERE invitee_id = $1 OR invited_by = $1`);
    await q(`DELETE FROM group_join_request WHERE user_id = $1`);

    // 7. Conversations: the member leaves every one. Their messages stay,
    //    under the tombstone's name ("a deleted member" on the page).
    await q(
      `UPDATE conversation_participant SET left_at = now()
        WHERE user_id = $1 AND left_at IS NULL`,
    );

    // 8. Community analysis is taken down: its versions are immutable, so the
    //    public reads drop an author who is not active, and the unsubmitted
    //    drafts -- the member's own unpublished words -- go.
    const analyses = await client.query<{ n: string }>(
      `SELECT count(DISTINCT a.id)::text AS n
         FROM community_analysis a
         JOIN community_analysis_version v ON v.analysis_id = a.id
        WHERE a.author_id = $1`,
      [userId],
    );
    await q(
      `DELETE FROM community_analysis_draft
        WHERE analysis_id IN (SELECT id FROM community_analysis WHERE author_id = $1)`,
    );

    // 9. A live contributor grant is withdrawn, so no page calls the tombstone
    //    an approved contributor (T-250's events are the grant's history).
    const grants = await client.query(
      `INSERT INTO contributor_grant_event (grant_id, kind, actor_id, reason)
       SELECT g.id, 'withdrawn', $2, 'The account was deleted.'
         FROM contributor_grant g
        WHERE g.user_id = $1 AND contributor_grant_standing(g.id) IN ('active', 'paused')`,
      [userId, audit.actorId],
    );

    const summary: DeletionSummary = {
      groups_handed_over: handed.length,
      groups_deleted: emptied.length,
      groups_closed: closed.length,
      analyses_taken_down: Number(analyses.rows[0]?.n ?? 0),
      grants_withdrawn: grants.rowCount ?? 0,
    };

    // 10. The audit row (rule 10). `previous` is the status only: writing the
    //     old username or address here would keep exactly what was deleted.
    await client.query(
      `INSERT INTO audit_log (actor_id, action, target_type, target_id, reason, previous, next)
       VALUES ($1, 'account.delete', 'user_account', $2, $3, $4::jsonb, $5::jsonb)`,
      [
        audit.actorId,
        userId,
        audit.reason,
        JSON.stringify({ status: 'active' }),
        JSON.stringify({ status: 'deleted', ...summary }),
      ],
    );
    return summary;
  }
}
