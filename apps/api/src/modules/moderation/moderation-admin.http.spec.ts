import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { IdentityModule } from '../identity/identity.module';
import {
  DEFAULT_IDENTITY_OPTIONS,
  IDENTITY_OPTIONS,
  type IdentityOptions,
} from '../identity/identity.service';
import { CaptureMailer, MAILER } from '../identity/internal/mailer';
import { SocialModule } from '../social/social.module';
import { ModerationModule } from './moderation.module';

/**
 * The moderation queue (T-212).
 *
 * The acceptance criterion is rule 10: **every action records actor, time,
 * reason and previous value**. So the tests do not stop at the status code —
 * they read `audit_log` afterwards and check that the row is there, in the same
 * transaction as the change that produced it (D-046).
 */
const DATABASE_URL = process.env.DATABASE_URL;
const ENGLAND = '00000000-0000-4000-8000-000000000101';
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);

const options: IdentityOptions = {
  ...DEFAULT_IDENTITY_OPTIONS,
  sessionSecret: 'test-secret-'.repeat(4),
  webBaseUrl: 'http://web.test',
  cookieSecure: false,
};

function cookieValue(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return /^fmip_session=([^;]*)/.exec(header ?? '')?.[1] ?? '';
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('the moderation queue', () => {
  let app: NestFastifyApplication;
  let pool: Pool;

  const moderator = `mq_${RUN}m`;
  const offender = `mq_${RUN}o`;
  const first = `mq_${RUN}a`;
  const second = `mq_${RUN}b`;
  const cookies = new Map<string, string>();
  const ids = new Map<string, string>();

  const register = async (username: string) => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        username,
        display_name: `Member ${username}`,
        email: `${username}@example.test`,
        password: 'a perfectly fine passphrase',
        country_id: ENGLAND,
        preferred_language: 'en',
        timezone: 'Europe/London',
        accept_rules: true,
      },
    });
    expect(response.statusCode).toBe(201);
    cookies.set(username, cookieValue(response.headers['set-cookie']));
    const { rows } = await pool.query<{ id: string }>(
      `UPDATE user_account SET email_verified_at = now() WHERE username = $1 RETURNING id`,
      [username],
    );
    ids.set(username, rows[0]?.id ?? '');
  };

  const as = (who?: string) =>
    who === undefined ? {} : { cookie: `fmip_session=${cookies.get(who) ?? ''}` };
  const get = (url: string, who?: string) => app.inject({ method: 'GET', url, headers: as(who) });
  const post = (url: string, payload: unknown, who?: string) =>
    app.inject({
      method: 'POST',
      url,
      payload: payload as Record<string, unknown>,
      headers: as(who),
    });

  const auditFor = (targetId: string) =>
    pool
      .query<{ action: string; reason: string; next: unknown }>(
        `SELECT action, reason, next FROM audit_log
          WHERE target_id = $1 ORDER BY created_at DESC`,
        [targetId],
      )
      .then(({ rows }) => rows);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, IdentityModule, ModerationModule, SocialModule],
    })
      .overrideProvider(MAILER)
      .useValue(new CaptureMailer())
      .overrideProvider(IDENTITY_OPTIONS)
      .useValue(options)
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    pool = new Pool({ connectionString: DATABASE_URL });

    for (const username of [moderator, offender, first, second]) await register(username);
    await pool.query(
      `INSERT INTO user_role (user_id, role, granted_by, reason)
       VALUES ($1, 'moderator', $1, 'the moderation queue test')`,
      [ids.get(moderator)],
    );

    // Two members report the same person: three reports and one judgement is
    // the case the queue is shaped around.
    for (const reporter of [first, second]) {
      expect(
        (
          await post(
            '/reports',
            { subject_type: 'member', subject: offender, reason: 'spam' },
            reporter,
          )
        ).statusCode,
      ).toBe(204);
    }
  });

  afterAll(async () => {
    const everyone = [...ids.values()];
    const client = await pool.connect();
    try {
      await client.query(`SET session_replication_role = 'replica'`);
      await client.query(`DELETE FROM audit_log WHERE actor_id = ANY($1::uuid[])`, [everyone]);
      await client.query(
        `DELETE FROM appeal_note WHERE sanction_id IN
           (SELECT id FROM sanction WHERE user_id = ANY($1::uuid[]))`,
        [everyone],
      );
      await client.query(`DELETE FROM sanction WHERE user_id = ANY($1::uuid[])`, [everyone]);
      // Reports go before the decisions they name. Nulling `decision_id`
      // instead would make two reports from one reporter about one subject open
      // at once, which the one-open-report index refuses -- a cleanup that
      // fails is a suite that fails for a reason nobody can read.
      await client.query(`DELETE FROM report WHERE reporter_id = ANY($1::uuid[])`, [everyone]);
      await client.query(`DELETE FROM moderation_decision WHERE moderator_id = ANY($1::uuid[])`, [
        everyone,
      ]);
      await client.query(`DELETE FROM user_role WHERE user_id = ANY($1::uuid[])`, [everyone]);
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
    await pool.query(`DELETE FROM user_account WHERE username LIKE $1`, [`mq_${RUN}%`]);
    await pool.end();
    await app.close();
  });

  it('is closed to a guest and to an ordinary member', async () => {
    expect((await get('/admin/moderation/queue')).statusCode).toBe(401);
    expect((await get('/admin/moderation/queue', first)).statusCode).toBe(403);
    expect(
      (await post('/admin/moderation/decisions', { subject: offender }, first)).statusCode,
    ).toBe(403);
  });

  it('groups the open reports by subject, oldest waiter first', async () => {
    const queue = (await get('/admin/moderation/queue', moderator)).json();
    const subject = queue.subjects.find((s: { username: string }) => s.username === offender) as {
      reports: { reporter: string }[];
      waiting_since: string;
      active_sanctions: number;
    };

    expect(subject).toBeDefined();
    // Two reports, one row. A moderator shown them separately either decides
    // twice or leaves one behind in a queue nobody looks at again.
    expect(subject.reports.map((r) => r.reporter).sort()).toEqual([first, second].sort());
    expect(subject.waiting_since).toBeTruthy();
    expect(subject.active_sanctions).toBe(0);
    expect(queue.open_total).toBeGreaterThanOrEqual(2);
  });

  it('refuses a decision whose outcome and restriction disagree', async () => {
    const missing = await post(
      '/admin/moderation/decisions',
      { subject: offender, outcome: 'sanctioned', reason: 'spam' },
      moderator,
    );
    // An outcome that says a restriction was applied and applies none is a
    // record of something that did not happen.
    expect(missing.statusCode).toBe(400);
    expect(missing.json().fields.sanction).toBeTruthy();

    const stray = await post(
      '/admin/moderation/decisions',
      {
        subject: offender,
        outcome: 'warned',
        reason: 'first warning',
        sanction: { scope: 'contact', days: 7 },
      },
      moderator,
    );
    expect(stray.statusCode).toBe(400);

    const unreasoned = await post(
      '/admin/moderation/decisions',
      { subject: offender, outcome: 'no_action', reason: '  ' },
      moderator,
    );
    expect(unreasoned.statusCode).toBe(400);
    expect(unreasoned.json().fields.reason).toBeTruthy();
  });

  it('answers both reports with one decision, applies the sanction, and records all of it', async () => {
    const queue = (await get('/admin/moderation/queue', moderator)).json();
    const subject = queue.subjects.find((s: { username: string }) => s.username === offender) as {
      reports: { id: string }[];
    };

    const decided = await post(
      '/admin/moderation/decisions',
      {
        subject: offender,
        report_ids: subject.reports.map((r) => r.id),
        outcome: 'sanctioned',
        reason: 'unsolicited requests to two members after being asked to stop',
        sanction: { scope: 'contact', days: 7 },
      },
      moderator,
    );

    expect(decided.statusCode).toBe(201);
    expect(decided.json().answered).toBe(2);

    // Gone from the queue: one judgement closed both.
    const after = (await get('/admin/moderation/queue', moderator)).json();
    expect(after.subjects.some((s: { username: string }) => s.username === offender)).toBe(false);

    // The restriction is in force, and the member can see it.
    expect((await get('/me/standing', offender)).json().sanctions[0]).toMatchObject({
      scope: 'contact',
      active: true,
      permanent: false,
    });
    expect((await post(`/me/friend-requests/${first}`, null, offender)).statusCode).toBe(403);

    // Rule 10: actor, time, reason, and what changed — written in the same
    // transaction as the decision (D-046), so there is no version of this where
    // the sanction exists and the record does not.
    const audit = await auditFor(ids.get(offender) ?? '');
    expect(audit[0]?.action).toBe('moderation.decide');
    expect(audit[0]?.reason).toMatch(/unsolicited requests/);
    expect(audit[0]?.next).toMatchObject({ outcome: 'sanctioned', reports_answered: 2 });
  });

  it('shows a moderator the member’s whole history before they decide again', async () => {
    const history = (await get(`/admin/moderation/members/${offender}`, moderator)).json();

    expect(history.username).toBe(offender);
    expect(history.reports_about_them.length).toBeGreaterThanOrEqual(2);
    expect(history.decisions[0]).toMatchObject({ outcome: 'sanctioned', moderator });
    expect(history.sanctions[0]).toMatchObject({ scope: 'contact', active: true });
    expect((await get(`/admin/moderation/members/nobody_${RUN}`, moderator)).statusCode).toBe(404);
  });

  it('lifts a sanction with a reason, records it, and refuses a second lift', async () => {
    const sanctionId = (await get('/me/standing', offender)).json().sanctions[0].id;

    expect(
      (await post(`/admin/moderation/sanctions/${sanctionId}/lift`, { reason: '  ' }, moderator))
        .statusCode,
    ).toBe(400);

    expect(
      (
        await post(
          `/admin/moderation/sanctions/${sanctionId}/lift`,
          { reason: 'appeal upheld: the messages were replies' },
          moderator,
        )
      ).statusCode,
    ).toBe(204);

    expect((await get('/me/standing', offender)).json().sanctions[0]).toMatchObject({
      active: false,
      lifted_by: moderator,
    });
    // The member can reach people again.
    expect((await post(`/me/friend-requests/${second}`, null, offender)).statusCode).toBe(204);

    const audit = await auditFor(ids.get(offender) ?? '');
    expect(audit[0]?.action).toBe('moderation.lift');
    expect(audit[0]?.reason).toMatch(/appeal upheld/);

    // Already lifted, expired or never there: all the same answer.
    expect(
      (await post(`/admin/moderation/sanctions/${sanctionId}/lift`, { reason: 'again' }, moderator))
        .statusCode,
    ).toBe(404);
  });
});
