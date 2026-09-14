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
  card_kind: string | null;
  card_id: string | null;
}

/** What a card resolves to. One row per shared entity, read now, never stored. */
export interface FixtureCardRow {
  id: string;
  home: string;
  away: string;
  home_goals: number | null;
  away_goals: number | null;
  status: string;
  kickoff_at: Date;
  last_updated_at: Date;
}

export interface NamedCardRow {
  id: string;
  name: string;
  short_name: string | null;
}

export interface PredictionCardRow {
  id: string;
  fixture_id: string;
  home: string;
  away: string;
  outcome: string;
  confidence: number;
  by: string;
}

export interface ConversationRow {
  id: string;
  kind: string;
  /** The group this conversation belongs to; both null for a direct one. */
  group_slug: string | null;
  group_name: string | null;
  muted: boolean;
  left: boolean;
  last_read_seq: string;
  their_read_seq: string | null;
  unread: string;
  latest_seq: string;
}

export interface ReactionRow {
  message_id: string;
  reaction: string;
  count: string;
  mine: boolean;
}

export interface MentionRow {
  message_id: string;
  username: string;
}

export interface ParticipantRow {
  conversation_id: string;
  username: string;
  display_name: string;
}

const MESSAGE_COLUMNS = `m.id, m.seq, u.username AS author, m.body, m.reply_to_id,
                         m.created_at, m.removed_at, m.removed_kind, m.card_kind, m.card_id`;

/**
 * The columns every read of a conversation needs, with the membership question
 * asked of whichever table holds it (T-245).
 *
 * A direct conversation's membership is `conversation_participant`. A group's
 * is `group_member`, and the participant row there holds only the read position
 * and the mute -- which is why every column that comes from it is coalesced:
 * for a group member who has never opened the conversation there is no row yet,
 * and its absence means "has read nothing", not "is not here".
 */
const STANDING_COLUMNS = `c.id,
              c.kind,
              me.muted_at IS NOT NULL AS muted,
              COALESCE(me.left_at IS NOT NULL, false) AS left,
              COALESCE(me.last_read_seq, 0) AS last_read_seq,
              g.slug AS group_slug,
              g.name AS group_name,
              CASE WHEN c.kind = 'direct' THEN (
                SELECT p.last_read_seq FROM conversation_participant p
                 WHERE p.conversation_id = c.id AND p.user_id <> $VIEWER
                 LIMIT 1
              ) END AS their_read_seq,
              (SELECT count(*) FROM message m
                WHERE m.conversation_id = c.id AND m.seq > COALESCE(me.last_read_seq, 0)) AS unread,
              c.next_seq - 1 AS latest_seq`;

/** Joined the same way wherever the columns above are read. */
const STANDING_FROM = `FROM conversation c
         LEFT JOIN conversation_participant me
                ON me.conversation_id = c.id AND me.user_id = $VIEWER
         LEFT JOIN user_group g ON g.id = c.group_id`;

/**
 * True when the viewer is in this conversation *now*.
 *
 * The group half is the acceptance criterion of T-245: it reads `group_member`,
 * so a membership change takes effect on the conversation with nothing to
 * synchronise and nothing that can drift.
 */
const STANDING_WHERE = `(
           (c.kind <> 'group' AND me.user_id IS NOT NULL)
           OR (c.kind = 'group' AND EXISTS (
                 SELECT 1 FROM group_member gm
                  WHERE gm.group_id = c.group_id AND gm.user_id = $VIEWER))
         )`;

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
      `SELECT ${STANDING_COLUMNS.replaceAll('$VIEWER', '$1')}
         ${STANDING_FROM.replaceAll('$VIEWER', '$1')}
        WHERE ${STANDING_WHERE.replaceAll('$VIEWER', '$1')}
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

  /**
   * The viewer's own row, or `null` when they are not in it at all.
   *
   * The single place this module asks "is this viewer in this conversation" --
   * the page, the search, the catch-up, the socket's subscribe and the socket's
   * delivery re-check all come through here. Teaching *this* query about groups
   * is what makes a membership change immediate on every one of them at once
   * (T-245).
   */
  async participation(conversationId: string, viewerId: string): Promise<ConversationRow | null> {
    const { rows } = await this.pool.query<ConversationRow>(
      `SELECT ${STANDING_COLUMNS.replaceAll('$VIEWER', '$2')}
         ${STANDING_FROM.replaceAll('$VIEWER', '$2')}
        WHERE c.id = $1 AND ${STANDING_WHERE.replaceAll('$VIEWER', '$2')}`,
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

  /**
   * Messages in one conversation whose text contains the term, newest first.
   *
   * `search_key` on both sides, so the comparison is the one the rest of the
   * product already makes (T-038, T-152) and behaves the same in every script it
   * has been taught. Removed messages are skipped: a tombstone has no body to
   * find, and returning one would be a search result that says nothing.
   */
  async search(
    conversationId: string,
    term: string,
    limit: number,
  ): Promise<{ messages: MessageRow[]; more: boolean }> {
    const { rows } = await this.pool.query<MessageRow>(
      `SELECT ${MESSAGE_COLUMNS}
         FROM message m
         JOIN user_account u ON u.id = m.author_id
        WHERE m.conversation_id = $1
          AND m.removed_at IS NULL
          AND search_key(m.body) LIKE '%' || search_key($2) || '%'
        ORDER BY m.seq DESC
        LIMIT $3`,
      [conversationId, term, limit + 1],
    );
    return { messages: rows.slice(0, limit), more: rows.length > limit };
  }

  /**
   * Messages after a sequence, oldest first: what a returning client missed.
   *
   * The mirror of `page`, and deliberately a separate query rather than a
   * direction flag on that one -- paging back and catching up want opposite
   * orders and opposite answers to "is there more", and one function doing both
   * would be a boolean argument that inverts the meaning of its own result.
   */
  async after(
    conversationId: string,
    seq: number,
    limit: number,
  ): Promise<{ messages: MessageRow[]; more: boolean }> {
    const { rows } = await this.pool.query<MessageRow>(
      `SELECT ${MESSAGE_COLUMNS}
         FROM message m
         JOIN user_account u ON u.id = m.author_id
        WHERE m.conversation_id = $1 AND m.seq > $2::bigint
        ORDER BY m.seq ASC
        LIMIT $3`,
      [conversationId, seq, limit + 1],
    );
    return { messages: rows.slice(0, limit), more: rows.length > limit };
  }

  /**
   * Messages in these conversations that share this card and still stand.
   *
   * Scoped to a caller-supplied set of conversations rather than the whole
   * table, because the caller is the gateway and the only conversations worth
   * asking about are the ones a socket is watching right now.
   */
  async messagesSharing(
    conversationIds: string[],
    cardKind: string,
    cardId: string,
    limit: number,
  ): Promise<{ conversation_id: string; id: string }[]> {
    if (conversationIds.length === 0) return [];
    const { rows } = await this.pool.query<{ conversation_id: string; id: string }>(
      `SELECT m.conversation_id, m.id
         FROM message m
        WHERE m.conversation_id = ANY($1::uuid[])
          AND m.card_kind = $2
          AND m.card_id = $3
          AND m.removed_at IS NULL
        ORDER BY m.seq DESC
        LIMIT $4`,
      [conversationIds, cardKind, cardId, limit],
    );
    return rows;
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

  /**
   * The reactions, mentions and pins on a set of messages.
   *
   * Three queries for a page rather than three per message, and all three keyed
   * by message id so the caller stitches without another round trip.
   */
  async marks(
    messageIds: string[],
    viewerId: string,
  ): Promise<{ reactions: ReactionRow[]; mentions: MentionRow[]; pinned: Set<string> }> {
    if (messageIds.length === 0) {
      return { reactions: [], mentions: [], pinned: new Set() };
    }

    const [reactions, mentions, pins] = await Promise.all([
      this.pool.query<ReactionRow>(
        `SELECT message_id,
                reaction,
                count(*) AS count,
                bool_or(user_id = $2) AS mine
           FROM message_reaction
          WHERE message_id = ANY($1::uuid[])
          GROUP BY message_id, reaction
          ORDER BY reaction`,
        [messageIds, viewerId],
      ),
      this.pool.query<MentionRow>(
        `SELECT mm.message_id, u.username
           FROM message_mention mm
           JOIN user_account u ON u.id = mm.user_id
          WHERE mm.message_id = ANY($1::uuid[])
          ORDER BY u.username`,
        [messageIds],
      ),
      this.pool.query<{ message_id: string }>(
        `SELECT message_id FROM conversation_pin WHERE message_id = ANY($1::uuid[])`,
        [messageIds],
      ),
    ]);

    return {
      reactions: reactions.rows,
      mentions: mentions.rows,
      pinned: new Set(pins.rows.map((row) => row.message_id)),
    };
  }

  /** Every pinned message in a conversation, newest pin first. */
  async pins(conversationId: string): Promise<MessageRow[]> {
    const { rows } = await this.pool.query<MessageRow>(
      `SELECT ${MESSAGE_COLUMNS}
         FROM conversation_pin p
         JOIN message m ON m.id = p.message_id
         JOIN user_account u ON u.id = m.author_id
        WHERE p.conversation_id = $1
        ORDER BY p.pinned_at DESC
        LIMIT 20`,
      [conversationId],
    );
    return rows;
  }

  /** The members of a conversation, by username, for resolving a mention. */
  async participantIdsByUsername(conversationId: string): Promise<Map<string, string>> {
    const { rows } = await this.pool.query<{ username: string; user_id: string }>(
      `SELECT u.username, p.user_id
         FROM conversation_participant p
         JOIN user_account u ON u.id = p.user_id
        WHERE p.conversation_id = $1 AND p.left_at IS NULL`,
      [conversationId],
    );
    return new Map(rows.map((row) => [row.username, row.user_id]));
  }

  async mention(messageId: string, userIds: string[]): Promise<void> {
    if (userIds.length === 0) return;
    await this.pool.query(
      `INSERT INTO message_mention (message_id, user_id)
       SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING`,
      [messageId, userIds],
    );
  }

  /** `true` when the reaction was added, `false` when it was already there. */
  async react(messageId: string, userId: string, reaction: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `INSERT INTO message_reaction (message_id, user_id, reaction) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [messageId, userId, reaction],
    );
    return rowCount === 1;
  }

  async unreact(messageId: string, userId: string, reaction: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM message_reaction WHERE message_id = $1 AND user_id = $2 AND reaction = $3`,
      [messageId, userId, reaction],
    );
  }

  async pin(conversationId: string, messageId: string, userId: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO conversation_pin (conversation_id, message_id, pinned_by)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [conversationId, messageId, userId],
    );
  }

  async unpin(conversationId: string, messageId: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM conversation_pin WHERE conversation_id = $1 AND message_id = $2`,
      [conversationId, messageId],
    );
  }

  async messageInConversation(conversationId: string, messageId: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `SELECT 1 FROM message WHERE id = $1 AND conversation_id = $2`,
      [messageId, conversationId],
    );
    return rowCount === 1;
  }

  async send(
    conversationId: string,
    authorId: string,
    body: string | null,
    replyTo: string | null,
    cardKind: string | null,
    cardId: string | null,
  ): Promise<MessageRow> {
    const { rows } = await this.pool.query<MessageRow>(
      `WITH written AS (
         INSERT INTO message (conversation_id, author_id, body, reply_to_id, card_kind, card_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, seq, author_id, body, reply_to_id, created_at, removed_at, removed_kind,
                   card_kind, card_id
       )
       SELECT m.id, m.seq, u.username AS author, m.body, m.reply_to_id, m.created_at,
              m.removed_at, m.removed_kind, m.card_kind, m.card_id
         FROM written m JOIN user_account u ON u.id = m.author_id`,
      [conversationId, authorId, body, replyTo, cardKind, cardId],
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
          SET body = NULL, card_kind = NULL, card_id = NULL,
              removed_at = now(), removed_by = $3, removed_kind = 'author'
        WHERE id = $1 AND conversation_id = $2 AND author_id = $3 AND removed_at IS NULL`,
      [messageId, conversationId, authorId],
    );
    return rowCount === 1;
  }

  /** Read position only ever moves forward: a page that re-renders must not unread anything. */
  /**
   * An upsert, because a group member has no participant row until they open
   * the conversation (T-245): in a group that row is a read position and a
   * mute, not a membership, so it is written when there is something to
   * remember rather than when somebody joins.
   */
  async markRead(conversationId: string, viewerId: string, seq: number): Promise<void> {
    await this.pool.query(
      `INSERT INTO conversation_participant (conversation_id, user_id, last_read_seq)
       VALUES ($1, $2, $3)
       ON CONFLICT (conversation_id, user_id)
       DO UPDATE SET last_read_seq = GREATEST(conversation_participant.last_read_seq, $3)`,
      [conversationId, viewerId, seq],
    );
  }

  async setMuted(conversationId: string, viewerId: string, muted: boolean): Promise<void> {
    await this.pool.query(
      `INSERT INTO conversation_participant (conversation_id, user_id, muted_at)
       VALUES ($1, $2, CASE WHEN $3 THEN now() END)
       ON CONFLICT (conversation_id, user_id)
       DO UPDATE SET muted_at = CASE WHEN $3 THEN now() END`,
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

// ---------------------------------------------------------------------------
// Resolving a card (T-222)
// ---------------------------------------------------------------------------

/**
 * The reads behind a shared card.
 *
 * They are `SELECT`s against the shared schema rather than calls into the
 * fixtures, catalog and predictions services, and that is the same call the
 * consensus store made (T-134): what this needs is one row per shared entity in
 * one query per kind, and asking three public services would be the same answer
 * assembled by hand, one round trip per card. No TypeScript crosses a boundary
 * here; the tables are the shared schema every store reads.
 */
export class CardStore {
  constructor(private readonly pool: Pool) {}

  /** Whether the entity exists, asked once before a card is stored (rule 1). */
  async exists(kind: string, id: string): Promise<boolean> {
    const table = {
      fixture: 'fixture',
      team: 'team',
      person: 'person',
      prediction: 'user_prediction',
    }[kind];
    if (table === undefined) return false;

    // The table name is chosen from a closed map above, never from the request.
    const { rowCount } = await this.pool.query(`SELECT 1 FROM ${table} WHERE id = $1`, [id]);
    return rowCount === 1;
  }

  /** A member may share their own prediction, and nobody else's (T-056). */
  async ownsPrediction(userId: string, predictionId: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `SELECT 1 FROM user_prediction WHERE id = $1 AND user_id = $2`,
      [predictionId, userId],
    );
    return rowCount === 1;
  }

  async fixtures(ids: string[]): Promise<Map<string, FixtureCardRow>> {
    if (ids.length === 0) return new Map();
    const { rows } = await this.pool.query<FixtureCardRow>(
      `SELECT f.id,
              home_team.name AS home,
              away_team.name AS away,
              s.home AS home_goals,
              s.away AS away_goals,
              f.status,
              f.kickoff_at,
              GREATEST(f.updated_at, coalesce(s.updated_at, f.updated_at)) AS last_updated_at
         FROM fixture f
         JOIN fixture_participant hp ON hp.fixture_id = f.id AND hp.side = 'home'
         JOIN team home_team ON home_team.id = hp.team_id
         JOIN fixture_participant ap ON ap.fixture_id = f.id AND ap.side = 'away'
         JOIN team away_team ON away_team.id = ap.team_id
         LEFT JOIN LATERAL (
           SELECT home, away, updated_at FROM fixture_score
            WHERE fixture_id = f.id AND kind IN ('current', 'full_time')
            ORDER BY CASE kind WHEN 'full_time' THEN 0 ELSE 1 END
            LIMIT 1
         ) s ON true
        WHERE f.id = ANY($1::uuid[])`,
      [ids],
    );
    return new Map(rows.map((row) => [row.id, row]));
  }

  async teams(ids: string[]): Promise<Map<string, NamedCardRow>> {
    if (ids.length === 0) return new Map();
    const { rows } = await this.pool.query<NamedCardRow>(
      `SELECT id, name, short_name FROM team WHERE id = ANY($1::uuid[])`,
      [ids],
    );
    return new Map(rows.map((row) => [row.id, row]));
  }

  async people(ids: string[]): Promise<Map<string, NamedCardRow>> {
    if (ids.length === 0) return new Map();
    const { rows } = await this.pool.query<NamedCardRow>(
      `SELECT id, coalesce(known_as, full_name) AS name, NULL::text AS short_name
         FROM person WHERE id = ANY($1::uuid[])`,
      [ids],
    );
    return new Map(rows.map((row) => [row.id, row]));
  }

  async predictions(ids: string[]): Promise<Map<string, PredictionCardRow>> {
    if (ids.length === 0) return new Map();
    const { rows } = await this.pool.query<PredictionCardRow>(
      `SELECT up.id,
              up.fixture_id,
              home_team.name AS home,
              away_team.name AS away,
              v.outcome,
              v.confidence,
              u.username AS by
         FROM user_prediction up
         JOIN user_account u ON u.id = up.user_id
         JOIN fixture_participant hp ON hp.fixture_id = up.fixture_id AND hp.side = 'home'
         JOIN team home_team ON home_team.id = hp.team_id
         JOIN fixture_participant ap ON ap.fixture_id = up.fixture_id AND ap.side = 'away'
         JOIN team away_team ON away_team.id = ap.team_id
         JOIN LATERAL (
           SELECT outcome, confidence FROM prediction_version
            WHERE prediction_id = up.id ORDER BY version_number DESC LIMIT 1
         ) v ON true
        WHERE up.id = ANY($1::uuid[])`,
      [ids],
    );
    return new Map(rows.map((row) => [row.id, row]));
  }
}
