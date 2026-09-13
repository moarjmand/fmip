import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The social graph against the real schema (T-200).
 *
 * Nothing in the API writes these tables yet — T-201 is the service — so this
 * test writes what the service will write and checks the guarantees that belong
 * to the database rather than to a caller. Those are the interesting half:
 * every one of them is a rule the API must not be able to route around.
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

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('the social graph', () => {
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
        `soc${label}${RUN}`.toLowerCase().slice(0, 20),
        `Social ${label}`,
        `soc${label}${RUN}@example.test`.toLowerCase(),
        ENGLAND,
      ],
    );
    const id = rows[0]?.id ?? '';
    members.push(id);
    return id;
  }

  /** What the service will write: the pair, ordered by the database. */
  function befriend(a: string, b: string): Promise<unknown> {
    return pool.query(
      `INSERT INTO friendship (low_id, high_id) VALUES (LEAST($1::uuid, $2::uuid), GREATEST($1::uuid, $2::uuid))`,
      [a, b],
    );
  }

  function areFriends(a: string, b: string): Promise<boolean> {
    return pool
      .query(
        `SELECT 1 FROM friendship WHERE low_id = LEAST($1::uuid, $2::uuid) AND high_id = GREATEST($1::uuid, $2::uuid)`,
        [a, b],
      )
      .then(({ rowCount }) => rowCount === 1);
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
  });

  afterAll(async () => {
    if (pool === undefined) return;
    // Everything in this migration cascades from the account, so removing the
    // members removes the graph. No trigger has to be disabled: nothing here is
    // immutable, because a friendship that could not be ended would be a trap.
    await pool.query(`DELETE FROM user_account WHERE id = ANY($1::uuid[])`, [members]);
    await pool.end();
  });

  describe('a friendship is one row, not two', () => {
    it('refuses the pair written in the other order', async () => {
      const [a, b] = await Promise.all([member('o1'), member('o2')]);
      const [low, high] = a < b ? [a, b] : [b, a];

      await expect(
        pool.query(`INSERT INTO friendship (low_id, high_id) VALUES ($1, $2)`, [high, low]),
      ).rejects.toMatchObject({ constraint: 'friendship_ordered_pair' });
    });

    it('refuses the same pair twice, from either side', async () => {
      const [a, b] = await Promise.all([member('d1'), member('d2')]);
      await befriend(a, b);

      // The second write is the same friendship arriving from the other member,
      // which is the realistic race: both of them accept at once.
      await expect(befriend(b, a)).rejects.toMatchObject({ constraint: 'friendship_pkey' });
    });

    it('answers the same question the same way from both sides', async () => {
      const [a, b] = await Promise.all([member('s1'), member('s2')]);
      await befriend(a, b);

      expect(await areFriends(a, b)).toBe(true);
      expect(await areFriends(b, a)).toBe(true);
    });
  });

  describe('a friend request', () => {
    it('cannot be sent to yourself', async () => {
      const a = await member('self');

      await expect(
        pool.query(`INSERT INTO friend_request (requester_id, addressee_id) VALUES ($1, $1)`, [a]),
      ).rejects.toMatchObject({ constraint: 'friend_request_not_self' });
    });

    it('may cross: both members can have asked the other', async () => {
      const [a, b] = await Promise.all([member('c1'), member('c2')]);

      await pool.query(`INSERT INTO friend_request (requester_id, addressee_id) VALUES ($1, $2)`, [
        a,
        b,
      ]);
      // Not an error. They have not managed to become friends by accident, and
      // either one accepting makes it so; refusing the second would mean telling
      // B that A has already asked, before B chose to hear from A at all.
      await expect(
        pool.query(`INSERT INTO friend_request (requester_id, addressee_id) VALUES ($1, $2)`, [
          b,
          a,
        ]),
      ).resolves.toBeTruthy();
    });
  });

  describe('a block is enforced by the database, not by a query', () => {
    it('refuses a request in either direction, with PL003', async () => {
      const [a, b] = await Promise.all([member('b1'), member('b2')]);
      await pool.query(`INSERT INTO user_block (blocker_id, blocked_id) VALUES ($1, $2)`, [a, b]);

      // The blocked member cannot reach the blocker.
      const outward = await pool
        .query(`INSERT INTO friend_request (requester_id, addressee_id) VALUES ($1, $2)`, [b, a])
        .catch((error: unknown) => error);
      expect(sqlstate(outward)).toBe('PL003');

      // And the blocker cannot reach them either, which is the honest reading of
      // a block: it is a wall, not a mute.
      const inward = await pool
        .query(`INSERT INTO friend_request (requester_id, addressee_id) VALUES ($1, $2)`, [a, b])
        .catch((error: unknown) => error);
      expect(sqlstate(inward)).toBe('PL003');
    });

    it('refuses a friendship across it, which is how a pre-existing request would slip through', async () => {
      const [a, b] = await Promise.all([member('b3'), member('b4')]);
      await pool.query(`INSERT INTO user_block (blocker_id, blocked_id) VALUES ($1, $2)`, [a, b]);

      const refused = await befriend(a, b).catch((error: unknown) => error);
      expect(sqlstate(refused)).toBe('PL003');
    });

    it('ends the friendship and withdraws the open requests, both directions', async () => {
      const [a, b, c] = await Promise.all([member('r1'), member('r2'), member('r3')]);
      await befriend(a, b);
      await pool.query(`INSERT INTO friend_request (requester_id, addressee_id) VALUES ($1, $2)`, [
        b,
        a,
      ]);
      await pool.query(`INSERT INTO friend_request (requester_id, addressee_id) VALUES ($1, $2)`, [
        a,
        c,
      ]);

      await pool.query(`INSERT INTO user_block (blocker_id, blocked_id) VALUES ($1, $2)`, [a, b]);

      expect(await areFriends(a, b)).toBe(false);
      const { rows } = await pool.query<{ addressee_id: string }>(
        `SELECT addressee_id FROM friend_request WHERE requester_id = ANY($1::uuid[])`,
        [[a, b]],
      );
      // The request between the two is gone; the unrelated one A sent to C is
      // untouched, because a block is about one pair.
      expect(rows.map((row) => row.addressee_id)).toEqual([c]);
    });

    it('does not restore the friendship when it is lifted', async () => {
      const [a, b] = await Promise.all([member('u1'), member('u2')]);
      await befriend(a, b);
      await pool.query(`INSERT INTO user_block (blocker_id, blocked_id) VALUES ($1, $2)`, [a, b]);
      await pool.query(`DELETE FROM user_block WHERE blocker_id = $1 AND blocked_id = $2`, [a, b]);

      // Unblocking restores the *possibility* of contact, not the relationship.
      // Reinstating a friendship somebody ended by blocking would put them back
      // in touch with a member they had removed, without either of them asking.
      expect(await areFriends(a, b)).toBe(false);
    });
  });

  describe('users_blocked', () => {
    it('is true from both sides, because a block stops a pair, not a direction', async () => {
      const [a, b] = await Promise.all([member('f1'), member('f2')]);
      await pool.query(`INSERT INTO user_block (blocker_id, blocked_id) VALUES ($1, $2)`, [a, b]);

      const { rows } = await pool.query<{ forward: boolean; back: boolean }>(
        `SELECT users_blocked($1, $2) AS forward, users_blocked($2, $1) AS back`,
        [a, b],
      );
      expect(rows[0]).toEqual({ forward: true, back: true });
    });

    it('is false for two members with nothing between them', async () => {
      const [a, b] = await Promise.all([member('n1'), member('n2')]);

      const { rows } = await pool.query<{ blocked: boolean }>(
        `SELECT users_blocked($1, $2) AS blocked`,
        [a, b],
      );
      expect(rows[0]?.blocked).toBe(false);
    });
  });

  it('leaves nothing behind when an account is deleted', async () => {
    const [a, b] = await Promise.all([member('x1'), member('x2')]);
    await befriend(a, b);
    await pool.query(`INSERT INTO friend_request (requester_id, addressee_id) VALUES ($1, $2)`, [
      b,
      a,
    ]);
    // Not between the pair, so it survives the block trigger and can only be
    // removed by the cascade.
    const c = await member('x3');
    await pool.query(`INSERT INTO user_block (blocker_id, blocked_id) VALUES ($1, $2)`, [a, c]);

    await pool.query(`DELETE FROM user_account WHERE id = $1`, [a]);

    const { rows } = await pool.query<{ friendships: string; requests: string; blocks: string }>(
      `SELECT (SELECT count(*) FROM friendship WHERE low_id = $1 OR high_id = $1) AS friendships,
              (SELECT count(*) FROM friend_request
                WHERE requester_id = $1 OR addressee_id = $1) AS requests,
              (SELECT count(*) FROM user_block
                WHERE blocker_id = $1 OR blocked_id = $1) AS blocks`,
      [a],
    );
    expect(rows[0]).toEqual({ friendships: '0', requests: '0', blocks: '0' });
  });
});
