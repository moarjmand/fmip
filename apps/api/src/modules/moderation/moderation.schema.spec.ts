import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The moderation spine against the real schema (T-210).
 *
 * Nothing in the API writes these tables yet — T-211 is the service — so this
 * writes what the service will write and checks the guarantees that belong to
 * the database. Two of them are the reason the epic is second in the phase
 * rather than last (D-053): a decision cannot be rewritten afterwards, and a
 * sanction is refused **at the write path** rather than hidden afterwards.
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

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('the moderation spine', () => {
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
        `mod${label}${RUN}`.toLowerCase().slice(0, 20),
        `Moderation ${label}`,
        `mod${label}${RUN}@example.test`.toLowerCase(),
        ENGLAND,
      ],
    );
    const id = rows[0]?.id ?? '';
    members.push(id);
    return id;
  }

  async function report(reporter: string, subject: string, reason = 'spam'): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO report (reporter_id, subject_type, subject_id, reason)
       VALUES ($1, 'member', $2, $3) RETURNING id`,
      [reporter, subject, reason],
    );
    return rows[0]?.id ?? '';
  }

  async function decision(moderator: string, subject: string): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO moderation_decision
         (moderator_id, subject_type, subject_id, outcome, reason)
       VALUES ($1, 'member', $2, 'sanctioned', 'repeated unsolicited requests')
       RETURNING id`,
      [moderator, subject],
    );
    return rows[0]?.id ?? '';
  }

  /** `ends` null means permanent. */
  async function sanction(
    userId: string,
    decisionId: string,
    starts: string,
    ends: string | null,
  ): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO sanction (user_id, decision_id, scope, starts_at, ends_at, permanent)
       VALUES ($1, $2, 'contact', $3, $4, $5) RETURNING id`,
      [userId, decisionId, starts, ends, ends === null],
    );
    return rows[0]?.id ?? '';
  }

  function sanctioned(userId: string): Promise<boolean> {
    return pool
      .query<{ yes: boolean }>(`SELECT member_sanctioned($1, 'contact') AS yes`, [userId])
      .then(({ rows }) => rows[0]?.yes ?? false);
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
  });

  afterAll(async () => {
    if (pool === undefined) return;
    // Cleanup runs on one dedicated connection with `session_replication_role`
    // set to `replica`, which turns off user triggers **for this session only**.
    // `ALTER TABLE ... DISABLE TRIGGER` is the other way to do it and is
    // global: while it is off, a suite running in parallel that asserts a row
    // is immutable passes without testing anything.
    //
    // Everything here is RESTRICT rather than CASCADE — a moderation record that
    // vanished with the account it was about would be the wrong trade — so the
    // cleanup unwinds it in order.
    const client = await pool.connect();
    try {
      await client.query(`SET session_replication_role = 'replica'`);
      await client.query(
        `DELETE FROM appeal_note WHERE sanction_id IN
           (SELECT id FROM sanction WHERE user_id = ANY($1::uuid[]))`,
        [members],
      );
      await client.query(`DELETE FROM sanction WHERE user_id = ANY($1::uuid[])`, [members]);
      // Reports go before the decisions they name. Nulling `decision_id`
      // instead would make two reports from one reporter about one subject open
      // at once, which the one-open-report index refuses -- a cleanup that
      // fails is a suite that fails for a reason nobody can read.
      await client.query(`DELETE FROM report WHERE reporter_id = ANY($1::uuid[])`, [members]);
      await client.query(`DELETE FROM moderation_decision WHERE moderator_id = ANY($1::uuid[])`, [
        members,
      ]);
    } finally {
      await client.query(`SET session_replication_role = 'origin'`);
      client.release();
    }
    // The account delete is outside the replica block on purpose:
    // `session_replication_role = 'replica'` turns off **foreign-key**
    // triggers too, so a cascade does not run while it is set and the
    // account's credentials, sessions and tokens would be left behind. The
    // setting is only for the rows a cascade cannot reach -- the immutable
    // ones -- and it is put back before the account goes.
    await pool.query(`DELETE FROM user_account WHERE id = ANY($1::uuid[])`, [members]);
    await pool.end();
  });

  describe('a report', () => {
    it('refuses "other" with nothing said', async () => {
      const [a, b] = await Promise.all([member('r1'), member('r2')]);

      await expect(report(a, b, 'other')).rejects.toMatchObject({
        constraint: 'report_detail_required',
      });
      // With a description it is fine: "other" exists so a closed list of three
      // is not answered by picking the nearest wrong one.
      await expect(
        pool.query(
          `INSERT INTO report (reporter_id, subject_type, subject_id, reason, detail)
           VALUES ($1, 'member', $2, 'other', 'posting a competitor''s link on every profile')`,
          [a, b],
        ),
      ).resolves.toBeTruthy();
    });

    it('cannot be filed against yourself', async () => {
      const a = await member('r3');

      await expect(report(a, a)).rejects.toMatchObject({ constraint: 'report_not_self' });
    });

    it('is one open report per subject, and a new one once it is answered', async () => {
      const [a, b] = await Promise.all([member('r4'), member('r5')]);
      const first = await report(a, b);

      // Filing the same complaint twice is not two complaints.
      await expect(report(a, b)).rejects.toMatchObject({
        constraint: 'report_one_open_per_subject',
      });

      // One decision answers it. Three members reporting one person is three
      // reports and one judgement, so the link points this way and several
      // reports may name the same decision.
      await pool.query(`UPDATE report SET decision_id = $2 WHERE id = $1`, [
        first,
        await decision(await member('r6'), b),
      ]);
      // Once it has been answered, a fresh complaint is a fresh complaint.
      await expect(report(a, b)).resolves.toBeTruthy();
    });
  });

  describe('a decision', () => {
    it('cannot be rewritten or removed', async () => {
      const [moderator, subject] = await Promise.all([member('d1'), member('d2')]);
      const id = await decision(moderator, subject);

      await expect(
        pool.query(`UPDATE moderation_decision SET outcome = 'no_action' WHERE id = $1`, [id]),
      ).rejects.toThrow();
      await expect(
        pool.query(`DELETE FROM moderation_decision WHERE id = $1`, [id]),
      ).rejects.toThrow();
    });

    it('refuses a blank reason', async () => {
      const [moderator, subject] = await Promise.all([member('d3'), member('d4')]);

      await expect(
        pool.query(
          `INSERT INTO moderation_decision
             (moderator_id, subject_type, subject_id, outcome, reason)
           VALUES ($1, 'member', $2, 'warned', '   ')`,
          [moderator, subject],
        ),
      ).rejects.toMatchObject({ constraint: 'moderation_decision_reason_not_blank' });
    });
  });

  describe('a sanction', () => {
    it('must end, or say that it is permanent', async () => {
      const [moderator, subject] = await Promise.all([member('s1'), member('s2')]);
      const id = await decision(moderator, subject);

      // An end date that forgot to be permanent, and a permanent one that
      // carries an end date: both are somebody meaning one thing and writing
      // the other, and the table refuses to guess which.
      await expect(
        pool.query(
          `INSERT INTO sanction (user_id, decision_id, scope, ends_at, permanent)
           VALUES ($1, $2, 'contact', NULL, false)`,
          [subject, id],
        ),
      ).rejects.toMatchObject({ constraint: 'sanction_ends_or_is_permanent' });
      await expect(
        pool.query(
          `INSERT INTO sanction (user_id, decision_id, scope, ends_at, permanent)
           VALUES ($1, $2, 'contact', now() + interval '1 day', true)`,
          [subject, id],
        ),
      ).rejects.toMatchObject({ constraint: 'sanction_ends_or_is_permanent' });
    });

    it('is lifted whole or not at all', async () => {
      const [moderator, subject] = await Promise.all([member('s3'), member('s4')]);
      const id = await sanction(
        subject,
        await decision(moderator, subject),
        'now()',
        // A week.
        new Date(Date.now() + 7 * 86_400_000).toISOString(),
      );

      // A lift with no actor and no reason is a restriction that ended and
      // nobody is accountable for (rule 10).
      await expect(
        pool.query(`UPDATE sanction SET lifted_at = now() WHERE id = $1`, [id]),
      ).rejects.toMatchObject({ constraint: 'sanction_lift_is_whole' });
      await expect(
        pool.query(
          `UPDATE sanction SET lifted_at = now(), lifted_by = $2, lift_reason = 'appeal upheld'
            WHERE id = $1`,
          [id, moderator],
        ),
      ).resolves.toBeTruthy();
    });

    it('is in force between its start and its end, and not outside them', async () => {
      const [moderator, subject] = await Promise.all([member('s5'), member('s6')]);
      const decided = await decision(moderator, subject);
      const hour = 3_600_000;

      expect(await sanctioned(subject)).toBe(false);

      // Already over.
      await sanction(
        subject,
        decided,
        new Date(Date.now() - 2 * hour).toISOString(),
        new Date(Date.now() - hour).toISOString(),
      );
      expect(await sanctioned(subject)).toBe(false);

      // Not started yet — a sanction dated forward is not one in force.
      await sanction(
        subject,
        decided,
        new Date(Date.now() + hour).toISOString(),
        new Date(Date.now() + 2 * hour).toISOString(),
      );
      expect(await sanctioned(subject)).toBe(false);

      const live = await sanction(
        subject,
        decided,
        new Date(Date.now() - hour).toISOString(),
        new Date(Date.now() + hour).toISOString(),
      );
      expect(await sanctioned(subject)).toBe(true);

      await pool.query(
        `UPDATE sanction SET lifted_at = now(), lifted_by = $2, lift_reason = 'appeal upheld'
          WHERE id = $1`,
        [live, moderator],
      );
      expect(await sanctioned(subject)).toBe(false);
    });
  });

  describe('the sanction is enforced where the member would have written', () => {
    it('refuses their friend request with PL004, and leaves everybody else alone', async () => {
      const [restricted, other, moderator] = await Promise.all([
        member('e1'),
        member('e2'),
        member('e3'),
      ]);
      await sanction(
        restricted,
        await decision(moderator, restricted),
        new Date(Date.now() - 3_600_000).toISOString(),
        null,
      );

      const refused = await pool
        .query(`INSERT INTO friend_request (requester_id, addressee_id) VALUES ($1, $2)`, [
          restricted,
          other,
        ])
        .catch((error: unknown) => error);
      // Not hidden afterwards: refused at the moment of writing, so the member
      // is told rather than left believing they are being heard.
      expect(sqlstate(refused)).toBe('PL004');

      // The restriction is on one member, not on the pair: the other member can
      // still reach them.
      await expect(
        pool.query(`INSERT INTO friend_request (requester_id, addressee_id) VALUES ($1, $2)`, [
          other,
          restricted,
        ]),
      ).resolves.toBeTruthy();
    });
  });

  describe('an appeal note', () => {
    it('is a row, and an immutable one', async () => {
      const [moderator, subject] = await Promise.all([member('a1'), member('a2')]);
      const id = await sanction(
        subject,
        await decision(moderator, subject),
        'now()',
        new Date(Date.now() + 86_400_000).toISOString(),
      );

      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO appeal_note (sanction_id, author_id, body)
         VALUES ($1, $2, 'I was replying to requests I had received.') RETURNING id`,
        [id, subject],
      );
      const note = rows[0]?.id ?? '';

      await expect(
        pool.query(`UPDATE appeal_note SET body = 'something else' WHERE id = $1`, [note]),
      ).rejects.toThrow();
      await expect(
        pool.query(`INSERT INTO appeal_note (sanction_id, author_id, body) VALUES ($1, $2, '  ')`, [
          id,
          subject,
        ]),
      ).rejects.toMatchObject({ constraint: 'appeal_note_body_not_blank' });
    });
  });
});
