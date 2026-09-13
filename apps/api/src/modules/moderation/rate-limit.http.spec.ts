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
 * Rate limits (T-213, D-054).
 *
 * The rule belongs to moderation and the surface belongs to whichever boundary
 * it protects, so the tests live with the rule: the next surface that gets a
 * ceiling puts its test beside this one rather than in a third place.
 *
 * **A flood is refused by a rule about volume.** Nothing here reads what was
 * written — there is no classifier, and D-054 records why one is not built: in
 * a product that speaks eight languages, anything buildable would be an English
 * keyword list under-moderating seven of them while the administration page
 * reported that filtering was on.
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

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('the rate limit', () => {
  let app: NestFastifyApplication;
  let pool: Pool;

  const sender = `rl_${RUN}s`;
  const moderator = `rl_${RUN}m`;
  const targets = [`rl_${RUN}a`, `rl_${RUN}b`, `rl_${RUN}c`];
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

  const post = (url: string, who: string) =>
    app.inject({
      method: 'POST',
      url,
      headers: { cookie: `fmip_session=${cookies.get(who) ?? ''}` },
    });

  const ceiling = () =>
    pool
      .query<{ per_hour: number }>(
        `SELECT per_hour FROM rate_limit WHERE action = 'friend_request'`,
      )
      .then(({ rows }) => rows[0]?.per_hour ?? 0);

  /** Put the sender at the ceiling without sending that many requests. */
  const fillWindow = async (to: number) => {
    await pool.query(
      `INSERT INTO rate_window (user_id, action, window_start, count)
       VALUES ($1, 'friend_request', date_trunc('hour', now()), $2)
       ON CONFLICT (user_id, action, window_start) DO UPDATE SET count = $2`,
      [ids.get(sender), to],
    );
  };

  const windowCount = () =>
    pool
      .query<{ count: number }>(
        `SELECT count FROM rate_window
          WHERE user_id = $1 AND action = 'friend_request'
            AND window_start = date_trunc('hour', now())`,
        [ids.get(sender)],
      )
      .then(({ rows }) => rows[0]?.count ?? 0);

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

    for (const username of [sender, moderator, ...targets]) await register(username);
  });

  afterAll(async () => {
    const everyone = [...ids.values()];
    const client = await pool.connect();
    try {
      await client.query(`SET session_replication_role = 'replica'`);
      await client.query(`DELETE FROM audit_log WHERE actor_id = ANY($1::uuid[])`, [everyone]);
      await client.query(`DELETE FROM sanction WHERE user_id = ANY($1::uuid[])`, [everyone]);
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
    await pool.query(`DELETE FROM user_account WHERE username LIKE $1`, [`rl_${RUN}%`]);
    await pool.end();
    await app.close();
  });

  it('counts what a member sends, and lets a normal number through', async () => {
    expect((await post(`/me/friend-requests/${targets[0]}`, sender)).statusCode).toBe(204);
    expect((await post(`/me/friend-requests/${targets[1]}`, sender)).statusCode).toBe(204);

    expect(await windowCount()).toBe(2);
  });

  it('refuses the one past the ceiling, and says to wait rather than to fix something', async () => {
    await fillWindow(await ceiling());

    const refused = await post(`/me/friend-requests/${targets[2]}`, sender);

    expect(refused.statusCode).toBe(429);
    expect(refused.json()).toEqual({
      error: 'rate_limited',
      message: expect.stringContaining('friend requests'),
    });
    // A 400 would tell the caller to change the request. There is nothing wrong
    // with the request; the answer is "later".
    expect(refused.json().message).toMatch(/later/i);
  });

  it('is configuration, not a constant in a function body', async () => {
    // Blueprint 16 asks for configurable thresholds. Raising the ceiling with an
    // UPDATE is all it takes, and the next request goes through.
    const original = await ceiling();
    await pool.query(`UPDATE rate_limit SET per_hour = $1 WHERE action = 'friend_request'`, [
      original + 5,
    ]);
    try {
      expect((await post(`/me/friend-requests/${targets[2]}`, sender)).statusCode).toBe(204);
    } finally {
      await pool.query(`UPDATE rate_limit SET per_hour = $1 WHERE action = 'friend_request'`, [
        original,
      ]);
    }
  });

  it('tells a sanctioned member about the sanction, not about the ceiling', async () => {
    // Both refusals apply at once. The trigger names decide which one speaks —
    // `block` < `sanction` < `volume` — and the member hears about the
    // restriction, because that is the one with an appeal behind it.
    await fillWindow(await ceiling());
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO moderation_decision (moderator_id, subject_type, subject_id, outcome, reason)
       VALUES ($1, 'member', $2, 'sanctioned', 'flooding') RETURNING id`,
      [ids.get(moderator), ids.get(sender)],
    );
    await pool.query(
      `INSERT INTO sanction (user_id, decision_id, scope, starts_at, ends_at, permanent)
       VALUES ($1, $2, 'contact', now() - interval '1 minute', now() + interval '1 day', false)`,
      [ids.get(sender), rows[0]?.id],
    );

    const refused = await post(`/me/friend-requests/${targets[0]}`, sender);

    expect(refused.statusCode).toBe(403);
    expect(refused.json().message).toMatch(/moderation restriction/i);
  });
});
