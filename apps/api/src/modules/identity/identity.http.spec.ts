import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { IdentityModule } from './identity.module';
import {
  DEFAULT_IDENTITY_OPTIONS,
  IDENTITY_OPTIONS,
  type IdentityOptions,
} from './identity.service';
import { CaptureMailer, MAILER } from './internal/mailer';

// Security tests for T-040. They need the real schema: uniqueness, single-use
// tokens and session revocation are decided by the database, so a fake store
// would prove nothing. Skipped, visibly, without DATABASE_URL.
const DATABASE_URL = process.env.DATABASE_URL;

// Seeded England (packages/db/seed/001_catalog.sql).
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
  const match = /^fmip_session=([^;]*)/.exec(header ?? '');
  return match?.[1] ?? '';
}

function tokenFromMail(text: string): string {
  const match = /token=([A-Za-z0-9_-]+)/.exec(text);
  if (match?.[1] === undefined) throw new Error(`no token in mail:\n${text}`);
  return match[1];
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('/auth', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  const mailer = new CaptureMailer();

  const registration = {
    username: `it_${RUN}`,
    display_name: 'Integration Tester',
    email: `it_${RUN}@example.test`,
    password: 'correct horse battery staple',
    country_id: ENGLAND,
    preferred_language: 'en',
    timezone: 'Europe/London',
    accept_rules: true,
  };

  const post = (url: string, payload: unknown, cookie?: string) =>
    app.inject({
      method: 'POST',
      url,
      payload: payload as Record<string, unknown>,
      headers: cookie === undefined ? {} : { cookie: `fmip_session=${cookie}` },
    });

  const me = (cookie: string) =>
    app.inject({ method: 'GET', url: '/auth/me', headers: { cookie: `fmip_session=${cookie}` } });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [DatabaseModule, IdentityModule] })
      .overrideProvider(MAILER)
      .useValue(mailer)
      .overrideProvider(IDENTITY_OPTIONS)
      .useValue(options)
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    pool = new Pool({ connectionString: DATABASE_URL });
  });

  afterAll(async () => {
    // Sessions, tokens and credentials cascade from the account.
    await pool.query(`DELETE FROM user_account WHERE username LIKE $1`, [`it_${RUN}%`]);
    await pool.end();
    await app.close();
  });

  let firstSession = '';
  let verifyToken = '';

  it('registers, starts a session, and mails a verification link', async () => {
    const response = await post('/auth/register', registration);

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      user: { username: registration.username, email: registration.email, email_verified: false },
    });
    expect(response.json().user).not.toHaveProperty('password');

    const setCookie = String(response.headers['set-cookie']);
    expect(setCookie).toMatch(
      /^fmip_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=\d+$/,
    );
    firstSession = cookieValue(response.headers['set-cookie']);

    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.to).toBe(registration.email);
    expect(mailer.sent[0]?.text).toContain('http://web.test/en/verify-email?token=');
    verifyToken = tokenFromMail(mailer.sent[0]?.text ?? '');
  });

  it('rejects the same username and the same e-mail with a 409 naming the field', async () => {
    const sameUsername = await post('/auth/register', {
      ...registration,
      email: `other_${RUN}@example.test`,
    });
    const sameEmail = await post('/auth/register', { ...registration, username: `it_${RUN}b` });

    expect(sameUsername.statusCode).toBe(409);
    expect(sameUsername.json()).toEqual({
      error: 'conflict',
      message: 'Already taken.',
      fields: { username: 'already taken' },
    });
    expect(sameEmail.statusCode).toBe(409);
    expect(sameEmail.json().fields).toEqual({ email: 'already taken' });
  });

  it('rejects an invalid body with a 400 naming the fields, and an unknown country', async () => {
    const invalid = await post('/auth/register', { username: 'x' });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error).toBe('validation');
    expect(Object.keys(invalid.json().fields)).toContain('password');

    const unknownCountry = await post('/auth/register', {
      ...registration,
      username: `it_${RUN}c`,
      email: `c_${RUN}@example.test`,
      country_id: '00000000-0000-4000-8000-00000000ffff',
    });
    expect(unknownCountry.statusCode).toBe(400);
    expect(unknownCountry.json().fields).toEqual({ country_id: 'unknown country' });
  });

  it('serves /auth/me for the session and 401 for garbage', async () => {
    const ok = await me(firstSession);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().user.username).toBe(registration.username);

    const bad = await me('A'.repeat(43));
    expect(bad.statusCode).toBe(401);
    expect(bad.json()).toEqual({ error: 'unauthenticated', message: 'Sign in to continue.' });
  });

  it('answers a wrong password and an unknown account identically', async () => {
    const wrong = await post('/auth/login', {
      identifier: registration.email,
      password: 'not it at all',
    });
    const unknown = await post('/auth/login', {
      identifier: `nobody_${RUN}@example.test`,
      password: 'not it at all',
    });

    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json()).toEqual(unknown.json());
    expect(wrong.headers['set-cookie']).toBeUndefined();
  });

  it('logs in by username or e-mail with a fresh session each time', async () => {
    const byEmail = await post('/auth/login', {
      identifier: registration.email.toUpperCase(),
      password: registration.password,
    });
    const byUsername = await post('/auth/login', {
      identifier: registration.username,
      password: registration.password,
    });

    expect(byEmail.statusCode).toBe(200);
    expect(byUsername.statusCode).toBe(200);
    const a = cookieValue(byEmail.headers['set-cookie']);
    const b = cookieValue(byUsername.headers['set-cookie']);
    expect(a).not.toBe(b);
    expect(a).not.toBe(firstSession);
  });

  it('defends against session fixation: a planted cookie is never promoted', async () => {
    // An attacker plants an unknown id, then a known one of their own.
    const planted = 'P'.repeat(43);
    const victim = await post(
      '/auth/login',
      { identifier: registration.username, password: registration.password },
      planted,
    );

    expect(victim.statusCode).toBe(200);
    const issued = cookieValue(victim.headers['set-cookie']);
    expect(issued).not.toBe(planted);
    expect((await me(planted)).statusCode).toBe(401);

    // Attacker's own valid session, sent along with the victim's login: it
    // stays the attacker's, and the victim gets a different one.
    const attacker = await post('/auth/register', {
      ...registration,
      username: `it_${RUN}atk`,
      email: `atk_${RUN}@example.test`,
    });
    const attackerCookie = cookieValue(attacker.headers['set-cookie']);
    const victim2 = await post(
      '/auth/login',
      { identifier: registration.username, password: registration.password },
      attackerCookie,
    );
    const victimCookie = cookieValue(victim2.headers['set-cookie']);

    expect(victimCookie).not.toBe(attackerCookie);
    expect((await me(attackerCookie)).json().user.username).toBe(`it_${RUN}atk`);
    expect((await me(victimCookie)).json().user.username).toBe(registration.username);
  });

  it('logs out: the session is revoked server-side and the cookie cleared', async () => {
    const login = await post('/auth/login', {
      identifier: registration.username,
      password: registration.password,
    });
    const cookie = cookieValue(login.headers['set-cookie']);
    expect((await me(cookie)).statusCode).toBe(200);

    const logout = await post('/auth/logout', {}, cookie);
    expect(logout.statusCode).toBe(204);
    expect(String(logout.headers['set-cookie'])).toContain('Max-Age=0');
    expect((await me(cookie)).statusCode).toBe(401);
  });

  it('verifies the e-mail once; the link is then spent', async () => {
    const first = await post('/auth/verify-email', { token: verifyToken });
    const second = await post('/auth/verify-email', { token: verifyToken });
    const malformed = await post('/auth/verify-email', { token: 'nope' });

    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ verified: true });
    expect((await me(firstSession)).json().user.email_verified).toBe(true);
    expect(second.statusCode).toBe(400);
    expect(second.json().error).toBe('invalid_token');
    expect(malformed.statusCode).toBe(400);
  });

  it('answers a forgotten-password request the same way for known and unknown addresses', async () => {
    const before = mailer.sent.length;
    const known = await post('/auth/password/forgot', { email: registration.email });
    const unknown = await post('/auth/password/forgot', { email: `ghost_${RUN}@example.test` });

    expect(known.statusCode).toBe(202);
    expect(unknown.statusCode).toBe(202);
    expect(known.json()).toEqual(unknown.json());
    expect(mailer.sent.length).toBe(before + 1);
    expect(mailer.sent.at(-1)?.text).toContain('http://web.test/en/reset-password?token=');
  });

  it('resets the password, revokes every session, and spends the token', async () => {
    const resetToken = tokenFromMail(mailer.sent.at(-1)?.text ?? '');
    expect((await me(firstSession)).statusCode).toBe(200);

    const weak = await post('/auth/password/reset', { token: resetToken, password: 'short' });
    expect(weak.statusCode).toBe(400);
    expect(weak.json().fields).toEqual({ password: 'at least 10 characters' });

    const reset = await post('/auth/password/reset', {
      token: resetToken,
      password: 'a brand new passphrase',
    });
    expect(reset.statusCode).toBe(200);

    expect((await me(firstSession)).statusCode).toBe(401);
    const old = await post('/auth/login', {
      identifier: registration.username,
      password: registration.password,
    });
    expect(old.statusCode).toBe(401);
    const fresh = await post('/auth/login', {
      identifier: registration.username,
      password: 'a brand new passphrase',
    });
    expect(fresh.statusCode).toBe(200);

    const replay = await post('/auth/password/reset', {
      token: resetToken,
      password: 'another new passphrase',
    });
    expect(replay.statusCode).toBe(400);
  });

  it('stores no secret in clear: credentials are scrypt hashes and sessions are HMACs', async () => {
    const { rows } = await pool.query<{ secret_hash: string; token_hash: string }>(
      `SELECT c.secret_hash, s.token_hash
         FROM user_account u
         JOIN credential c ON c.user_id = u.id
         JOIN session s ON s.user_id = u.id
        WHERE u.username = $1
        LIMIT 1`,
      [registration.username],
    );

    expect(rows[0]?.secret_hash).toMatch(/^scrypt\$/);
    expect(rows[0]?.secret_hash).not.toContain('passphrase');
    expect(rows[0]?.token_hash).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(rows[0]?.token_hash).not.toBe(firstSession);
  });
});
