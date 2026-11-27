import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { IdentityModule, signupsClosedFromEnv } from './identity.module';
import {
  DEFAULT_IDENTITY_OPTIONS,
  IDENTITY_OPTIONS,
  type IdentityOptions,
  SIGNUPS_CLOSED_MESSAGE,
} from './identity.service';
import { CaptureMailer, MAILER } from './internal/mailer';

// The close-sign-ups switch (T-1970, D-459): one setting that stops new
// accounts on a bad day without a deploy, while members sign in as usual.

describe('SIGNUPS_CLOSED (T-1970)', () => {
  it('is off unless set to on, and refuses to start on anything else', () => {
    expect(signupsClosedFromEnv({})).toBe(false);
    expect(signupsClosedFromEnv({ SIGNUPS_CLOSED: '' })).toBe(false);
    expect(signupsClosedFromEnv({ SIGNUPS_CLOSED: 'off' })).toBe(false);
    expect(signupsClosedFromEnv({ SIGNUPS_CLOSED: 'on' })).toBe(true);
    expect(signupsClosedFromEnv({ SIGNUPS_CLOSED: ' On ' })).toBe(true);
    // A typo fails the rollout loudly rather than leaving sign-ups open.
    expect(() => signupsClosedFromEnv({ SIGNUPS_CLOSED: 'true' })).toThrow(/SIGNUPS_CLOSED/);
    expect(() => signupsClosedFromEnv({ SIGNUPS_CLOSED: 'closed' })).toThrow(/SIGNUPS_CLOSED/);
  });
});

// Against the real schema, so "no account was written" is the database's word.
const DATABASE_URL = process.env.DATABASE_URL;

// Seeded England (packages/db/seed/001_catalog.sql).
const ENGLAND = '00000000-0000-4000-8000-000000000101';
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const PASSWORD = 'correct horse battery staple';

const base: Omit<IdentityOptions, 'signupsClosed'> = {
  ...DEFAULT_IDENTITY_OPTIONS,
  sessionSecret: 'test-secret-'.repeat(4),
  webBaseUrl: 'http://web.test',
  cookieSecure: false,
};

const registration = (name: string) => ({
  username: `sc_${RUN}_${name}`,
  display_name: 'Switch Tester',
  email: `sc_${RUN}_${name}@example.test`,
  password: PASSWORD,
  country_id: ENGLAND,
  preferred_language: 'en',
  timezone: 'Europe/London',
  accept_rules: true,
});

function cookieValue(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return /^fmip_session=([^;]*)/.exec(header ?? '')?.[1] ?? '';
}

async function appWith(signupsClosed: boolean): Promise<NestFastifyApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [DatabaseModule, IdentityModule] })
    .overrideProvider(MAILER)
    .useValue(new CaptureMailer())
    .overrideProvider(IDENTITY_OPTIONS)
    .useValue({ ...base, signupsClosed } satisfies IdentityOptions)
    .compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  'POST /auth/register behind the close-sign-ups switch (T-1970)',
  () => {
    let open: NestFastifyApplication;
    let closed: NestFastifyApplication;
    let pool: Pool;

    const post = (app: NestFastifyApplication, url: string, payload: unknown) =>
      app.inject({ method: 'POST', url, payload: payload as Record<string, unknown> });

    const accounts = async (username: string): Promise<number> => {
      const { rows } = await pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM user_account WHERE username = $1`,
        [username],
      );
      return rows[0]?.n ?? 0;
    };

    // The existing member, made here so each test stands on its own (`-t`, any order).
    const member = registration('member');

    beforeAll(async () => {
      [open, closed] = await Promise.all([appWith(false), appWith(true)]);
      pool = new Pool({ connectionString: DATABASE_URL });
      const made = await post(open, '/auth/register', member);
      if (made.statusCode !== 201) throw new Error(`member not registered: ${made.body}`);
    });

    afterAll(async () => {
      // Sessions, tokens and credentials cascade from the account.
      await pool.query(`DELETE FROM user_account WHERE username LIKE $1`, [`sc_${RUN}%`]);
      await pool.end();
      await Promise.all([open.close(), closed.close()]);
    });

    it('with the switch off, sign-up works', async () => {
      const body = registration('opened');
      const response = await post(open, '/auth/register', body);
      expect(response.statusCode).toBe(201);
      expect(response.json().user.username).toBe(body.username);
      expect(cookieValue(response.headers['set-cookie'])).not.toBe('');
      expect(await accounts(body.username)).toBe(1);
    });

    it('with the switch on, sign-up answers a clear refusal and writes nothing', async () => {
      const body = registration('newcomer');
      const response = await post(closed, '/auth/register', body);
      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({
        error: 'registration_closed',
        message: SIGNUPS_CLOSED_MESSAGE,
      });
      expect(response.headers['set-cookie']).toBeUndefined();
      expect(await accounts(body.username)).toBe(0);

      // Said before the body is validated: no field error to fix behind a closed door.
      const malformed = await post(closed, '/auth/register', { username: '' });
      expect(malformed.statusCode).toBe(403);
      expect(malformed.json().error).toBe('registration_closed');
      expect(malformed.json()).not.toHaveProperty('fields');
    });

    it('with the switch on, an existing member signs in and the rest keeps working', async () => {
      const login = await post(closed, '/auth/login', {
        identifier: member.username,
        password: PASSWORD,
      });
      expect(login.statusCode).toBe(200);
      expect(login.json().user.username).toBe(member.username);
      const session = cookieValue(login.headers['set-cookie']);
      expect(session).not.toBe('');

      const me = await closed.inject({
        method: 'GET',
        url: '/auth/me',
        headers: { cookie: `fmip_session=${session}` },
      });
      expect(me.statusCode).toBe(200);
      expect(me.json().user.username).toBe(member.username);

      // A forgotten password is still asked for as usual.
      const forgot = await post(closed, '/auth/password/forgot', { email: member.email });
      expect(forgot.statusCode).toBe(202);
    });
  },
);
