import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Groups against the real schema (T-240).
 *
 * Nothing in the API writes these tables yet — T-241 is the service — so this
 * writes what the service will write and checks the half that belongs to the
 * database. Here that half is the acceptance criterion itself: **visibility,
 * roles and the one-owner rule live in the schema**, not in whichever query
 * happens to remember them.
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

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('groups', () => {
  let pool: Pool;
  const members: string[] = [];
  let slugCounter = 0;

  async function member(label: string): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO user_account
         (username, display_name, email, country_id, preferred_language, timezone,
          accepted_rules_at, email_verified_at)
       VALUES ($1, $2, $3, $4, 'en', 'Europe/London', now(), now())
       RETURNING id`,
      [
        `gr${label}${RUN}`.toLowerCase().slice(0, 20),
        `Group ${label}`,
        `gr${label}${RUN}@example.test`.toLowerCase(),
        ENGLAND,
      ],
    );
    const id = rows[0]?.id ?? '';
    members.push(id);
    return id;
  }

  function slug(): string {
    slugCounter += 1;
    return `g-${RUN}-${slugCounter}`.toLowerCase().slice(0, 40);
  }

  /**
   * What the service will write: the group and its owner, in one transaction.
   *
   * One transaction because the deferred constraint says a group has an owner
   * *at commit*; two statements outside a transaction would each be their own
   * commit and the first would fail.
   */
  async function group(owner: string, visibility = 'public'): Promise<string> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO user_group (slug, name, visibility, created_by)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [slug(), `Group ${slugCounter}`, visibility, owner],
      );
      const id = rows[0]?.id ?? '';
      await client.query(
        `INSERT INTO group_member (group_id, user_id, role) VALUES ($1, $2, 'owner')`,
        [id, owner],
      );
      await client.query('COMMIT');
      return id;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * A sanction, the way the moderation spine requires one: hanging off a
   * judgement that names its moderator and its reason (T-210). There is no way
   * to restrict somebody here without a record of who decided to.
   */
  async function sanction(subject: string, moderator: string, scope: string): Promise<void> {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO moderation_decision (moderator_id, subject_type, subject_id, outcome, reason)
       VALUES ($1, 'member', $2, 'sanctioned', 'a schema test')
       RETURNING id`,
      [moderator, subject],
    );
    await pool.query(
      `INSERT INTO sanction (user_id, decision_id, scope, permanent) VALUES ($1, $2, $3, true)`,
      [subject, rows[0]?.id ?? '', scope],
    );
  }

  beforeAll(() => {
    pool = new Pool({ connectionString: DATABASE_URL });
  });

  afterAll(async () => {
    const client = await pool.connect();
    try {
      // The deferred owner check and the immutability triggers are all user
      // triggers, so one session-scoped setting takes the lot; the setting goes
      // back before the accounts do, or the foreign keys that clean up
      // credentials and sessions are switched off too (03-project-map.md).
      await client.query(`SET session_replication_role = 'replica'`);
      await client.query(
        `DELETE FROM group_member WHERE user_id = ANY($1::uuid[])
            OR group_id IN (SELECT id FROM user_group WHERE created_by = ANY($1::uuid[]))`,
        [members],
      );
      await client.query(`DELETE FROM user_group WHERE created_by = ANY($1::uuid[])`, [members]);
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

  describe('visibility is a closed set, and the middle one is why there are three', () => {
    it('takes each of the three the product has', async () => {
      const owner = await member('vis');
      for (const visibility of ['public', 'discoverable', 'invite_only']) {
        await expect(group(owner, visibility)).resolves.toMatch(/^[0-9a-f-]{36}$/);
      }
    });

    it('refuses a fourth that nothing would know how to render', async () => {
      const owner = await member('vis4');
      await expect(group(owner, 'secret')).rejects.toMatchObject({ code: '23514' });
    });
  });

  describe('the slug is a handle, and it never changes', () => {
    it('refuses a shape that could need escaping or normalising', async () => {
      const owner = await member('slug');
      for (const bad of ['Ab', 'a b', 'ok?', '-lead', 'x']) {
        await expect(
          pool.query(
            `INSERT INTO user_group (slug, name, visibility, created_by)
             VALUES ($1, 'Fine name', 'public', $2)`,
            [bad, owner],
          ),
        ).rejects.toMatchObject({ code: '23514' });
      }
    });

    it('refuses to be renamed, because a link already shared would break', async () => {
      const owner = await member('slugfix');
      const id = await group(owner);
      // The display name is what changes.
      await expect(
        pool.query(`UPDATE user_group SET name = 'A better name' WHERE id = $1`, [id]),
      ).resolves.toBeTruthy();
      await expect(
        pool.query(`UPDATE user_group SET slug = 'something-else' WHERE id = $1`, [id]),
      ).rejects.toMatchObject({ code: 'PL008' });
    });

    it('refuses two groups with one handle', async () => {
      const owner = await member('slugdup');
      const first = await group(owner);
      const { rows } = await pool.query<{ slug: string }>(
        `SELECT slug FROM user_group WHERE id = $1`,
        [first],
      );
      await expect(
        pool.query(
          `INSERT INTO user_group (slug, name, visibility, created_by)
           VALUES ($1, 'Second', 'public', $2)`,
          [rows[0]?.slug ?? '', owner],
        ),
      ).rejects.toMatchObject({ code: '23505' });
    });
  });

  describe('exactly one owner, and the schema is what says so', () => {
    it('refuses a second owner', async () => {
      const owner = await member('one');
      const other = await member('two');
      const id = await group(owner);
      await expect(
        pool.query(`INSERT INTO group_member (group_id, user_id, role) VALUES ($1, $2, 'owner')`, [
          id,
          other,
        ]),
      ).rejects.toMatchObject({ code: '23505' });
    });

    it('refuses to leave a group with none', async () => {
      const owner = await member('last');
      const id = await group(owner);
      await expect(
        pool.query(`DELETE FROM group_member WHERE group_id = $1 AND user_id = $2`, [id, owner]),
      ).rejects.toMatchObject({ code: 'PL009' });
      await expect(
        pool.query(`UPDATE group_member SET role = 'member' WHERE group_id = $1`, [id]),
      ).rejects.toMatchObject({ code: 'PL009' });
    });

    it('lets ownership be handed over, which is the point of deferring the check', async () => {
      // Demote then promote. A per-statement check would refuse the moment in
      // between and make the one safe way to hand a group on impossible.
      const owner = await member('give');
      const heir = await member('take');
      const id = await group(owner);
      await pool.query(`INSERT INTO group_member (group_id, user_id) VALUES ($1, $2)`, [id, heir]);

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `UPDATE group_member SET role = 'member' WHERE group_id = $1 AND user_id = $2`,
          [id, owner],
        );
        await client.query(
          `UPDATE group_member SET role = 'owner' WHERE group_id = $1 AND user_id = $2`,
          [id, heir],
        );
        await client.query('COMMIT');
      } finally {
        client.release();
      }

      const { rows } = await pool.query<{ user_id: string }>(
        `SELECT user_id FROM group_member WHERE group_id = $1 AND role = 'owner'`,
        [id],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.user_id).toBe(heir);
    });

    it('refuses a group that never gets one, at commit', async () => {
      const owner = await member('none');
      const client = await pool.connect();
      let code: string | undefined;
      try {
        await client.query('BEGIN');
        await client.query(
          `INSERT INTO user_group (slug, name, visibility, created_by)
           VALUES ($1, 'Ownerless', 'public', $2)`,
          [slug(), owner],
        );
        await client.query('COMMIT');
      } catch (error) {
        code = sqlstate(error);
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
      expect(code).toBe('PL009');
    });

    it('refuses a role nothing would know how to honour', async () => {
      const owner = await member('role');
      const other = await member('rolb');
      const id = await group(owner);
      await expect(
        pool.query(`INSERT INTO group_member (group_id, user_id, role) VALUES ($1, $2, 'admin')`, [
          id,
          other,
        ]),
      ).rejects.toMatchObject({ code: '23514' });
    });
  });

  describe('an invitation is a way of reaching somebody', () => {
    it('is refused across a block, in either direction', async () => {
      const owner = await member('inv');
      const blocked = await member('blk');
      const id = await group(owner);
      await pool.query(`INSERT INTO user_block (blocker_id, blocked_id) VALUES ($1, $2)`, [
        blocked,
        owner,
      ]);
      await expect(
        pool.query(
          `INSERT INTO group_invite (group_id, invitee_id, invited_by) VALUES ($1, $2, $3)`,
          [id, blocked, owner],
        ),
      ).rejects.toMatchObject({ code: 'PL003' });
    });

    it('is refused under a contact sanction, the same as a friend request', async () => {
      const owner = await member('sanc');
      const guest = await member('gst');
      const id = await group(owner);
      await sanction(owner, owner, 'contact');
      await expect(
        pool.query(
          `INSERT INTO group_invite (group_id, invitee_id, invited_by) VALUES ($1, $2, $3)`,
          [id, guest, owner],
        ),
      ).rejects.toMatchObject({ code: 'PL004' });
      await pool.query(`DELETE FROM sanction WHERE user_id = $1`, [owner]);
    });

    it('is refused to somebody already in the group, which would be noise', async () => {
      const owner = await member('dup');
      const inside = await member('ins');
      const id = await group(owner);
      await pool.query(`INSERT INTO group_member (group_id, user_id) VALUES ($1, $2)`, [
        id,
        inside,
      ]);
      await expect(
        pool.query(
          `INSERT INTO group_invite (group_id, invitee_id, invited_by) VALUES ($1, $2, $3)`,
          [id, inside, owner],
        ),
      ).rejects.toMatchObject({ code: 'PL010' });
    });

    it('is one open offer, never a history of refusals', async () => {
      const owner = await member('once');
      const guest = await member('gue');
      const id = await group(owner);
      await pool.query(
        `INSERT INTO group_invite (group_id, invitee_id, invited_by) VALUES ($1, $2, $3)`,
        [id, guest, owner],
      );
      await expect(
        pool.query(
          `INSERT INTO group_invite (group_id, invitee_id, invited_by) VALUES ($1, $2, $3)`,
          [id, guest, owner],
        ),
      ).rejects.toMatchObject({ code: '23505' });
    });
  });

  describe('how you get in follows from the visibility', () => {
    it('refuses asking to join an invite-only group: there is nothing to ask for', async () => {
      const owner = await member('ionly');
      const asker = await member('ask1');
      const id = await group(owner, 'invite_only');
      await expect(
        pool.query(`INSERT INTO group_join_request (group_id, user_id) VALUES ($1, $2)`, [
          id,
          asker,
        ]),
      ).rejects.toMatchObject({ code: 'PL011' });
    });

    it('refuses asking to join a public group: it is open, so join it', async () => {
      const owner = await member('pub');
      const asker = await member('ask2');
      const id = await group(owner, 'public');
      await expect(
        pool.query(`INSERT INTO group_join_request (group_id, user_id) VALUES ($1, $2)`, [
          id,
          asker,
        ]),
      ).rejects.toMatchObject({ code: 'PL011' });
    });

    it('takes a request for the one visibility that has a door to knock on', async () => {
      const owner = await member('disc');
      const asker = await member('ask3');
      const id = await group(owner, 'discoverable');
      await expect(
        pool.query(
          `INSERT INTO group_join_request (group_id, user_id, note) VALUES ($1, $2, 'let me in')`,
          [id, asker],
        ),
      ).resolves.toBeTruthy();
      // One open request per member per group: a refused asker cannot fill a
      // queue by asking again.
      await expect(
        pool.query(`INSERT INTO group_join_request (group_id, user_id) VALUES ($1, $2)`, [
          id,
          asker,
        ]),
      ).rejects.toMatchObject({ code: '23505' });
    });

    it('refuses a request from somebody already inside', async () => {
      const owner = await member('in2');
      const id = await group(owner, 'discoverable');
      await expect(
        pool.query(`INSERT INTO group_join_request (group_id, user_id) VALUES ($1, $2)`, [
          id,
          owner,
        ]),
      ).rejects.toMatchObject({ code: 'PL010' });
    });
  });

  describe('a sanction stops the outward moves and nothing else', () => {
    it('refuses making a group and joining one', async () => {
      const stopped = await member('stop');
      const host = await member('host');
      const open = await group(host, 'public');
      await sanction(stopped, host, 'groups');

      await expect(group(stopped)).rejects.toMatchObject({ code: 'PL004' });
      await expect(
        pool.query(`INSERT INTO group_member (group_id, user_id) VALUES ($1, $2)`, [open, stopped]),
      ).rejects.toMatchObject({ code: 'PL004' });

      await pool.query(`DELETE FROM sanction WHERE user_id = $1`, [stopped]);
    });
  });

  describe('a ceiling on making groups', () => {
    it('refuses the sixth in an hour', async () => {
      // Its own member, so the window it spends belongs to this test alone.
      const busy = await member('many');
      for (let made = 0; made < 5; made += 1) {
        await expect(group(busy)).resolves.toBeTruthy();
      }
      await expect(group(busy)).rejects.toMatchObject({ code: 'PL005' });
    });
  });
});
