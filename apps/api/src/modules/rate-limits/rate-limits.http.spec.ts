import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { RateLimitsReport } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { IdentityModule } from '../identity/identity.module';
import { CaptureMailer, MAILER } from '../identity/internal/mailer';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../identity/identity.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { RateLimitsModule } from './rate-limits.module';
import { RateLimitsService } from './rate-limits.service';

/**
 * The ceilings T-811 added and the report (D-103): a push registration past
 * its ceiling is refused with a wait and counted for the day; deleting an
 * account is held to the sign-in ceilings against its username, and the lock
 * is the sign-in's own; a ceiling without a row limits nothing; and
 * `GET /admin/rate-limits` is the inventory with the numbers the table has
 * now, to administrators only.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const ENGLAND = '00000000-0000-4000-8000-000000000101';
const PASSWORD = 'a perfectly fine passphrase';

function cookieValue(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return /^fmip_session=([^;]*)/.exec(header ?? '')?.[1] ?? '';
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  'rate limits found by the inventory, and the report (T-811)',
  () => {
    let app: NestFastifyApplication;
    let pool: Pool;
    const cookies: Record<string, string> = {};
    const ids: Record<string, string> = {};
    const name = (who: string) => `rl_${RUN}_${who}`;

    const refusedToday = async (action: string): Promise<number> => {
      const { rows } = await pool.query<{ count: number }>(
        `SELECT count FROM rate_refusal WHERE action = $1 AND day = $2::date`,
        [action, new Date().toISOString().slice(0, 10)],
      );
      return rows[0]?.count ?? 0;
    };

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [DatabaseModule, IdentityModule, NotificationsModule, RateLimitsModule],
      })
        .overrideProvider(MAILER)
        .useValue(new CaptureMailer())
        .overrideProvider(IDENTITY_OPTIONS)
        .useValue({
          ...DEFAULT_IDENTITY_OPTIONS,
          sessionSecret: 'test-secret-'.repeat(4),
          webBaseUrl: 'http://web.test',
          cookieSecure: false,
        })
        .compile();
      app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      pool = new Pool({ connectionString: DATABASE_URL });
      for (const who of ['push', 'del', 'adm']) {
        const response = await app.inject({
          method: 'POST',
          url: '/auth/register',
          payload: {
            username: name(who),
            display_name: `Rate ${who}`,
            email: `${name(who)}@example.test`,
            password: PASSWORD,
            country_id: ENGLAND,
            preferred_language: 'en',
            timezone: 'Europe/London',
            accept_rules: true,
          },
        });
        expect(response.statusCode, response.body).toBe(201);
        cookies[who] = cookieValue(response.headers['set-cookie']);
        ids[who] = response.json<{ user: { id: string } }>().user.id;
      }
      await pool.query(
        `INSERT INTO user_role (user_id, role, granted_by, reason) VALUES ($1, 'admin', $1, 'T-811 test')`,
        [ids.adm],
      );
    }, 60_000);

    afterAll(async () => {
      if (app !== undefined) await app.close();
      if (pool !== undefined) {
        await pool.query(`DELETE FROM user_account WHERE username LIKE $1`, [`rl_${RUN}_%`]);
        await pool.end();
      }
    });

    it('refuses the push registration past its ceiling, with a wait, and counts the refusal', async () => {
      const before = await refusedToday('push_subscription');
      const register = (n: number) =>
        app.inject({
          method: 'POST',
          url: '/me/push-subscriptions',
          headers: { cookie: `fmip_session=${cookies.push}` },
          payload: {
            endpoint: `https://push.example/${RUN}/${n}`,
            keys: { p256dh: 'k', auth: 'a' },
          },
        });
      for (let n = 1; n <= 10; n += 1) expect((await register(n)).statusCode).toBe(204);
      const refused = await register(11);
      expect(refused.statusCode).toBe(429);
      expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
      expect(refused.json()).toEqual({
        error: 'rate_limited',
        message: expect.stringMatching(
          /^You have registered a lot of devices .* Try again in \d+ minutes?\.$/,
        ),
      });
      expect(await refusedToday('push_subscription')).toBe(before + 1);
      const { rows } = await pool.query(`SELECT 1 FROM push_subscription WHERE user_id = $1`, [
        ids.push,
      ]);
      expect(rows).toHaveLength(10);
    });

    it('holds the password check of deleting an account to the sign-in ceiling, sharing its lock', async () => {
      const before = await refusedToday('login_failure_account');
      const attempt = (password: string) =>
        app.inject({
          method: 'POST',
          url: '/auth/account/delete',
          headers: { cookie: `fmip_session=${cookies.del}` },
          payload: { password, confirm: name('del') },
        });
      for (let n = 1; n <= 10; n += 1) {
        expect((await attempt(`wrong guess ${n}`)).statusCode).toBe(400);
      }
      const refused = await attempt(PASSWORD);
      expect(refused.statusCode).toBe(429);
      expect(refused.headers['retry-after']).toBeDefined();
      expect(await refusedToday('login_failure_account')).toBe(before + 1);
      // The account is still there, and signing in with its username is refused too.
      const login = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { identifier: name('del'), password: PASSWORD },
      });
      expect(login.statusCode).toBe(429);
      const { rows } = await pool.query(`SELECT 1 FROM user_account WHERE id = $1`, [ids.del]);
      expect(rows).toHaveLength(1);
    });

    it('a ceiling without a row limits nothing and counts nothing', async () => {
      const limits = app.get(RateLimitsService);
      for (let n = 0; n < 3; n += 1) {
        expect(await limits.take(ids.adm!, `no_such_ceiling_${RUN}`)).toEqual({ ok: true });
      }
      const { rows } = await pool.query(`SELECT 1 FROM rate_window WHERE action = $1`, [
        `no_such_ceiling_${RUN}`,
      ]);
      expect(rows).toHaveLength(0);
    });

    it('reports the inventory with the ceilings as the table has them, to administrators only', async () => {
      const member = await app.inject({
        method: 'GET',
        url: '/admin/rate-limits',
        headers: { cookie: `fmip_session=${cookies.push}` },
      });
      expect(member.statusCode).toBe(403);
      expect((await app.inject({ method: 'GET', url: '/admin/rate-limits' })).statusCode).toBe(401);

      const response = await app.inject({
        method: 'GET',
        url: '/admin/rate-limits',
        headers: { cookie: `fmip_session=${cookies.adm}` },
      });
      expect(response.statusCode).toBe(200);
      const report = response.json<RateLimitsReport>();
      expect(report.days).toHaveLength(7);
      const push = report.ceilings.find((c) => c.action === 'push_subscription');
      expect(push).toMatchObject({ per_hour: 10, enforced: 'api', subject: 'member' });
      expect(push?.refusals.map((r) => r.day)).toEqual(report.days);
      expect(push?.refusals.at(-1)?.count).toBeGreaterThanOrEqual(1);
      expect(report.ceilings.find((c) => c.action === 'briefing')?.per_hour).toBe(6);
      expect(report.exempt.find((e) => e.route === 'POST /reports')?.reason).toMatch(/T-213/);
    });
  },
);
