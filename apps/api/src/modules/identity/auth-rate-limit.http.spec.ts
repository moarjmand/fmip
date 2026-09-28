import { randomBytes } from 'node:crypto';
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

// Security tests for T-810: the rate limits before signing in, against the
// real schema, at the ceilings the migration ships (read from `rate_limit`,
// never lowered here, because other suites share the table). Skipped,
// visibly, without DATABASE_URL.
const DATABASE_URL = process.env.DATABASE_URL;

const ENGLAND = '00000000-0000-4000-8000-000000000101';
// A well-formed UUID no country has: registration counts the attempt, then
// refuses the country, so the per-address ceiling is reached without creating
// twenty accounts.
const NO_COUNTRY = '00000000-0000-4000-8000-00000000ffff';
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);

const options: IdentityOptions = {
  ...DEFAULT_IDENTITY_OPTIONS,
  sessionSecret: 'rate-test-secret-'.repeat(3),
  webBaseUrl: 'http://web.test',
  cookieSecure: false,
};

/** A documentation-range IPv6 address nobody else's run will use. */
function freshIp(): string {
  const hex = randomBytes(8).toString('hex');
  return `2001:db8:${hex.slice(0, 4)}:${hex.slice(4, 8)}::${hex.slice(8, 12)}`;
}

function tokenFromMail(text: string): string {
  const match = /token=([A-Za-z0-9_-]+)/.exec(text);
  if (match?.[1] === undefined) throw new Error(`no token in mail:\n${text}`);
  return match[1];
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  '/auth rate limits',
  { timeout: 120_000 },
  () => {
    let app: NestFastifyApplication;
    let pool: Pool;
    const mailer = new CaptureMailer();
    const ceiling: Record<string, number> = {};

    const post = (url: string, payload: unknown, ip?: string) =>
      app.inject({
        method: 'POST',
        url,
        payload: payload as Record<string, unknown>,
        headers: ip === undefined ? {} : { 'x-fmip-client-ip': ip },
      });

    const registration = (n: string, over: Record<string, unknown> = {}) => ({
      username: `rl_${RUN}_${n}`,
      display_name: 'Rate Tester',
      email: `rl_${RUN}_${n}@example.test`,
      password: 'correct horse battery staple',
      country_id: ENGLAND,
      preferred_language: 'en',
      timezone: 'Europe/London',
      accept_rules: true,
      ...over,
    });

    /** The refusal every limit gives: 429, Retry-After within the hour, a sentence. */
    function expectRefusal(response: Awaited<ReturnType<typeof post>>): void {
      expect(response.statusCode).toBe(429);
      const retryAfter = Number(response.headers['retry-after']);
      expect(Number.isInteger(retryAfter)).toBe(true);
      expect(retryAfter).toBeGreaterThan(0);
      expect(retryAfter).toBeLessThanOrEqual(3600);
      expect(response.json()).toEqual({
        error: 'rate_limited',
        message: expect.stringMatching(/^Too many attempts\. Try again in \d+ minutes?\.$/),
      });
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [DatabaseModule, IdentityModule],
      })
        .overrideProvider(MAILER)
        .useValue(mailer)
        .overrideProvider(IDENTITY_OPTIONS)
        .useValue(options)
        .compile();

      app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      pool = new Pool({ connectionString: DATABASE_URL });

      const { rows } = await pool.query<{ action: string; per_hour: number }>(
        `SELECT action, per_hour FROM rate_limit
        WHERE action IN ('login_failure_account', 'login_failure_ip', 'register_ip',
                         'register_account', 'password_forgot_account', 'password_forgot_ip',
                         'email_token_ip')`,
      );
      for (const row of rows) ceiling[row.action] = row.per_hour;
      expect(Object.keys(ceiling)).toHaveLength(7);
    });

    afterAll(async () => {
      await pool.query(`DELETE FROM user_account WHERE username LIKE $1`, [`rl_${RUN}%`]);
      await pool.end();
      await app.close();
    });

    it('refuses failed sign-ins past the per-account ceiling, the same for a real and an unknown account, and refuses even the right password then', async () => {
      const created = await post('/auth/register', registration('victim'));
      expect(created.statusCode).toBe(201);

      const real = `rl_${RUN}_victim`;
      const ghost = `rl_${RUN}_nobody`;
      const limit = ceiling.login_failure_account ?? 0;

      for (const identifier of [real, ghost]) {
        for (let i = 0; i < limit; i += 1) {
          // Each from a new address, so only the per-account ceiling can refuse.
          const wrong = await post(
            '/auth/login',
            { identifier, password: 'not the password' },
            freshIp(),
          );
          expect(wrong.statusCode).toBe(401);
        }
      }

      const realRefused = await post(
        '/auth/login',
        { identifier: real, password: 'not the password' },
        freshIp(),
      );
      const ghostRefused = await post(
        '/auth/login',
        { identifier: ghost, password: 'not the password' },
        freshIp(),
      );
      expectRefusal(realRefused);
      expectRefusal(ghostRefused);
      // Nothing in the answer tells the two apart.
      expect(realRefused.json()).toEqual(ghostRefused.json());

      // Case does not make a second identifier.
      expectRefusal(
        await post('/auth/login', { identifier: real.toUpperCase(), password: 'x' }, freshIp()),
      );

      const rightPassword = await post(
        '/auth/login',
        { identifier: real, password: 'correct horse battery staple' },
        freshIp(),
      );
      expectRefusal(rightPassword);
      expect(rightPassword.headers['set-cookie']).toBeUndefined();
    });

    it('forgets the failed sign-ins against an account once its password is reset', async () => {
      const address = `rl_${RUN}_victim@example.test`;
      const asked = await post('/auth/password/forgot', { email: address });
      expect(asked.statusCode).toBe(202);
      const token = tokenFromMail(mailer.sent.at(-1)?.text ?? '');

      const reset = await post('/auth/password/reset', {
        token,
        password: 'a brand new passphrase',
      });
      expect(reset.statusCode).toBe(200);

      const login = await post('/auth/login', {
        identifier: `rl_${RUN}_victim`,
        password: 'a brand new passphrase',
      });
      expect(login.statusCode).toBe(200);
    });

    it('does not count a successful sign-in', async () => {
      const created = await post('/auth/register', registration('regular'));
      expect(created.statusCode).toBe(201);
      const ip = freshIp();
      const limit = ceiling.login_failure_account ?? 0;

      for (let i = 0; i < limit + 2; i += 1) {
        const login = await post(
          '/auth/login',
          { identifier: `rl_${RUN}_regular`, password: 'correct horse battery staple' },
          ip,
        );
        expect(login.statusCode).toBe(200);
      }
    });

    it('refuses failed sign-ins past the per-address ceiling, for that address only', async () => {
      const ip = freshIp();
      const limit = ceiling.login_failure_ip ?? 0;

      for (let i = 0; i < limit; i += 1) {
        // A different identifier each time, so only the per-address ceiling can refuse.
        const wrong = await post(
          '/auth/login',
          { identifier: `rl_${RUN}_ip${i}`, password: 'x' },
          ip,
        );
        expect(wrong.statusCode).toBe(401);
      }

      expectRefusal(await post('/auth/login', { identifier: `rl_${RUN}_ipx`, password: 'x' }, ip));

      const elsewhere = await post(
        '/auth/login',
        { identifier: `rl_${RUN}_ipx`, password: 'x' },
        freshIp(),
      );
      expect(elsewhere.statusCode).toBe(401);
    });

    it('ignores an address header that is not an address', async () => {
      // Were it counted, every request carrying this string would share one bucket.
      const limit = ceiling.login_failure_ip ?? 0;
      for (let i = 0; i <= limit; i += 1) {
        const wrong = await post(
          '/auth/login',
          { identifier: `rl_${RUN}_junk${i}`, password: 'x' },
          'unknown',
        );
        expect(wrong.statusCode).toBe(401);
      }
    });

    it('refuses registration past the per-e-mail and the per-address ceilings', async () => {
      const perAccount = ceiling.register_account ?? 0;
      for (let i = 0; i < perAccount; i += 1) {
        const attempt = await post(
          '/auth/register',
          registration(`dup${i}`, { email: `rl_${RUN}_same@example.test` }),
          freshIp(),
        );
        expect([201, 409]).toContain(attempt.statusCode);
      }
      expectRefusal(
        await post(
          '/auth/register',
          registration('dupx', { email: `rl_${RUN}_same@example.test` }),
          freshIp(),
        ),
      );

      const ip = freshIp();
      const perIp = ceiling.register_ip ?? 0;
      for (let i = 0; i < perIp; i += 1) {
        const attempt = await post(
          '/auth/register',
          registration(`many${i}`, { country_id: NO_COUNTRY }),
          ip,
        );
        expect(attempt.statusCode).toBe(400);
      }
      expectRefusal(await post('/auth/register', registration('manyx'), ip));
      expect(
        (await pool.query(`SELECT 1 FROM user_account WHERE username = $1`, [`rl_${RUN}_manyx`]))
          .rowCount,
      ).toBe(0);
    });

    it('refuses reset e-mails past the per-address-typed ceiling, the same for a known and an unknown address', async () => {
      const known = `rl_${RUN}_regular@example.test`;
      const unknown = `rl_${RUN}_ghost@example.test`;
      const limit = ceiling.password_forgot_account ?? 0;
      const before = mailer.sent.length;

      for (const email of [known, unknown]) {
        for (let i = 0; i < limit; i += 1) {
          expect((await post('/auth/password/forgot', { email }, freshIp())).statusCode).toBe(202);
        }
      }
      expect(mailer.sent.length).toBe(before + limit);

      const knownRefused = await post('/auth/password/forgot', { email: known }, freshIp());
      const unknownRefused = await post('/auth/password/forgot', { email: unknown }, freshIp());
      expectRefusal(knownRefused);
      expectRefusal(unknownRefused);
      expect(knownRefused.json()).toEqual(unknownRefused.json());
      // Refused means not sent.
      expect(mailer.sent.length).toBe(before + limit);

      const ip = freshIp();
      const perIp = ceiling.password_forgot_ip ?? 0;
      for (let i = 0; i < perIp; i += 1) {
        const attempt = await post(
          '/auth/password/forgot',
          { email: `rl_${RUN}_f${i}@example.test` },
          ip,
        );
        expect(attempt.statusCode).toBe(202);
      }
      expectRefusal(
        await post('/auth/password/forgot', { email: `rl_${RUN}_fx@example.test` }, ip),
      );
    });

    it('refuses e-mailed links past the per-address ceiling, verify and reset alike', async () => {
      const ip = freshIp();
      const limit = ceiling.email_token_ip ?? 0;
      const bogus = () => randomBytes(32).toString('base64url');

      for (let i = 0; i < limit; i += 1) {
        const attempt =
          i % 2 === 0
            ? await post('/auth/verify-email', { token: bogus() }, ip)
            : await post(
                '/auth/password/reset',
                { token: bogus(), password: 'long enough pw' },
                ip,
              );
        expect(attempt.statusCode).toBe(400);
      }

      expectRefusal(await post('/auth/verify-email', { token: bogus() }, ip));
      expectRefusal(
        await post('/auth/password/reset', { token: bogus(), password: 'long enough pw' }, ip),
      );
      expect((await post('/auth/verify-email', { token: bogus() }, freshIp())).statusCode).toBe(
        400,
      );
    });

    it('keeps neither the address nor the identifier in clear', async () => {
      const { rows } = await pool.query<{ subject: string }>(
        `SELECT subject FROM auth_rate_window WHERE window_start = date_trunc('hour', now())`,
      );
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.subject).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(row.subject).not.toContain(RUN);
      }
    });
  },
);
