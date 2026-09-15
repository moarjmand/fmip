import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Contributor eligibility and contributor grants, against the real schema
 * (T-250).
 *
 * Nothing in the API reads or writes these yet — the service is the second half
 * of the task — so this writes what the service will write and checks the two
 * guarantees that belong to the database rather than to any caller.
 *
 * **Eligibility cannot grant.** Not "no caller does it": the view has no INSERT
 * path at all, and carries no verdict for anybody to copy into a grant.
 *
 * **A grant cannot be rewritten, and neither can what happened to it.** "Who
 * approved this, and when did it stop" has to have an answer months later, from
 * somebody who was not there.
 */
const DATABASE_URL = process.env.DATABASE_URL;

const ENGLAND = '00000000-0000-4000-8000-000000000101';
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const RULES = 'contributor-rules@1.0.0';

interface Codeful {
  code?: string;
}

function sqlstate(error: unknown): string | undefined {
  return (error as Codeful).code;
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  'contributor eligibility and grants',
  () => {
    let pool: Pool;
    const members: string[] = [];

    async function member(label: string, verified = true): Promise<string> {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO user_account
           (username, display_name, email, country_id, preferred_language, timezone,
            accepted_rules_at, email_verified_at)
         VALUES ($1, $2, $3, $4, 'en', 'Europe/London', now(), $5)
         RETURNING id`,
        [
          `con${label}${RUN}`.toLowerCase().slice(0, 20),
          `Contributor ${label}`,
          `con${label}${RUN}@example.test`.toLowerCase(),
          ENGLAND,
          verified ? new Date() : null,
        ],
      );
      const id = rows[0]?.id ?? '';
      members.push(id);
      return id;
    }

    async function rate(userId: string, rating: number, settled: number): Promise<void> {
      await pool.query(
        `INSERT INTO rating_snapshot
           (user_id, formula_version, settled_count, rating, components, provisional,
            established, inputs_hash)
         VALUES ($1, 'performance-rating@1.0.0', $2, $3, '{}'::jsonb, false, true, $4)`,
        [userId, settled, rating, `${userId}-${settled}`],
      );
    }

    async function decision(
      moderator: string,
      subject: string,
      outcome: string,
      at?: string,
    ): Promise<string> {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO moderation_decision
           (moderator_id, subject_type, subject_id, outcome, reason, created_at)
         VALUES ($1, 'member', $2, $3, 'recorded by the schema suite', coalesce($4::timestamptz, now()))
         RETURNING id`,
        [moderator, subject, outcome, at ?? null],
      );
      return rows[0]?.id ?? '';
    }

    /** `ends` null means permanent; `starts` defaults to now. */
    async function sanction(
      userId: string,
      decisionId: string,
      scope: string,
      ends: string | null,
      starts?: string,
    ): Promise<string> {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO sanction (user_id, decision_id, scope, starts_at, ends_at, permanent)
         VALUES ($1, $2, $3, coalesce($4::timestamptz, now()), $5, $6) RETURNING id`,
        [userId, decisionId, scope, starts ?? null, ends, ends === null],
      );
      return rows[0]?.id ?? '';
    }

    async function grant(userId: string, by: string): Promise<string> {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO contributor_grant (user_id, granted_by, reason, rules_version, accepted_at)
         VALUES ($1, $2, 'reads the game well and argues it politely', $3, now())
         RETURNING id`,
        [userId, by, RULES],
      );
      return rows[0]?.id ?? '';
    }

    async function event(grantId: string, kind: string, actor: string): Promise<void> {
      await pool.query(
        `INSERT INTO contributor_grant_event (grant_id, kind, actor_id, reason)
         VALUES ($1, $2, $3, 'recorded by the schema suite')`,
        [grantId, kind, actor],
      );
    }

    function standing(grantId: string): Promise<string> {
      return pool
        .query<{ s: string }>(`SELECT contributor_grant_standing($1) AS s`, [grantId])
        .then(({ rows }) => rows[0]?.s ?? '');
    }

    function mayContribute(userId: string): Promise<boolean> {
      return pool
        .query<{ yes: boolean }>(`SELECT member_may_contribute($1) AS yes`, [userId])
        .then(({ rows }) => rows[0]?.yes ?? false);
    }

    interface InputRow {
      username: string;
      email_verified: boolean;
      rating: string | null;
      settled_count: number | null;
      under_sanction: boolean;
      last_sanctioned_at: Date | null;
    }

    async function input(userId: string): Promise<InputRow | undefined> {
      const { rows } = await pool.query<InputRow>(
        `SELECT username, email_verified, rating, settled_count, under_sanction, last_sanctioned_at
           FROM contributor_eligibility_input WHERE user_id = $1`,
        [userId],
      );
      return rows[0];
    }

    beforeAll(async () => {
      pool = new Pool({ connectionString: DATABASE_URL });
    });

    afterAll(async () => {
      if (pool === undefined) return;
      // The same dedicated-connection cleanup the moderation suite uses, and for
      // the same reason: `session_replication_role = 'replica'` turns off user
      // triggers for this session only, so a parallel suite asserting that a row
      // is immutable is not quietly passing over a disabled trigger.
      const client = await pool.connect();
      try {
        await client.query(`SET session_replication_role = 'replica'`);
        await client.query(
          `DELETE FROM contributor_grant_event WHERE grant_id IN
             (SELECT id FROM contributor_grant WHERE user_id = ANY($1::uuid[]))`,
          [members],
        );
        await client.query(`DELETE FROM contributor_grant WHERE user_id = ANY($1::uuid[])`, [
          members,
        ]);
        await client.query(`DELETE FROM sanction WHERE user_id = ANY($1::uuid[])`, [members]);
        await client.query(`DELETE FROM moderation_decision WHERE moderator_id = ANY($1::uuid[])`, [
          members,
        ]);
        await client.query(`DELETE FROM rating_snapshot WHERE user_id = ANY($1::uuid[])`, [
          members,
        ]);
      } finally {
        await client.query(`SET session_replication_role = 'origin'`);
        client.release();
      }
      // Outside the replica block, because that setting also disables
      // foreign-key triggers and the account's cascade would not run.
      await pool.query(`DELETE FROM user_account WHERE id = ANY($1::uuid[])`, [members]);
      await pool.end();
    });

    describe('eligibility is computed and can grant nothing', () => {
      it('has no INSERT path, so nothing can be written into it', async () => {
        const who = await member('v1');
        // The whole argument for a view. A table of eligibility rows would be
        // one UPDATE away from being an access-control list, and the day
        // somebody wrote that UPDATE nobody would notice.
        await expect(
          pool.query(
            `INSERT INTO contributor_eligibility_input (user_id, username, email_verified)
             VALUES ($1, 'x', true)`,
            [who],
          ),
        ).rejects.toThrow();
      });

      it('carries the facts and not the verdict, so a threshold lives in one place', async () => {
        const { rows } = await pool.query<{ column_name: string }>(
          `SELECT column_name FROM information_schema.columns
            WHERE table_name = 'contributor_eligibility_input'`,
        );
        const columns = rows.map((r) => r.column_name).sort();
        expect(columns).toEqual([
          'email_verified',
          'last_sanctioned_at',
          'rating',
          'settled_count',
          'under_sanction',
          'user_id',
          'username',
        ]);
        // No `qualifies`, no `eligible`: the numbers are configuration
        // (`13-policy.md` section 1) and copying them into SQL would make two
        // answers possible to the same question.
        expect(columns).not.toContain('qualifies');
        expect(columns).not.toContain('eligible');
      });

      it('keeps a member who has settled nothing, with a null rating rather than a zero', async () => {
        const fresh = await member('v2');
        const row = await input(fresh);
        // Dropped by an inner join, this member would have been indistinguishable
        // from somebody who does not exist; given a zero, indistinguishable from
        // somebody rated badly (rule 3).
        expect(row?.rating).toBeNull();
        expect(row?.settled_count).toBeNull();
        expect(row?.email_verified).toBe(true);
      });

      it('reports an unverified e-mail as unverified', async () => {
        const quiet = await member('v3', false);
        expect((await input(quiet))?.email_verified).toBe(false);
      });

      it('reads the newest rating snapshot and not the first', async () => {
        const climbing = await member('v4');
        await rate(climbing, 62, 40);
        await rate(climbing, 74, 55);
        const row = await input(climbing);
        expect(Number(row?.rating)).toBe(74);
        expect(row?.settled_count).toBe(55);
      });
    });

    describe('conduct is one of the four, and asks about every restriction', () => {
      it('sees a sanction whose scope it was never told about', async () => {
        const [subject, moderator] = await Promise.all([member('c1'), member('c2')]);
        expect((await input(subject))?.under_sanction).toBe(false);

        // Deliberately not `contact`. An eligibility check written as
        // `member_sanctioned(m, 'contact')` would report a clean record here,
        // and would go on doing so for every scope added after it.
        const d = await decision(moderator, subject, 'sanctioned');
        await sanction(subject, d, 'groups', new Date(Date.now() + 86_400_000).toISOString());

        expect((await input(subject))?.under_sanction).toBe(true);
      });

      it('stops seeing a sanction that has ended', async () => {
        const [subject, moderator] = await Promise.all([member('c3'), member('c4')]);
        const d = await decision(moderator, subject, 'sanctioned');
        // Served: it began two days ago and ended yesterday. A sanction may not
        // end before it starts, so both ends are set.
        await sanction(
          subject,
          d,
          'contact',
          new Date(Date.now() - 86_400_000).toISOString(),
          new Date(Date.now() - 2 * 86_400_000).toISOString(),
        );
        expect((await input(subject))?.under_sanction).toBe(false);
      });

      it('reports the newest sanctioned decision and ignores the other outcomes', async () => {
        const [subject, moderator] = await Promise.all([member('c5'), member('c6')]);
        await decision(moderator, subject, 'warned');
        await decision(moderator, subject, 'no_action');
        expect((await input(subject))?.last_sanctioned_at).toBeNull();

        const old = '2020-01-01T00:00:00Z';
        await decision(moderator, subject, 'sanctioned', old);
        const recent = '2024-06-01T00:00:00Z';
        await decision(moderator, subject, 'sanctioned', recent);

        // Sent whatever its age. The ninety-day window is applied where the
        // other three thresholds are; the view that hid an old decision would
        // make its own answer impossible to explain.
        expect((await input(subject))?.last_sanctioned_at?.toISOString()).toBe(
          new Date(recent).toISOString(),
        );
      });
    });

    describe('a grant is a decision somebody made, and stays one', () => {
      it('refuses a blank reason and an unversioned acceptance', async () => {
        const [who, by] = await Promise.all([member('g1'), member('g2')]);
        await expect(
          pool.query(
            `INSERT INTO contributor_grant (user_id, granted_by, reason, rules_version, accepted_at)
             VALUES ($1, $2, '   ', $3, now())`,
            [who, by, RULES],
          ),
        ).rejects.toMatchObject({ constraint: 'contributor_grant_reason_not_blank' });

        await expect(
          pool.query(
            `INSERT INTO contributor_grant (user_id, granted_by, reason, rules_version, accepted_at)
             VALUES ($1, $2, 'because', 'contributor-rules', now())`,
            [who, by],
          ),
        ).rejects.toMatchObject({ constraint: 'contributor_grant_rules_format' });
      });

      it('cannot be edited or deleted afterwards', async () => {
        const [who, by] = await Promise.all([member('g3'), member('g4')]);
        const id = await grant(who, by);

        await expect(
          pool.query(`UPDATE contributor_grant SET reason = 'a different story' WHERE id = $1`, [
            id,
          ]),
        ).rejects.toThrow();
        await expect(
          pool.query(`DELETE FROM contributor_grant WHERE id = $1`, [id]),
        ).rejects.toThrow();
      });

      it('starts active without anybody having to say so', async () => {
        const [who, by] = await Promise.all([member('g5'), member('g6')]);
        const id = await grant(who, by);
        expect(await standing(id)).toBe('active');
        expect(await mayContribute(who)).toBe(true);
      });

      it('records an approver approving themselves rather than refusing it', async () => {
        // At launch the founder may be the only person who can grant anything.
        // The row names them twice, which is the audit trail doing its job; a
        // constraint here would have been a rule the blueprint does not have.
        const alone = await member('g7');
        const id = await grant(alone, alone);
        expect(await standing(id)).toBe('active');
      });
    });

    describe('what happens to a grant is a row, not an edit', () => {
      it('follows its newest event through pause and resume', async () => {
        const [who, by] = await Promise.all([member('e1'), member('e2')]);
        const id = await grant(who, by);

        await event(id, 'paused', by);
        expect(await standing(id)).toBe('paused');
        expect(await mayContribute(who)).toBe(false);

        await event(id, 'resumed', by);
        expect(await standing(id)).toBe('active');
        expect(await mayContribute(who)).toBe(true);
      });

      it('keeps every event, so the history survives the outcome', async () => {
        const [who, by] = await Promise.all([member('e3'), member('e4')]);
        const id = await grant(who, by);
        await event(id, 'paused', by);
        await event(id, 'resumed', by);
        await event(id, 'withdrawn', by);

        const { rows } = await pool.query<{ kind: string }>(
          `SELECT kind FROM contributor_grant_event WHERE grant_id = $1 ORDER BY seq`,
          [id],
        );
        expect(rows.map((r) => r.kind)).toEqual(['paused', 'resumed', 'withdrawn']);
      });

      it('refuses a blank reason, because a pause nobody explained is one nobody can appeal', async () => {
        const [who, by] = await Promise.all([member('e5'), member('e6')]);
        const id = await grant(who, by);
        await expect(
          pool.query(
            `INSERT INTO contributor_grant_event (grant_id, kind, actor_id, reason)
             VALUES ($1, 'paused', $2, ' ')`,
            [id, by],
          ),
        ).rejects.toMatchObject({ constraint: 'contributor_grant_event_reason_not_blank' });
      });

      it('cannot be edited or deleted afterwards either', async () => {
        const [who, by] = await Promise.all([member('e7'), member('e8')]);
        const id = await grant(who, by);
        await event(id, 'paused', by);
        await expect(
          pool.query(`UPDATE contributor_grant_event SET kind = 'resumed' WHERE grant_id = $1`, [
            id,
          ]),
        ).rejects.toThrow();
      });

      it('resolves two events written in one transaction by order, not by coin toss', async () => {
        const [who, by] = await Promise.all([member('e9'), member('e10')]);
        const id = await grant(who, by);
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          // Both rows get the same `now()`. Without the sequence tie-break the
          // standing here would be whichever uuid sorted higher.
          await client.query(
            `INSERT INTO contributor_grant_event (grant_id, kind, actor_id, reason)
             VALUES ($1, 'paused', $2, 'first')`,
            [id, by],
          );
          await client.query(
            `INSERT INTO contributor_grant_event (grant_id, kind, actor_id, reason)
             VALUES ($1, 'resumed', $2, 'second')`,
            [id, by],
          );
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
        expect(await standing(id)).toBe('active');
      });
    });

    describe('the transitions that cannot happen are refused, not ignored', () => {
      it('refuses anything at all after a withdrawal', async () => {
        const [who, by] = await Promise.all([member('t1'), member('t2')]);
        const id = await grant(who, by);
        await event(id, 'withdrawn', by);
        expect(await standing(id)).toBe('withdrawn');
        expect(await mayContribute(who)).toBe(false);

        await expect(event(id, 'resumed', by)).rejects.toMatchObject({ code: 'PL013' });
        await expect(event(id, 'paused', by)).rejects.toMatchObject({ code: 'PL013' });
      });

      it('refuses a second pause and a resume of something that is not paused', async () => {
        const [who, by] = await Promise.all([member('t3'), member('t4')]);
        const id = await grant(who, by);

        await expect(event(id, 'resumed', by)).rejects.toMatchObject({ code: 'PL013' });
        await event(id, 'paused', by);
        const second = await event(id, 'paused', by).catch((error: unknown) => sqlstate(error));
        expect(second).toBe('PL013');
      });

      it('refuses a second live grant, and allows a new one after a withdrawal', async () => {
        const [who, by] = await Promise.all([member('t5'), member('t6')]);
        const first = await grant(who, by);

        // Two live grants would make "when did it stop" ambiguous, which is the
        // one question these tables exist to answer.
        await expect(grant(who, by)).rejects.toMatchObject({ code: 'PL013' });

        await event(first, 'withdrawn', by);
        const second = await grant(who, by);
        expect(second).not.toBe(first);
        expect(await mayContribute(who)).toBe(true);
        // The withdrawn one is still there, still saying who ended it and when.
        expect(await standing(first)).toBe('withdrawn');
      });
    });

    describe('approval and eligibility never consult each other', () => {
      it('lets a granted member post although they qualify for nothing', async () => {
        const [who, by] = await Promise.all([member('i1'), member('i2')]);
        // No rating, no settled predictions: this member would fail every
        // measurable requirement.
        const row = await input(who);
        expect(row?.rating).toBeNull();

        await grant(who, by);
        // A person decided. The gate asks about the decision, not about the
        // numbers, because a number that could revoke a signed approval would
        // be granting and withdrawing on its own.
        expect(await mayContribute(who)).toBe(true);
      });

      it('does not let a member who meets every requirement post without a grant', async () => {
        const qualified = await member('i3');
        await rate(qualified, 88, 200);
        const row = await input(qualified);
        expect(Number(row?.rating)).toBe(88);
        expect(row?.settled_count).toBe(200);
        expect(row?.under_sanction).toBe(false);
        expect(row?.last_sanctioned_at).toBeNull();

        // Everything the platform can measure says yes, and the answer is still
        // no. That is blueprint 10.2's fifth requirement, in one assertion.
        expect(await mayContribute(qualified)).toBe(false);
      });
    });
  },
);
