import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Reacting to a panel post, and following a contributor, against the real
 * schema (T-252).
 *
 * The acceptance criterion is a negative — **reacting is open to members; it
 * never becomes posting access** — and a negative is the kind of thing that
 * passes review by being obviously true and fails in production a year later,
 * when somebody adds a field.
 *
 * So it is tested twice over, from both ends. A member with no grant at all can
 * react and follow: that is "open to members", and a gate on either would be a
 * second, quieter approval nobody decided to create. And neither table has
 * anywhere to put a word: that is "never becomes posting access", and it is
 * checked against `information_schema` rather than against the code that
 * happens to write them today.
 */
const DATABASE_URL = process.env.DATABASE_URL;

const ENGLAND = '00000000-0000-4000-8000-000000000101';
const PL_2025 = '00000000-0000-4000-8000-000000000302';
const REGULAR_SEASON = '00000000-0000-4000-8000-000000000401';
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  'panel reactions and following',
  () => {
    let pool: Pool;
    const members: string[] = [];
    const teams = [randomUUID(), randomUUID()];
    const match = randomUUID();
    let contributor = '';
    let approver = '';
    let written = '';

    async function member(label: string): Promise<string> {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO user_account
           (username, display_name, email, country_id, preferred_language, timezone,
            accepted_rules_at, email_verified_at)
         VALUES ($1, $2, $3, $4, 'en', 'Europe/London', now(), now())
         RETURNING id`,
        [
          `ps${label}${RUN}`.toLowerCase().slice(0, 20),
          `Social ${label}`,
          `ps${label}${RUN}@example.test`.toLowerCase(),
          ENGLAND,
        ],
      );
      const id = rows[0]?.id ?? '';
      members.push(id);
      return id;
    }

    const react = (postId: string, userId: string, reaction = 'agree') =>
      pool.query(`INSERT INTO panel_reaction (post_id, user_id, reaction) VALUES ($1, $2, $3)`, [
        postId,
        userId,
        reaction,
      ]);

    const follow = (followerId: string, followedId: string) =>
      pool.query(`INSERT INTO member_follow (follower_id, followed_id) VALUES ($1, $2)`, [
        followerId,
        followedId,
      ]);

    const post = (body = 'Both full-backs are doubtful.') =>
      pool
        .query<{ id: string }>(
          `INSERT INTO panel_post (fixture_id, author_id, body) VALUES ($1, $2, $3) RETURNING id`,
          [match, contributor, body],
        )
        .then(({ rows }) => rows[0]?.id ?? '');

    beforeAll(async () => {
      pool = new Pool({ connectionString: DATABASE_URL });
      contributor = await member('c');
      approver = await member('a');
      for (const [index, id] of teams.entries()) {
        await pool.query(
          `INSERT INTO team (id, country_id, name, short_name, kind, gender)
           VALUES ($1, $2, $3, $4, 'club', 'men')`,
          [id, ENGLAND, `Social Team ${index}${RUN}`, `ST${index}`],
        );
      }
      await pool.query(
        `INSERT INTO fixture (id, season_id, stage_id, round, kickoff_at, status)
         VALUES ($1, $2, $3, 'Matchday', now() + interval '2 days', 'scheduled')`,
        [match, PL_2025, REGULAR_SEASON],
      );
      await pool.query(
        `INSERT INTO fixture_participant (fixture_id, team_id, side)
         VALUES ($1, $2, 'home'), ($1, $3, 'away')`,
        [match, teams[0], teams[1]],
      );
      await pool.query(
        `INSERT INTO contributor_grant (user_id, granted_by, reason, rules_version, accepted_at)
         VALUES ($1, $2, 'the panel social suite', 'contributor-rules@1.0.0', now())`,
        [contributor, approver],
      );
      written = await post();
    });

    afterAll(async () => {
      if (pool === undefined) return;
      const client = await pool.connect();
      try {
        await client.query(`SET session_replication_role = 'replica'`);
        await client.query(`DELETE FROM panel_reaction WHERE user_id = ANY($1::uuid[])`, [members]);
        await client.query(`DELETE FROM member_follow WHERE follower_id = ANY($1::uuid[])`, [
          members,
        ]);
        await client.query(`DELETE FROM user_block WHERE blocker_id = ANY($1::uuid[])`, [members]);
        await client.query(`DELETE FROM panel_post WHERE fixture_id = $1`, [match]);
        await client.query(`DELETE FROM rate_window WHERE user_id = ANY($1::uuid[])`, [members]);
        await client.query(`DELETE FROM contributor_grant WHERE user_id = ANY($1::uuid[])`, [
          members,
        ]);
      } finally {
        await client.query(`SET session_replication_role = 'origin'`);
        client.release();
      }
      await pool.query(`DELETE FROM fixture_participant WHERE fixture_id = $1`, [match]);
      await pool.query(`DELETE FROM fixture WHERE id = $1`, [match]);
      await pool.query(`DELETE FROM user_account WHERE id = ANY($1::uuid[])`, [members]);
      await pool.query(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [teams]);
      await pool.end();
    });

    describe('reacting is open to members', () => {
      it('lets a member with no grant react, although they could not post a word', async () => {
        const ordinary = await member('r1');
        // The two halves of the criterion in one test. This member is refused by
        // the approval trigger and admitted by the reaction table, and both are
        // correct.
        await expect(
          pool.query(`INSERT INTO panel_post (fixture_id, author_id, body) VALUES ($1, $2, 'no')`, [
            match,
            ordinary,
          ]),
        ).rejects.toMatchObject({ code: 'PL014' });
        await expect(react(written, ordinary)).resolves.toBeTruthy();
      });

      it('counts a repeated reaction once', async () => {
        const twice = await member('r2');
        await react(written, twice, 'laugh');
        // Reacting twice is reacting once. The primary key says so rather than a
        // lookup two taps could both pass.
        await expect(react(written, twice, 'laugh')).rejects.toMatchObject({ code: '23505' });
      });

      it('allows different reactions from one member, and only the six', async () => {
        const several = await member('r3');
        for (const reaction of ['agree', 'disagree', 'laugh', 'surprise', 'sad', 'celebrate']) {
          await expect(react(written, several, reaction)).resolves.toBeTruthy();
        }
        await expect(react(written, several, '🔥')).rejects.toMatchObject({
          constraint: 'panel_reaction_kind',
        });
        await expect(
          react(written, several, 'this is what I actually think'),
        ).rejects.toMatchObject({ constraint: 'panel_reaction_kind' });
      });

      it('refuses a reaction to a removed post, and drops the ones it already had', async () => {
        const doomed = await post('a post that will be taken down');
        const watcher = await member('r4');
        await react(doomed, watcher, 'agree');

        await pool.query(
          `UPDATE panel_post SET removed_at = now(), removed_by = $1, removed_kind = 'moderator', body = NULL
            WHERE id = $2`,
          [approver, doomed],
        );

        // Left behind, the tally would be a count attached to nothing -- and on a
        // moderated post, a visible record of how many people agreed with
        // something taken down.
        const after = await pool.query(`SELECT 1 FROM panel_reaction WHERE post_id = $1`, [doomed]);
        expect(after.rows).toHaveLength(0);
        await expect(react(doomed, watcher, 'sad')).rejects.toMatchObject({ code: 'PL007' });
      });
    });

    describe('it never becomes posting access', () => {
      it('gives a reaction nowhere to put a word', async () => {
        // Checked against the schema rather than against the code that writes
        // it, because the failure this guards against is somebody adding a
        // column in a year and nobody connecting it to the approval gate.
        const { rows } = await pool.query<{ column_name: string; data_type: string }>(
          `SELECT column_name, data_type FROM information_schema.columns
            WHERE table_name = 'panel_reaction'`,
        );
        expect(rows.map((r) => r.column_name).sort()).toEqual([
          'created_at',
          'post_id',
          'reaction',
          'user_id',
        ]);
        // The one text column is closed by a CHECK to six values. An open one
        // would be a small free-text box attached to somebody else's words, on a
        // panel this member was not approved to write on.
        const { rows: checks } = await pool.query<{ def: string }>(
          `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
            WHERE conrelid = 'panel_reaction'::regclass AND contype = 'c'`,
        );
        expect(checks.some((c) => c.def.includes("'celebrate'"))).toBe(true);
      });

      it('gives a follow nowhere to put a word either', async () => {
        const { rows } = await pool.query<{ column_name: string }>(
          `SELECT column_name FROM information_schema.columns
            WHERE table_name = 'member_follow'`,
        );
        expect(rows.map((r) => r.column_name).sort()).toEqual([
          'created_at',
          'followed_id',
          'follower_id',
        ]);
      });

      it('leaves the approval gate exactly where it was', async () => {
        const enthusiast = await member('n1');
        await react(written, enthusiast, 'celebrate');
        await follow(enthusiast, contributor);
        // Having reacted and followed changes nothing about posting, which is
        // the whole criterion.
        await expect(
          pool.query(
            `INSERT INTO panel_post (fixture_id, author_id, body) VALUES ($1, $2, 'now?')`,
            [match, enthusiast],
          ),
        ).rejects.toMatchObject({ code: 'PL014' });
      });
    });

    describe('following a contributor', () => {
      it('is one-directional and needs nobody to agree', async () => {
        const fan = await member('f1');
        await expect(follow(fan, contributor)).resolves.toBeTruthy();
        const back = await pool.query(
          `SELECT 1 FROM member_follow WHERE follower_id = $1 AND followed_id = $2`,
          [contributor, fan],
        );
        // Unlike a friendship (T-200), which is one row for an agreed pair.
        expect(back.rows).toHaveLength(0);
      });

      it('refuses following yourself and refuses a duplicate', async () => {
        const alone = await member('f2');
        await expect(follow(alone, alone)).rejects.toMatchObject({
          constraint: 'member_follow_not_self',
        });
        await follow(alone, contributor);
        await expect(follow(alone, contributor)).rejects.toMatchObject({ code: '23505' });
      });

      it('refuses a follow across a block, in either direction', async () => {
        const [blocker, blocked] = await Promise.all([member('b1'), member('b2')]);
        await pool.query(`INSERT INTO user_block (blocker_id, blocked_id) VALUES ($1, $2)`, [
          blocker,
          blocked,
        ]);
        await expect(follow(blocked, blocker)).rejects.toMatchObject({ code: 'PL003' });
        // And the blocker cannot follow them either. Which way round the block
        // goes is not something this should let anybody learn.
        await expect(follow(blocker, blocked)).rejects.toMatchObject({ code: 'PL003' });
      });

      it('ends an existing follow when a block is created, both ways', async () => {
        const [one, two] = await Promise.all([member('b3'), member('b4')]);
        await follow(one, two);
        await follow(two, one);

        await pool.query(`INSERT INTO user_block (blocker_id, blocked_id) VALUES ($1, $2)`, [
          one,
          two,
        ]);

        // A block that left the follow in place would leave the blocked member
        // still receiving somebody, which is most of what they were trying to
        // stop (T-200 ends a friendship for the same reason).
        const left = await pool.query(
          `SELECT 1 FROM member_follow
            WHERE (follower_id = $1 AND followed_id = $2) OR (follower_id = $2 AND followed_id = $1)`,
          [one, two],
        );
        expect(left.rows).toHaveLength(0);
      });

      it('goes with the account when it is deleted, rather than pointing at a ghost', async () => {
        const [fan, leaving] = await Promise.all([member('d1'), member('d2')]);
        await follow(fan, leaving);
        await pool.query(`DELETE FROM user_account WHERE id = $1`, [leaving]);
        members.splice(members.indexOf(leaving), 1);

        // The reason this is its own table rather than a row in
        // `followed_entity`, which carries no foreign key on what it points at.
        const left = await pool.query(`SELECT 1 FROM member_follow WHERE follower_id = $1`, [fan]);
        expect(left.rows).toHaveLength(0);
      });
    });
  },
);
