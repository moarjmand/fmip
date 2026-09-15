import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The public match panel against the real schema (T-251).
 *
 * The acceptance criterion is **a guest reads; an unapproved member cannot post
 * and is told why**, and the half that belongs to the database is the second.
 * Reading is a query with no gate in it; posting is refused at the write path,
 * by three guards that fire in a fixed order, and getting that order wrong is
 * the failure nobody would notice — the refusal would still happen, and the
 * member would be told the wrong reason for it.
 *
 * Nothing in the API writes this table yet. This writes what the service will
 * write.
 */
const DATABASE_URL = process.env.DATABASE_URL;

const ENGLAND = '00000000-0000-4000-8000-000000000101';
const PL_2025 = '00000000-0000-4000-8000-000000000302';
const REGULAR_SEASON = '00000000-0000-4000-8000-000000000401';
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const RULES = 'contributor-rules@1.0.0';

interface Codeful {
  code?: string;
  hint?: string;
}

const sqlstate = (error: unknown): string | undefined => (error as Codeful).code;
const hint = (error: unknown): string | undefined => (error as Codeful).hint;

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('the match panel', () => {
  let pool: Pool;
  const members: string[] = [];
  const teams = [randomUUID(), randomUUID()];
  let match = '';

  async function member(label: string): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO user_account
         (username, display_name, email, country_id, preferred_language, timezone,
          accepted_rules_at, email_verified_at)
       VALUES ($1, $2, $3, $4, 'en', 'Europe/London', now(), now())
       RETURNING id`,
      [
        `pp${label}${RUN}`.toLowerCase().slice(0, 20),
        `Panel ${label}`,
        `pp${label}${RUN}@example.test`.toLowerCase(),
        ENGLAND,
      ],
    );
    const id = rows[0]?.id ?? '';
    members.push(id);
    return id;
  }

  async function approve(userId: string, by: string): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO contributor_grant (user_id, granted_by, reason, rules_version, accepted_at)
       VALUES ($1, $2, 'the panel schema suite', $3, now()) RETURNING id`,
      [userId, by, RULES],
    );
    return rows[0]?.id ?? '';
  }

  async function restrict(userId: string, by: string, scope: string): Promise<void> {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO moderation_decision
         (moderator_id, subject_type, subject_id, outcome, reason)
       VALUES ($1, 'member', $2, 'sanctioned', 'the panel schema suite') RETURNING id`,
      [by, userId],
    );
    await pool.query(
      `INSERT INTO sanction (user_id, decision_id, scope, ends_at, permanent)
       VALUES ($1, $2, $3, now() + interval '7 days', false)`,
      [userId, rows[0]?.id ?? '', scope],
    );
  }

  const post = (authorId: string, body = 'City press high and leave the channels open.') =>
    pool.query<{ id: string }>(
      `INSERT INTO panel_post (fixture_id, author_id, body) VALUES ($1, $2, $3) RETURNING id`,
      [match, authorId, body],
    );

  let operator = '';

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    operator = await member('op');
    for (const [index, id] of teams.entries()) {
      await pool.query(
        `INSERT INTO team (id, country_id, name, short_name, kind, gender)
         VALUES ($1, $2, $3, $4, 'club', 'men')`,
        [id, ENGLAND, `Panel Team ${index}${RUN}`, `PT${index}`],
      );
    }
    match = randomUUID();
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
    // T-253: a fixture has no discussion until an operator opens one, so this
    // suite opens the one it writes to. Before T-253 every fixture had a panel
    // by default, which is the wrong default and is what that task changed.
    await pool.query(
      `INSERT INTO match_panel (fixture_id, opened_by, reason)
       VALUES ($1, $2, 'the panel schema suite')`,
      [match, operator],
    );
  });

  afterAll(async () => {
    if (pool === undefined) return;
    const client = await pool.connect();
    try {
      await client.query(`SET session_replication_role = 'replica'`);
      await client.query(`DELETE FROM panel_post WHERE fixture_id = $1`, [match]);
      await client.query(`DELETE FROM match_panel WHERE fixture_id = $1`, [match]);
      await client.query(`DELETE FROM rate_window WHERE user_id = ANY($1::uuid[])`, [members]);
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

  describe('posting needs a person to have approved you', () => {
    it('refuses a member nobody approved, however good their record', async () => {
      const nobody = await member('a1');
      // No rating is set up for this member on purpose: the guard does not look
      // at one. Qualifying is arithmetic; posting here needs a decision.
      await expect(post(nobody)).rejects.toMatchObject({ code: 'PL014' });
    });

    it('admits a member holding a live grant', async () => {
      const [writer, approver] = await Promise.all([member('a2'), member('a3')]);
      await approve(writer, approver);
      const { rows } = await post(writer);
      expect(rows[0]?.id).toBeTruthy();
    });

    it('refuses again the moment the grant is paused, and admits again when it resumes', async () => {
      const [writer, approver] = await Promise.all([member('a4'), member('a5')]);
      const grant = await approve(writer, approver);
      await expect(post(writer)).resolves.toBeTruthy();

      await pool.query(
        `INSERT INTO contributor_grant_event (grant_id, kind, actor_id, reason)
         VALUES ($1, 'paused', $2, 'the panel schema suite')`,
        [grant, approver],
      );
      await expect(post(writer)).rejects.toMatchObject({ code: 'PL014' });

      await pool.query(
        `INSERT INTO contributor_grant_event (grant_id, kind, actor_id, reason)
         VALUES ($1, 'resumed', $2, 'the panel schema suite')`,
        [grant, approver],
      );
      await expect(post(writer)).resolves.toBeTruthy();
    });

    it('leaves what a withdrawn contributor already wrote exactly where it is', async () => {
      const [writer, approver] = await Promise.all([member('a6'), member('a7')]);
      const grant = await approve(writer, approver);
      const { rows } = await post(writer, 'a thing they said while approved');
      const written = rows[0]?.id ?? '';

      await pool.query(
        `INSERT INTO contributor_grant_event (grant_id, kind, actor_id, reason)
         VALUES ($1, 'withdrawn', $2, 'the panel schema suite')`,
        [grant, approver],
      );
      await expect(post(writer)).rejects.toMatchObject({ code: 'PL014' });

      // The post stays. It was written by an approved contributor, and deleting
      // it because the approval later ended would rewrite the record rather than
      // correct it. The reader is told the standing; they are not told a lie.
      const still = await pool.query<{ body: string }>(
        `SELECT body FROM panel_post WHERE id = $1`,
        [written],
      );
      expect(still.rows[0]?.body).toBe('a thing they said while approved');
    });
  });

  describe('the guards refuse in a fixed order, so the reason is the right one', () => {
    it('tells an unapproved and restricted member that they are not approved', async () => {
      const [writer, approver] = await Promise.all([member('o1'), member('o2')]);
      await restrict(writer, approver, 'post');

      // The opposite precedence to messaging, deliberately. There, the
      // restriction is heard because it is the one that can be appealed. Here,
      // an appeal could be won and the member still could not post — so they
      // hear the refusal that outlives the sanction.
      const failure = await post(writer).catch((error: unknown) => error);
      expect(sqlstate(failure)).toBe('PL014');
      expect(hint(failure)).toBe('no live contributor grant');
    });

    it('tells an approved but restricted member about the restriction', async () => {
      const [writer, approver] = await Promise.all([member('o3'), member('o4')]);
      await approve(writer, approver);
      await restrict(writer, approver, 'post');

      const failure = await post(writer).catch((error: unknown) => error);
      expect(sqlstate(failure)).toBe('PL004');
      expect(hint(failure)).toBe('post');
    });

    it('does not treat a restriction on something else as a restriction on this', async () => {
      const [writer, approver] = await Promise.all([member('o5'), member('o6')]);
      await approve(writer, approver);
      // A contact sanction stops friend requests. Blueprint 10.4's ladder is per
      // behaviour, and a scope that leaked into every surface would be a
      // permanent ban issued by accident.
      await restrict(writer, approver, 'contact');
      await expect(post(writer)).resolves.toBeTruthy();
    });

    it('holds the ceiling, and refuses the one past it', async () => {
      const [writer, approver] = await Promise.all([member('o7'), member('o8')]);
      await approve(writer, approver);
      const { rows } = await pool.query<{ per_hour: number }>(
        `SELECT per_hour FROM rate_limit WHERE action = 'panel_post'`,
      );
      const ceiling = rows[0]?.per_hour ?? 0;
      expect(ceiling).toBeGreaterThan(0);

      for (let n = 0; n < ceiling; n += 1) await post(writer, `post number ${n}`);
      await expect(post(writer, 'one too many')).rejects.toMatchObject({ code: 'PL005' });
    });
  });

  describe('a post is removed, never edited', () => {
    it('refuses a rewrite of the body and refuses a DELETE', async () => {
      const [writer, approver] = await Promise.all([member('r1'), member('r2')]);
      await approve(writer, approver);
      const { rows } = await post(writer);
      const id = rows[0]?.id ?? '';

      await expect(
        pool.query(`UPDATE panel_post SET body = 'a different opinion' WHERE id = $1`, [id]),
      ).rejects.toMatchObject({ code: 'PL007' });
      await expect(pool.query(`DELETE FROM panel_post WHERE id = $1`, [id])).rejects.toMatchObject({
        code: 'PL007',
      });
    });

    it('allows the tombstone, and says who took it down', async () => {
      const [writer, approver] = await Promise.all([member('r3'), member('r4')]);
      await approve(writer, approver);
      const { rows } = await post(writer);
      const id = rows[0]?.id ?? '';

      await pool.query(
        `UPDATE panel_post SET removed_at = now(), removed_by = $1, removed_kind = 'moderator', body = NULL
          WHERE id = $2`,
        [approver, id],
      );
      const after = await pool.query<{ body: string | null; removed_kind: string }>(
        `SELECT body, removed_kind FROM panel_post WHERE id = $1`,
        [id],
      );
      expect(after.rows[0]?.body).toBeNull();
      expect(after.rows[0]?.removed_kind).toBe('moderator');
    });

    it('refuses a second removal, so a moderator cannot overwrite the author', async () => {
      const [writer, approver] = await Promise.all([member('r5'), member('r6')]);
      await approve(writer, approver);
      const { rows } = await post(writer);
      const id = rows[0]?.id ?? '';
      await pool.query(
        `UPDATE panel_post SET removed_at = now(), removed_by = $1, removed_kind = 'author', body = NULL
          WHERE id = $2`,
        [writer, id],
      );
      await expect(
        pool.query(
          `UPDATE panel_post SET removed_at = now(), removed_by = $1, removed_kind = 'moderator'
            WHERE id = $2`,
          [approver, id],
        ),
      ).rejects.toMatchObject({ code: 'PL007' });
    });

    it('refuses a removal that does not say what kind it was', async () => {
      const [writer, approver] = await Promise.all([member('r7'), member('r8')]);
      await approve(writer, approver);
      const { rows } = await post(writer);
      // The case the constraint was written around. `NULL IN ('author',
      // 'moderator')` is NULL and a CHECK only fails on FALSE, so the obvious
      // spelling of this rule would have admitted a post with its body gone and
      // nothing saying who took it down.
      await expect(
        pool.query(
          `UPDATE panel_post SET removed_at = now(), removed_by = $1, body = NULL WHERE id = $2`,
          [approver, rows[0]?.id ?? ''],
        ),
      ).rejects.toMatchObject({ constraint: 'panel_post_removal_is_whole' });
    });

    it('lets the remover delete their account, and keeps the removal minus the name', async () => {
      const [writer, approver, mod] = await Promise.all([
        member('r11'),
        member('r12'),
        member('r13'),
      ]);
      await approve(writer, approver);
      const { rows } = await post(writer);
      const id = rows[0]?.id ?? '';
      await pool.query(
        `UPDATE panel_post SET removed_at = now(), removed_by = $1, removed_kind = 'moderator', body = NULL
          WHERE id = $2`,
        [mod, id],
      );

      // The case the rewrite guard nearly got wrong. `removed_by` is ON DELETE
      // SET NULL, and that cascade is an ordinary UPDATE on an already-removed
      // row -- so a guard that refused every UPDATE after removal would make
      // deleting an account fail for anybody who had ever taken a post down,
      // and report it as a moderation error they could make no sense of.
      await expect(
        pool.query(`DELETE FROM user_account WHERE id = $1`, [mod]),
      ).resolves.toBeTruthy();
      members.splice(members.indexOf(mod), 1);

      const after = await pool.query<{ removed_kind: string; removed_by: string | null }>(
        `SELECT removed_kind, removed_by FROM panel_post WHERE id = $1`,
        [id],
      );
      // The fact and the kind survive; only the name is gone -- the same trade
      // predictions make (blueprint 1.6).
      expect(after.rows[0]?.removed_kind).toBe('moderator');
      expect(after.rows[0]?.removed_by).toBeNull();
    });

    it('refuses an empty post', async () => {
      const [writer, approver] = await Promise.all([member('r9'), member('r10')]);
      await approve(writer, approver);
      await expect(post(writer, '   ')).rejects.toMatchObject({
        constraint: 'panel_post_body_or_tombstone',
      });
    });
  });

  describe('a panel post is reportable, by anybody', () => {
    it('accepts a report about one from a member who could never post', async () => {
      const [writer, approver, reader] = await Promise.all([
        member('p1'),
        member('p2'),
        member('p3'),
      ]);
      await approve(writer, approver);
      const { rows } = await post(writer);

      // Reaching the public is gated; getting help about somebody who has is
      // not. A reader who cannot post must still be able to report.
      await expect(
        pool.query(
          `INSERT INTO report (reporter_id, subject_type, subject_id, reason)
           VALUES ($1, 'panel_post', $2, 'abuse')`,
          [reader, rows[0]?.id ?? ''],
        ),
      ).resolves.toBeTruthy();
      await pool.query(`DELETE FROM report WHERE reporter_id = $1`, [reader]);
    });
  });
});
