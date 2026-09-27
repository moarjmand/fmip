import type { Pool, PoolClient } from 'pg';
import type { PollRecord, ValidPoll } from './polls';

/** How many polls a group page lists: every open one (at most three) and the latest closed. */
export const POLL_LIST_LIMIT = 20;

interface PollRow {
  id: string;
  question: string;
  created_by: string | null;
  creator_username: string | null;
  created_at: Date;
  closes_at: Date;
  closed_at: Date | null;
  now: Date;
  my_vote: string | null;
}

interface OptionRow {
  poll_id: string;
  id: string;
  label: string;
  votes: number;
}

/**
 * Every statement group polls make (T-643, D-091). The rules -- who may write,
 * whether a poll is open, the ceiling of three, that nothing asked is ever
 * rewritten -- are the schema's; this writes what it is told and lets the
 * database refuse. The one thing it decides is what a read returns: counts
 * per option, and never who cast a vote.
 */
export class PollsStore {
  constructor(private readonly pool: Pool) {}

  /** The poll and its options in one transaction: the options are checked at commit. */
  async create(groupId: string, userId: string, poll: ValidPoll): Promise<string> {
    return this.inTransaction(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO group_poll (group_id, created_by, question, closes_at)
         VALUES ($1::uuid, $2::uuid, $3::text, now() + make_interval(hours => $4::int))
         RETURNING id`,
        [groupId, userId, poll.question, poll.hours],
      );
      const id = rows[0]!.id;
      await client.query(
        `INSERT INTO group_poll_option (poll_id, position, label)
         SELECT $1::uuid, o.position::smallint, o.label
           FROM unnest($2::text[]) WITH ORDINALITY AS o(label, position)`,
        [id, poll.options],
      );
      return id;
    });
  }

  /**
   * The group's polls that were not removed, as `viewerId` sees them: open
   * ones first, closing soonest first, then the most recently closed. With
   * `pollId`, that one poll or nothing.
   */
  async list(
    groupId: string,
    viewerId: string,
    pollId: string | null = null,
    limit = POLL_LIST_LIMIT,
  ): Promise<PollRecord[]> {
    const { rows } = await this.pool.query<PollRow>(
      `SELECT p.id, p.question, p.created_by, u.username AS creator_username,
              p.created_at, p.closes_at, p.closed_at, now() AS now,
              (SELECT v.option_id FROM group_poll_vote v
                WHERE v.poll_id = p.id AND v.user_id = $2::uuid) AS my_vote
         FROM group_poll p
         LEFT JOIN user_account u ON u.id = p.created_by
        WHERE p.group_id = $1::uuid
          AND p.removed_at IS NULL
          AND ($3::uuid IS NULL OR p.id = $3::uuid)
        ORDER BY (p.closed_at IS NULL AND p.closes_at > now()) DESC,
                 CASE WHEN p.closed_at IS NULL AND p.closes_at > now() THEN p.closes_at END ASC,
                 coalesce(p.closed_at, p.closes_at) DESC,
                 p.id
        LIMIT $4::int`,
      [groupId, viewerId, pollId, limit],
    );
    if (rows.length === 0) return [];

    const options = await this.pool.query<OptionRow>(
      `SELECT o.poll_id, o.id, o.label, count(v.user_id)::int AS votes
         FROM group_poll_option o
         LEFT JOIN group_poll_vote v ON v.poll_id = o.poll_id AND v.option_id = o.id
        WHERE o.poll_id = ANY($1::uuid[])
        GROUP BY o.poll_id, o.id, o.label, o.position
        ORDER BY o.poll_id, o.position`,
      [rows.map((r) => r.id)],
    );
    const byPoll = new Map<string, PollRecord['options']>();
    for (const o of options.rows) {
      const list = byPoll.get(o.poll_id) ?? [];
      list.push({ id: o.id, label: o.label, votes: o.votes });
      byPoll.set(o.poll_id, list);
    }
    return rows.map((r) => ({
      id: r.id,
      question: r.question,
      creatorId: r.created_by,
      creatorUsername: r.creator_username,
      createdAt: r.created_at.toISOString(),
      closesAt: r.closes_at.toISOString(),
      closedAt: r.closed_at?.toISOString() ?? null,
      now: r.now.toISOString(),
      myVote: r.my_vote,
      options: byPoll.get(r.id) ?? [],
    }));
  }

  /** Cast or change a vote. The schema refuses a closed poll or somebody outside the group. */
  async vote(pollId: string, userId: string, optionId: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO group_poll_vote (poll_id, user_id, option_id)
       VALUES ($1::uuid, $2::uuid, $3::uuid)
       ON CONFLICT (poll_id, user_id) DO UPDATE SET option_id = EXCLUDED.option_id`,
      [pollId, userId, optionId],
    );
  }

  /** Take a vote back while the poll is open. False when there was nothing open to take back. */
  async withdraw(pollId: string, userId: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `DELETE FROM group_poll_vote v
        USING group_poll p
        WHERE v.poll_id = $1::uuid AND v.user_id = $2::uuid
          AND p.id = v.poll_id
          AND p.closed_at IS NULL AND p.removed_at IS NULL AND p.closes_at > now()`,
      [pollId, userId],
    );
    return (rowCount ?? 0) > 0;
  }

  /** Close early. The schema refuses a poll that is already closed (PL018). */
  async close(pollId: string, byUserId: string): Promise<void> {
    await this.pool.query(
      `UPDATE group_poll SET closed_at = now(), closed_by = $2::uuid WHERE id = $1::uuid`,
      [pollId, byUserId],
    );
  }

  /**
   * Remove with a reason, and the `audit_log` row -- actor, time, reason and
   * the poll as it was, counts included -- in the same transaction (rule 10).
   * False when the poll was already removed.
   */
  async remove(
    poll: PollRecord,
    groupId: string,
    actorId: string,
    reason: string,
  ): Promise<boolean> {
    return this.inTransaction(async (client) => {
      const { rowCount } = await client.query(
        `UPDATE group_poll
            SET removed_at = now(), removed_by = $2::uuid, removal_reason = $3::text
          WHERE id = $1::uuid AND removed_at IS NULL`,
        [poll.id, actorId, reason],
      );
      if ((rowCount ?? 0) === 0) return false;
      const previous = {
        group_id: groupId,
        question: poll.question,
        created_by: poll.creatorUsername,
        created_at: poll.createdAt,
        closes_at: poll.closesAt,
        closed_at: poll.closedAt,
        options: poll.options.map((o) => ({ label: o.label, votes: o.votes })),
        total_votes: poll.options.reduce((n, o) => n + o.votes, 0),
      };
      await client.query(
        `INSERT INTO audit_log (actor_id, action, target_type, target_id, reason, previous, next)
         VALUES ($1::uuid, 'group_poll.remove', 'group_poll', $2::text, $3::text, $4::jsonb, $5::jsonb)`,
        [actorId, poll.id, reason, JSON.stringify(previous), JSON.stringify({ removed: true })],
      );
      return true;
    });
  }

  private async inTransaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const value = await run(client);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
