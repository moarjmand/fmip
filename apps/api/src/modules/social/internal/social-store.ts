/**
 * The SQL for the social graph (T-201). All of it, and nothing else.
 *
 * Two conventions run through every statement here.
 *
 * **The pair is ordered by the database.** `friendship` stores `low_id` and
 * `high_id` under a CHECK (T-200), so every statement writes and reads
 * `LEAST($1::uuid, $2::uuid), GREATEST($1::uuid, $2::uuid)`. The casts are not
 * decoration: without them Postgres infers `text` for the parameters and the
 * insert fails at run time with a type error, which is the sort of thing that
 * passes review and fails in production.
 *
 * **The rules are not here.** A block is enforced by trigger, an ordered pair
 * by a CHECK, a self-request by a CHECK. This file writes what the service
 * decided and lets the database refuse what it must; it never re-implements a
 * refusal, because two copies of a safety rule are one copy and one decoration.
 */

import type { Pool } from 'pg';

export interface MemberRow {
  id: string;
  username: string;
  display_name: string;
  email_verified: boolean;
}

export interface FriendRow {
  username: string;
  display_name: string;
  friends_since: Date;
  /** `count(*)` arrives as a string. */
  mutual: string;
}

export interface RequestRow {
  username: string;
  display_name: string;
  sent_at: Date;
}

export interface BlockRow {
  username: string;
  display_name: string;
  blocked_at: Date;
}

export class SocialStore {
  constructor(private readonly pool: Pool) {}

  async memberByUsername(username: string): Promise<MemberRow | null> {
    const { rows } = await this.pool.query<MemberRow>(
      `SELECT id, username, display_name, email_verified_at IS NOT NULL AS email_verified
         FROM user_account
        WHERE username = lower($1) AND status = 'active'`,
      [username],
    );
    return rows[0] ?? null;
  }

  async areFriends(a: string, b: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `SELECT 1 FROM friendship
        WHERE low_id = LEAST($1::uuid, $2::uuid) AND high_id = GREATEST($1::uuid, $2::uuid)`,
      [a, b],
    );
    return rowCount === 1;
  }

  /**
   * The viewer's friends, each with the number of friends the two have in
   * common.
   *
   * The mutual count is computed over **the viewer's own** friends intersected
   * with the other member's, which is the only form of it that does not read as
   * a window into somebody else's list: every name it could be built from is
   * already the viewer's.
   */
  async friends(viewerId: string): Promise<FriendRow[]> {
    const { rows } = await this.pool.query<FriendRow>(
      `WITH mine AS (
         SELECT CASE WHEN f.low_id = $1 THEN f.high_id ELSE f.low_id END AS friend_id,
                f.created_at
           FROM friendship f
           JOIN user_account u
             ON u.id = CASE WHEN f.low_id = $1 THEN f.high_id ELSE f.low_id END
          WHERE (f.low_id = $1 OR f.high_id = $1) AND u.status = 'active'
       )
       SELECT u.username,
              u.display_name,
              m.created_at AS friends_since,
              (SELECT count(*)
                 FROM friendship f2
                 JOIN mine other
                   ON other.friend_id = CASE WHEN f2.low_id = m.friend_id
                                             THEN f2.high_id ELSE f2.low_id END
                WHERE f2.low_id = m.friend_id OR f2.high_id = m.friend_id) AS mutual
         FROM mine m
         JOIN user_account u ON u.id = m.friend_id
        ORDER BY u.display_name, u.username`,
      [viewerId],
    );
    return rows;
  }

  async incoming(viewerId: string): Promise<RequestRow[]> {
    const { rows } = await this.pool.query<RequestRow>(
      `SELECT u.username, u.display_name, r.created_at AS sent_at
         FROM friend_request r
         JOIN user_account u ON u.id = r.requester_id
        WHERE r.addressee_id = $1 AND u.status = 'active'
        ORDER BY r.created_at DESC`,
      [viewerId],
    );
    return rows;
  }

  async outgoing(viewerId: string): Promise<RequestRow[]> {
    const { rows } = await this.pool.query<RequestRow>(
      `SELECT u.username, u.display_name, r.created_at AS sent_at
         FROM friend_request r
         JOIN user_account u ON u.id = r.addressee_id
        WHERE r.requester_id = $1 AND u.status = 'active'
        ORDER BY r.created_at DESC`,
      [viewerId],
    );
    return rows;
  }

  async blocks(viewerId: string): Promise<BlockRow[]> {
    const { rows } = await this.pool.query<BlockRow>(
      `SELECT u.username, u.display_name, b.created_at AS blocked_at
         FROM user_block b
         JOIN user_account u ON u.id = b.blocked_id
        WHERE b.blocker_id = $1
        ORDER BY b.created_at DESC`,
      [viewerId],
    );
    return rows;
  }

  /** `true` when the row was created, `false` when it was already there. */
  async request(requesterId: string, addresseeId: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `INSERT INTO friend_request (requester_id, addressee_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [requesterId, addresseeId],
    );
    return rowCount === 1;
  }

  /**
   * Accept: the friendship and the withdrawal of every open request between the
   * two, in one transaction.
   *
   * One transaction because the alternative leaves a pair who are friends and
   * still have a request outstanding, which shows up as a member being asked to
   * befriend somebody they already have. Returns `false` when there was nothing
   * to accept, so a double-tap is not an error.
   */
  async accept(viewerId: string, otherId: string): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rowCount } = await client.query(
        `DELETE FROM friend_request WHERE requester_id = $1 AND addressee_id = $2`,
        [otherId, viewerId],
      );
      if (rowCount !== 1) {
        await client.query('ROLLBACK');
        return false;
      }
      await client.query(
        `DELETE FROM friend_request
          WHERE requester_id = $1 AND addressee_id = $2`,
        [viewerId, otherId],
      );
      await client.query(
        `INSERT INTO friendship (low_id, high_id)
         VALUES (LEAST($1::uuid, $2::uuid), GREATEST($1::uuid, $2::uuid))
         ON CONFLICT DO NOTHING`,
        [viewerId, otherId],
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

  /**
   * Withdraw every open request between the two, whichever way round it was
   * sent. Declining and cancelling produce the same row and the same visible
   * outcome, and there is no state in which a member wants one of two crossing
   * requests to survive.
   */
  async withdrawRequests(viewerId: string, otherId: string): Promise<number> {
    const { rowCount } = await this.pool.query(
      `DELETE FROM friend_request
        WHERE (requester_id = $1 AND addressee_id = $2)
           OR (requester_id = $2 AND addressee_id = $1)`,
      [viewerId, otherId],
    );
    return rowCount ?? 0;
  }

  async unfriend(viewerId: string, otherId: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `DELETE FROM friendship
        WHERE low_id = LEAST($1::uuid, $2::uuid) AND high_id = GREATEST($1::uuid, $2::uuid)`,
      [viewerId, otherId],
    );
    return rowCount === 1;
  }

  /**
   * Block. The trigger of T-200 ends the friendship and withdraws the open
   * requests; this statement does not, on purpose — a second copy here would be
   * the one that gets edited and drifts.
   */
  async block(viewerId: string, otherId: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO user_block (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [viewerId, otherId],
    );
  }

  async unblock(viewerId: string, otherId: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `DELETE FROM user_block WHERE blocker_id = $1 AND blocked_id = $2`,
      [viewerId, otherId],
    );
    return rowCount === 1;
  }

  /** Which way a block between the two runs, if there is one. */
  async blockDirection(
    viewerId: string,
    otherId: string,
  ): Promise<{ byViewer: boolean; ofViewer: boolean }> {
    const { rows } = await this.pool.query<{ by_viewer: boolean; of_viewer: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM user_block
                       WHERE blocker_id = $1 AND blocked_id = $2) AS by_viewer,
              EXISTS (SELECT 1 FROM user_block
                       WHERE blocker_id = $2 AND blocked_id = $1) AS of_viewer`,
      [viewerId, otherId],
    );
    return { byViewer: rows[0]?.by_viewer ?? false, ofViewer: rows[0]?.of_viewer ?? false };
  }

  async openRequest(
    viewerId: string,
    otherId: string,
  ): Promise<{ sent: boolean; received: boolean }> {
    const { rows } = await this.pool.query<{ sent: boolean; received: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM friend_request
                       WHERE requester_id = $1 AND addressee_id = $2) AS sent,
              EXISTS (SELECT 1 FROM friend_request
                       WHERE requester_id = $2 AND addressee_id = $1) AS received`,
      [viewerId, otherId],
    );
    return { sent: rows[0]?.sent ?? false, received: rows[0]?.received ?? false };
  }
}
