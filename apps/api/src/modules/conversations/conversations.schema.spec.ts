import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Conversations against the real schema (T-220).
 *
 * Nothing in the API writes these tables yet — T-221 is the service — so this
 * writes what the service will write and checks the half that belongs to the
 * database. That half is most of the interesting half: the ordering, the
 * refusals, and the fact that a message cannot be quietly changed after
 * somebody has read it.
 */
const DATABASE_URL = process.env.DATABASE_URL;

const ENGLAND = '00000000-0000-4000-8000-000000000101';
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);

interface Codeful {
  code?: string;
}

function sqlstate(error: unknown): string | undefined {
  return (error as Codeful).code;
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('conversations', () => {
  let pool: Pool;
  const members: string[] = [];

  async function member(label: string): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO user_account
         (username, display_name, email, country_id, preferred_language, timezone,
          accepted_rules_at, email_verified_at)
       VALUES ($1, $2, $3, $4, 'en', 'Europe/London', now(), now())
       RETURNING id`,
      [
        `cv${label}${RUN}`.toLowerCase().slice(0, 20),
        `Conversation ${label}`,
        `cv${label}${RUN}@example.test`.toLowerCase(),
        ENGLAND,
      ],
    );
    const id = rows[0]?.id ?? '';
    members.push(id);
    return id;
  }

  /** What the service will write: the pair, ordered by the database. */
  async function direct(a: string, b: string): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO conversation (kind, pair_low, pair_high)
       VALUES ('direct', LEAST($1::uuid, $2::uuid), GREATEST($1::uuid, $2::uuid))
       RETURNING id`,
      [a, b],
    );
    const id = rows[0]?.id ?? '';
    for (const user of [a, b]) {
      await pool.query(
        `INSERT INTO conversation_participant (conversation_id, user_id) VALUES ($1, $2)`,
        [id, user],
      );
    }
    return id;
  }

  function say(conversationId: string, author: string, body: string) {
    return pool.query<{ id: string; seq: string }>(
      `INSERT INTO message (conversation_id, author_id, body) VALUES ($1, $2, $3)
       RETURNING id, seq`,
      [conversationId, author, body],
    );
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
  });

  afterAll(async () => {
    if (pool === undefined) return;
    // Messages refuse DELETE by trigger (PL007), so the cleanup needs the
    // session-scoped setting; the accounts go after it is restored, because
    // `replica` turns off foreign-key triggers too and the cascade would not
    // run. See docs/03-project-map.md.
    const client = await pool.connect();
    try {
      await client.query(`SET session_replication_role = 'replica'`);
      await client.query(`DELETE FROM message WHERE author_id = ANY($1::uuid[])`, [members]);
      await client.query(`DELETE FROM rate_window WHERE user_id = ANY($1::uuid[])`, [members]);
      await client.query(`DELETE FROM sanction WHERE user_id = ANY($1::uuid[])`, [members]);
      await client.query(`DELETE FROM moderation_decision WHERE moderator_id = ANY($1::uuid[])`, [
        members,
      ]);
    } finally {
      await client.query(`SET session_replication_role = 'origin'`);
      client.release();
    }
    await pool.query(`DELETE FROM user_account WHERE id = ANY($1::uuid[])`, [members]);
    await pool.end();
  });

  describe('order belongs to the store, not to a clock', () => {
    it('numbers messages from one within the conversation', async () => {
      const [a, b] = await Promise.all([member('o1'), member('o2')]);
      const room = await direct(a, b);

      const first = await say(room, a, 'are you watching this');
      const second = await say(room, b, 'both of us are');
      const third = await say(room, a, 'that was never a foul');

      expect([first, second, third].map((r) => r.rows[0]?.seq)).toEqual(['1', '2', '3']);
    });

    it('counts separately in separate conversations', async () => {
      const [a, b, c] = await Promise.all([member('s1'), member('s2'), member('s3')]);
      const one = await direct(a, b);
      const two = await direct(a, c);

      await say(one, a, 'first here');
      const elsewhere = await say(two, a, 'first there');

      // A global counter would leak how much the whole product is being used,
      // and would make "everything after 41" a question about the platform
      // rather than about this conversation.
      expect(elsewhere.rows[0]?.seq).toBe('1');
    });

    it('refuses a sequence a caller chose', async () => {
      const [a, b] = await Promise.all([member('c1'), member('c2')]);
      const room = await direct(a, b);
      await say(room, a, 'one');

      // The trigger overwrites it. A sequence a client could choose is not a
      // sequence: two clients would choose the same one.
      const { rows } = await pool.query<{ seq: string }>(
        `INSERT INTO message (conversation_id, author_id, body, seq)
         VALUES ($1, $2, 'I would like to be number 99', 99) RETURNING seq`,
        [room, b],
      );
      expect(rows[0]?.seq).toBe('2');
    });

    it('does not spend a number on a message it refused', async () => {
      const [a, b, outsider] = await Promise.all([member('n1'), member('n2'), member('n3')]);
      const room = await direct(a, b);
      await say(room, a, 'one');

      await expect(say(room, outsider, 'let me in')).rejects.toBeTruthy();

      // The next real message is 2, not 3. The allocation trigger is named to
      // fire last for exactly this.
      const next = await say(room, b, 'two');
      expect(next.rows[0]?.seq).toBe('2');
    });
  });

  describe('who may write', () => {
    it('refuses somebody who is not in the conversation, with PL006', async () => {
      const [a, b, outsider] = await Promise.all([member('p1'), member('p2'), member('p3')]);
      const room = await direct(a, b);

      const refused = await say(room, outsider, 'hello').catch((error: unknown) => error);
      expect(sqlstate(refused)).toBe('PL006');
    });

    it('refuses somebody who has left, and still lets them read', async () => {
      const [a, b] = await Promise.all([member('l1'), member('l2')]);
      const room = await direct(a, b);
      await say(room, a, 'still here');
      await pool.query(
        `UPDATE conversation_participant SET left_at = now()
          WHERE conversation_id = $1 AND user_id = $2`,
        [room, b],
      );

      const refused = await say(room, b, 'one more thing').catch((error: unknown) => error);
      expect(sqlstate(refused)).toBe('PL006');
      // The row stays, so the history stays theirs to read.
      const { rowCount } = await pool.query(
        `SELECT 1 FROM conversation_participant WHERE conversation_id = $1 AND user_id = $2`,
        [room, b],
      );
      expect(rowCount).toBe(1);
    });

    it('refuses a message across a block, with the same PL003 a friend request meets', async () => {
      const [a, b] = await Promise.all([member('b1'), member('b2')]);
      const room = await direct(a, b);
      await say(room, a, 'before');
      await pool.query(`INSERT INTO user_block (blocker_id, blocked_id) VALUES ($1, $2)`, [b, a]);

      const refused = await say(room, a, 'after').catch((error: unknown) => error);
      expect(sqlstate(refused)).toBe('PL003');
      // And in the other direction: a block is a wall, not a mute.
      const back = await say(room, b, 'also refused').catch((error: unknown) => error);
      expect(sqlstate(back)).toBe('PL003');
    });

    it('refuses a message from a member under a messaging sanction, with PL004', async () => {
      const [a, b, moderator] = await Promise.all([member('m1'), member('m2'), member('m3')]);
      const room = await direct(a, b);
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO moderation_decision (moderator_id, subject_type, subject_id, outcome, reason)
         VALUES ($1, 'member', $2, 'sanctioned', 'abuse in a direct conversation') RETURNING id`,
        [moderator, a],
      );
      await pool.query(
        `INSERT INTO sanction (user_id, decision_id, scope, starts_at, ends_at, permanent)
         VALUES ($1, $2, 'messaging', now() - interval '1 minute',
                 now() + interval '1 day', false)`,
        [a, rows[0]?.id],
      );

      const refused = await say(room, a, 'anything').catch((error: unknown) => error);
      expect(sqlstate(refused)).toBe('PL004');
      // The restriction is on one member, not on the conversation.
      await expect(say(room, b, 'I can still write')).resolves.toBeTruthy();
    });
  });

  describe('a message is never rewritten', () => {
    it('refuses an edit and refuses a delete, with PL007', async () => {
      const [a, b] = await Promise.all([member('e1'), member('e2')]);
      const room = await direct(a, b);
      const { rows } = await say(room, a, 'what I actually said');
      const id = rows[0]?.id ?? '';

      const edited = await pool
        .query(`UPDATE message SET body = 'what I wish I had said' WHERE id = $1`, [id])
        .catch((error: unknown) => error);
      expect(sqlstate(edited)).toBe('PL007');

      const deleted = await pool
        .query(`DELETE FROM message WHERE id = $1`, [id])
        .catch((error: unknown) => error);
      expect(sqlstate(deleted)).toBe('PL007');
    });

    it('allows the tombstone, once, and keeps the row', async () => {
      const [a, b] = await Promise.all([member('t1'), member('t2')]);
      const room = await direct(a, b);
      const { rows } = await say(room, a, 'something regrettable');
      const id = rows[0]?.id ?? '';

      await expect(
        pool.query(
          `UPDATE message SET body = NULL, removed_at = now(), removed_by = $2,
                              removed_kind = 'author'
            WHERE id = $1`,
          [id, a],
        ),
      ).resolves.toBeTruthy();

      const { rows: after } = await pool.query<{ seq: string; removed_kind: string }>(
        `SELECT seq, removed_kind FROM message WHERE id = $1`,
        [id],
      );
      // The row stays and keeps its number, so the conversation around it still
      // reads and the moderation record is verifiable.
      expect(after[0]).toMatchObject({ removed_kind: 'author' });

      // Removing it twice would let a moderator overwrite who took it down.
      const again = await pool
        .query(
          `UPDATE message SET removed_at = now(), removed_by = $2, removed_kind = 'moderator'
            WHERE id = $1`,
          [id, b],
        )
        .catch((error: unknown) => error);
      expect(sqlstate(again)).toBe('PL007');
    });

    it('refuses a tombstone that keeps the body, and a body that claims to be removed', async () => {
      const [a, b] = await Promise.all([member('x1'), member('x2')]);
      const room = await direct(a, b);
      const { rows } = await say(room, a, 'still here');

      await expect(
        pool.query(`UPDATE message SET removed_at = now(), removed_kind = 'author' WHERE id = $1`, [
          rows[0]?.id,
        ]),
      ).rejects.toMatchObject({ constraint: 'message_body_or_tombstone' });

      await expect(
        pool.query(
          `INSERT INTO message (conversation_id, author_id, body, removed_at, removed_kind)
           VALUES ($1, $2, NULL, NULL, 'author')`,
          [room, b],
        ),
      ).rejects.toBeTruthy();
    });
  });

  describe('one direct conversation per pair', () => {
    it('refuses the second, from either side', async () => {
      const [a, b] = await Promise.all([member('d1'), member('d2')]);
      await direct(a, b);

      await expect(direct(b, a)).rejects.toMatchObject({
        constraint: 'conversation_one_per_pair',
      });
    });

    it('refuses a direct conversation without a pair', async () => {
      await expect(
        pool.query(`INSERT INTO conversation (kind) VALUES ('direct')`),
      ).rejects.toMatchObject({ constraint: 'conversation_direct_has_a_pair' });
    });

    it('refuses a kind nothing can create yet', async () => {
      // `group` arrives with the groups of T-240. A kind nothing can produce is
      // a kind nothing should offer.
      await expect(
        pool.query(`INSERT INTO conversation (kind) VALUES ('group')`),
      ).rejects.toMatchObject({ constraint: 'conversation_kind_check' });
    });
  });
});
