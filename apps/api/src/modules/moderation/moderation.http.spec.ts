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
 * The acceptance criterion for T-211, over HTTP with real sessions and the real
 * schema: **a restricted member is refused where they would have written, not
 * hidden afterwards** — and told, so they can appeal.
 *
 * `SocialModule` is here because the friend request is the write path the
 * sanction currently applies to, and the point of this task is that the
 * restriction lands there rather than in a filter somewhere downstream.
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

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('reporting and standing', () => {
  let app: NestFastifyApplication;
  let pool: Pool;

  const reporter = `mh_${RUN}r`;
  const subject = `mh_${RUN}s`;
  const restricted = `mh_${RUN}x`;
  const moderator = `mh_${RUN}m`;
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

  /** What the moderator's queue will write (T-212); written directly for now. */
  async function restrict(username: string, permanent: boolean): Promise<string> {
    const { rows: decided } = await pool.query<{ id: string }>(
      `INSERT INTO moderation_decision
         (moderator_id, subject_type, subject_id, outcome, reason)
       VALUES ($1, 'member', $2, 'sanctioned', 'repeated unsolicited requests')
       RETURNING id`,
      [ids.get(moderator), ids.get(username)],
    );
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO sanction (user_id, decision_id, scope, starts_at, ends_at, permanent)
       VALUES ($1, $2, 'contact', now() - interval '1 hour', $3, $4)
       RETURNING id`,
      [
        ids.get(username),
        decided[0]?.id,
        permanent ? null : new Date(Date.now() + 86_400_000).toISOString(),
        permanent,
      ],
    );
    return rows[0]?.id ?? '';
  }

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

    for (const username of [reporter, subject, restricted, moderator]) {
      await register(username);
    }
  });

  afterAll(async () => {
    const everyone = [...ids.values()];
    // One dedicated connection with `session_replication_role = replica`, which
    // turns off user triggers for this session only. `ALTER TABLE ... DISABLE
    // TRIGGER` is global: while it was off, the schema suite running in parallel
    // passed its immutability assertions for the wrong reason.
    const client = await pool.connect();
    try {
      await client.query(`SET session_replication_role = 'replica'`);
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
    await pool.query(`DELETE FROM user_account WHERE username LIKE $1`, [`mh_${RUN}%`]);
    await pool.end();
    await app.close();
  });

  it('tells a guest to sign in', async () => {
    for (const response of await Promise.all([
      post('/reports', { subject_type: 'member', subject, reason: 'spam' }),
      get('/me/reports'),
      get('/me/standing'),
    ])) {
      expect(response.statusCode).toBe(401);
    }
  });

  it('files a report, and a second identical one is still one report', async () => {
    expect(
      (await post('/reports', { subject_type: 'member', subject, reason: 'spam' }, reporter))
        .statusCode,
    ).toBe(204);
    // Not an error: the member has reported them, which is what they wanted.
    expect(
      (await post('/reports', { subject_type: 'member', subject, reason: 'abuse' }, reporter))
        .statusCode,
    ).toBe(204);

    const mine = (await get('/me/reports', reporter)).json().reports;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ subject_type: 'member', reason: 'spam', decision_id: null });
  });

  it('refuses "other" with nothing said, yourself, and nobody', async () => {
    const vague = await post(
      '/reports',
      { subject_type: 'member', subject, reason: 'other' },
      reporter,
    );
    expect(vague.statusCode).toBe(400);
    expect(vague.json().fields.detail).toBeTruthy();

    expect(
      (
        await post(
          '/reports',
          { subject_type: 'member', subject: reporter, reason: 'spam' },
          reporter,
        )
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await post(
          '/reports',
          { subject_type: 'member', subject: `nobody_${RUN}`, reason: 'spam' },
          reporter,
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (await post('/reports', { subject_type: 'message', subject, reason: 'spam' }, reporter))
        .statusCode,
      // `message` is not a thing that exists yet, and the API says so rather
      // than storing a report against a table nothing can open.
    ).toBe(400);
  });

  it('shows a member nothing when nothing has been done to them', async () => {
    expect((await get('/me/standing', reporter)).json()).toEqual({ sanctions: [] });
  });

  describe('a contact sanction', () => {
    let sanctionId = '';

    beforeAll(async () => {
      sanctionId = await restrict(restricted, false);
    });

    it('refuses the friend request where it would have been written, and says so', async () => {
      const refused = await post(`/me/friend-requests/${subject}`, null, restricted);

      expect(refused.statusCode).toBe(403);
      expect(refused.json().message).toMatch(/moderation restriction/i);
      // Not silently dropped: the member is told, at the moment they tried, so
      // they are not left believing they are being heard.
      expect(refused.json().message).toMatch(/appeal/i);
    });

    it('restricts that member and nobody else', async () => {
      expect((await post(`/me/friend-requests/${restricted}`, null, subject)).statusCode).toBe(204);
    });

    it('is visible to the member it is on, with its end', async () => {
      const standing = (await get('/me/standing', restricted)).json().sanctions;

      expect(standing).toHaveLength(1);
      expect(standing[0]).toMatchObject({
        scope: 'contact',
        active: true,
        permanent: false,
        username: restricted,
      });
      expect(standing[0].ends_at).toBeTruthy();
    });

    it('never stops them reporting somebody', async () => {
      // The gate points one way. A member restricted for something unrelated
      // must still be able to report the person harassing them; a product that
      // got this backwards would silence exactly the people who need to be heard.
      expect(
        (await post('/reports', { subject_type: 'member', subject, reason: 'abuse' }, restricted))
          .statusCode,
      ).toBe(204);
    });

    it('can be appealed by the member it is on, and by nobody else', async () => {
      expect(
        (await post(`/me/sanctions/${sanctionId}/appeal`, { body: '   ' }, restricted)).statusCode,
      ).toBe(400);

      expect(
        (
          await post(
            `/me/sanctions/${sanctionId}/appeal`,
            { body: 'I was answering requests I had received.' },
            restricted,
          )
        ).statusCode,
      ).toBe(204);

      const notes = (await get(`/me/sanctions/${sanctionId}/appeal`, restricted)).json().notes;
      expect(notes).toHaveLength(1);
      expect(notes[0]).toMatchObject({ author: restricted });

      // Somebody else's sanction is "not found" rather than "forbidden": a 403
      // would confirm the id exists and belongs to a member the caller is not.
      expect(
        (await post(`/me/sanctions/${sanctionId}/appeal`, { body: 'let me out' }, subject))
          .statusCode,
      ).toBe(404);
      expect((await get(`/me/sanctions/${sanctionId}/appeal`, subject)).statusCode).toBe(404);
    });
  });
});
