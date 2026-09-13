/**
 * The SQL for conversations (T-221). All of it, and nothing else.
 *
 * The refusals are not here. Who may write, whether a block stands, whether a
 * sanction is in force, whether the sender is over the ceiling, and what number
 * a message gets: all of that is the schema's (T-220). This file writes what the
 * service decided and lets the database refuse what it must.
 */

import type { Pool } from 'pg';

export interface MemberRow {
  id: string;
  username: string;
  display_name: string;
  email_verified: boolean;
}

export interface MessageRow {
  id: string;
  seq: string;
  author: string;
  body: string | null;
  reply_to_id: string | null;
  created_at: Date;
  removed_at: Date | null;
  removed_kind: string | null;
}

export interface ConversationRow {
  id: string;
  kind: string;
  muted: boolean;
  left: boolean;
  last_read_seq: string;
  their_read_seq: string | null;
  unread: string;
  latest_seq: string;
}

export interface ParticipantRow {
  conversation_id: string;
  username: string;
  display_name: string;
}

const MESSAGE_COLUMNS = `m.id, m.seq, u.username AS author, m.body, m.reply_to_id,
                         m.created_at, m.removed_at, m.removed_kind`;

export class ConversationsStore {
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
   * The direct conversation between two members, creating it if it is not
   * there. One transaction, and the unique index of T-220 is what decides — two
   * members tapping "message" at the same moment must not create two histories.
   */
  async openDirect(a: string, b: string): Promise<{ id: string; created: boolean }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: existing } = await client.query<{ id: string }>(
        `SELECT id FROM conversation
          WHERE kind = 'direct'
            AND pair_low = LEAST($1::uuid, $2::uuid)
            AND pair_high = GREATEST($1::uuid, $2::uuid)`,
        [a, b],
      );
      if (existing[0] !== undefined) {
        await client.query('COMMIT');
        return { id: existing[0].id, created: false };
      }

      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO conversation (kind, pair_low, pair_high)
         VALUES ('direct', LEAST($1::uuid, $2::uuid), GREATEST($1::uuid, $2::uuid))
         RETURNING id`,
        [a, b],
      );
      const id = rows[0]?.id ?? '';
      await client.query(
        `INSERT INTO conversation_participant (conversation_id, user_id)
         VALUES ($1, $2), ($1, $3)`,
        [id, a, b],
      );
      await client.query('COMMIT');
      return { id, created: true };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Every conversation the viewer is in, newest activity first.
   *
   * `their_read_seq` is only filled for a direct conversation — the schema
   * carries a read position for every participant, and the product shows
   * somebody else's only when there is exactly one somebody else.
   */
  async conversationsFor(viewerId: string): Promise<ConversationRow[]> {
    const { rows } = await this.pool.query<ConversationRow>(
      `SELECT c.id,
              c.kind,
              me.muted_at IS NOT NULL AS muted,
              me.left_at IS NOT NULL AS left,
              me.last_read_seq,
              CASE WHEN c.kind = 'direct' THEN (
                SELECT p.last_read_seq FROM conversation_participant p
                 WHERE p.conversation_id = c.id AND p.user_id <> $1
                 LIMIT 1
              ) END AS their_read_seq,
              (SELECT count(*) FROM message m
                WHERE m.conversation_id = c.id AND m.seq > me.last_read_seq) AS unread,
              c.next_seq - 1 AS latest_seq
         FROM conversation_participant me
         JOIN conversation c ON c.id = me.conversation_id
        WHERE me.user_id = $1
        ORDER BY c.next_seq > 1 DESC, c.created_at DESC
        LIMIT 200`,
      [viewerId],
    );
    return rows;
  }

  async participantsOf(conversationIds: string[]): Promise<ParticipantRow[]> {
    if (conversationIds.length === 0) return [];
    const { rows } = await this.pool.query<ParticipantRow>(
      `SELECT p.conversation_id, u.username, u.display_name
         FROM conversation_participant p
         JOIN user_account u ON u.id = p.user_id
        WHERE p.conversation_id = ANY($1::uuid[])
        ORDER BY u.username`,
      [conversationIds],
    );
    return rows;
  }

  /** The viewer's own row, or `null` when they are not in it at all. */
  async participation(conversationId: string, viewerId: string): Promise<ConversationRow | null> {
    const { rows } = await this.pool.query<ConversationRow>(
      `SELECT c.id,
              c.kind,
              me.muted_at IS NOT NULL AS muted,
              me.left_at IS NOT NULL AS left,
              me.last_read_seq,
              CASE WHEN c.kind = 'direct' THEN (
                SELECT p.last_read_seq FROM conversation_participant p
                 WHERE p.conversation_id = c.id AND p.user_id <> $2
                 LIMIT 1
              ) END AS their_read_seq,
              (SELECT count(*) FROM message m
                WHERE m.conversation_id = c.id AND m.seq > me.last_read_seq) AS unread,
              c.next_seq - 1 AS latest_seq
         FROM conversation_participant me
         JOIN conversation c ON c.id = me.conversation_id
        WHERE me.conversation_id = $1 AND me.user_id = $2`,
      [conversationId, viewerId],
    );
    return rows[0] ?? null;
  }

  /**
   * A page of messages, oldest first, ending just before `before`.
   *
   * The page is taken newest-first in SQL and reversed, because "the last fifty"
   * is what a reader opens a conversation to see; `before` is a sequence rather
   * than an offset, so a message arriving mid-scroll cannot shift the page under
   * somebody's thumb.
   */
  async page(
    conversationId: string,
    before: number | null,
    limit: number,
  ): Promise<{ messages: MessageRow[]; hasEarlier: boolean }> {
    const { rows } = await this.pool.query<MessageRow>(
      `SELECT ${MESSAGE_COLUMNS}
         FROM message m
         JOIN user_account u ON u.id = m.author_id
        WHERE m.conversation_id = $1 AND ($2::bigint IS NULL OR m.seq < $2::bigint)
        ORDER BY m.seq DESC
        LIMIT $3`,
      [conversationId, before, limit + 1],
    );

    const hasEarlier = rows.length > limit;
    return { messages: rows.slice(0, limit).reverse(), hasEarlier };
  }

  async latest(conversationIds: string[]): Promise<Map<string, MessageRow>> {
    if (conversationIds.length === 0) return new Map();
    const { rows } = await this.pool.query<MessageRow & { conversation_id: string }>(
      `SELECT DISTINCT ON (m.conversation_id) m.conversation_id, ${MESSAGE_COLUMNS}
         FROM message m
         JOIN user_account u ON u.id = m.author_id
        WHERE m.conversation_id = ANY($1::uuid[])
        ORDER BY m.conversation_id, m.seq DESC`,
      [conversationIds],
    );
    return new Map(rows.map((row) => [row.conversation_id, row]));
  }

  async send(
    conversationId: string,
    authorId: string,
    body: string,
    replyTo: string | null,
  ): Promise<MessageRow> {
    const { rows } = await this.pool.query<MessageRow>(
      `WITH written AS (
         INSERT INTO message (conversation_id, author_id, body, reply_to_id)
         VALUES ($1, $2, $3, $4)
         RETURNING id, seq, author_id, body, reply_to_id, created_at, removed_at, removed_kind
       )
       SELECT m.id, m.seq, u.username AS author, m.body, m.reply_to_id, m.created_at,
              m.removed_at, m.removed_kind
         FROM written m JOIN user_account u ON u.id = m.author_id`,
      [conversationId, authorId, body, replyTo],
    );
    return rows[0] as MessageRow;
  }

  /** A reply has to be in the same conversation, or it is a link to nowhere. */
  async replyBelongs(conversationId: string, messageId: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `SELECT 1 FROM message WHERE id = $1 AND conversation_id = $2`,
      [messageId, conversationId],
    );
    return rowCount === 1;
  }

  /**
   * The author takes their own message down. `false` when there was nothing of
   * that id in this conversation still standing — already removed, or not
   * theirs, which are the same answer to a caller.
   */
  async removeOwn(conversationId: string, messageId: string, authorId: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `UPDATE message
          SET body = NULL, removed_at = now(), removed_by = $3, removed_kind = 'author'
        WHERE id = $1 AND conversation_id = $2 AND author_id = $3 AND removed_at IS NULL`,
      [messageId, conversationId, authorId],
    );
    return rowCount === 1;
  }

  /** Read position only ever moves forward: a page that re-renders must not unread anything. */
  async markRead(conversationId: string, viewerId: string, seq: number): Promise<void> {
    await this.pool.query(
      `UPDATE conversation_participant
          SET last_read_seq = GREATEST(last_read_seq, $3)
        WHERE conversation_id = $1 AND user_id = $2`,
      [conversationId, viewerId, seq],
    );
  }

  async setMuted(conversationId: string, viewerId: string, muted: boolean): Promise<void> {
    await this.pool.query(
      `UPDATE conversation_participant SET muted_at = CASE WHEN $3 THEN now() END
        WHERE conversation_id = $1 AND user_id = $2`,
      [conversationId, viewerId, muted],
    );
  }

  async leave(conversationId: string, viewerId: string): Promise<void> {
    await this.pool.query(
      `UPDATE conversation_participant SET left_at = now()
        WHERE conversation_id = $1 AND user_id = $2 AND left_at IS NULL`,
      [conversationId, viewerId],
    );
  }
}
