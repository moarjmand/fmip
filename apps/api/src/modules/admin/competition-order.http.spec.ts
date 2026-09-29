import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type {
  AdminCompetitionsResponse,
  ApiError,
  SetCompetitionOrderResponse,
} from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../identity/identity.service';
import { AdminModule } from './admin.module';
import { withTriggersOff } from '../../testing/cleanup';

/**
 * The competitions' order in the console (T-1162, D-154): administrators
 * only; a place from 1 or `null` to clear it, always with a reason; the same
 * audit action as `catalog.mjs --set-order`, now with the previous place; the
 * list comes back in the order readers meet the competitions.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const ENGLAND = '00000000-0000-4000-8000-000000000101';
// Places far down the list, so the seeded competitions keep theirs.
const FIRST = 32000;
const SECOND = 32001;

function cookieValue(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return /^fmip_session=([^;]*)/.exec(header ?? '')?.[1] ?? '';
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('competition order', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let admin = { id: '', cookie: '' };
  let member = { id: '', cookie: '' };
  const alpha = randomUUID();
  const omega = randomUUID();

  const inject = (method: 'GET' | 'PUT', url: string, cookie?: string, payload?: unknown) =>
    app.inject({
      method,
      url,
      payload: payload as Record<string, unknown> | undefined,
      headers: cookie === undefined ? {} : { cookie: `fmip_session=${cookie}` },
    });
  const put = (id: string, payload: unknown, cookie = admin.cookie) =>
    inject('PUT', `/admin/competitions/${id}/order`, cookie, payload);
  const listed = async () =>
    (await inject('GET', '/admin/competitions', admin.cookie))
      .json<AdminCompetitionsResponse>()
      .competitions.filter((c) => c.id === alpha || c.id === omega);

  async function register(username: string) {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        username,
        display_name: `Member ${username}`,
        email: `${username}@example.test`,
        password: 'correct horse battery staple',
        country_id: ENGLAND,
        preferred_language: 'en',
        timezone: 'Europe/London',
        accept_rules: true,
      },
    });
    const id = (response.json() as { user: { id: string } }).user.id;
    return { id, cookie: cookieValue(response.headers['set-cookie']) };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [DatabaseModule, AdminModule] })
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
    admin = await register(`co_${RUN}a`);
    member = await register(`co_${RUN}m`);
    await pool.query(
      `INSERT INTO user_role (user_id, role, granted_by, reason) VALUES ($1, 'admin', $1, 'order test')`,
      [admin.id],
    );
    await pool.query(
      `INSERT INTO competition (id, country_id, name, kind, scope, gender)
       VALUES ($1, $3, $4, 'league', 'domestic', 'men'), ($2, NULL, $5, 'cup', 'international', 'men')`,
      [alpha, omega, ENGLAND, `A Order League ${RUN}`, `Z Order Cup ${RUN}`],
    );
  });

  afterAll(async () => {
    await withTriggersOff(pool, async (client) => {
      await client.query(`DELETE FROM audit_log WHERE actor_id = $1`, [admin.id]);
    });
    await pool.query(`DELETE FROM user_account WHERE username LIKE $1`, [`co_${RUN}%`]);
    await pool.query(`DELETE FROM competition WHERE id = ANY($1::uuid[])`, [[alpha, omega]]);
    await pool.end();
    await app.close();
  });

  it('is for administrators only', async () => {
    expect((await inject('GET', '/admin/competitions')).statusCode).toBe(401);
    expect((await inject('GET', '/admin/competitions', member.cookie)).statusCode).toBe(403);
    const refused = await put(alpha, { order: 1, reason: 'x' }, member.cookie);
    expect(refused.statusCode).toBe(403);
    expect((refused.json() as ApiError).error).toBe('forbidden');
  });

  it('lists every competition, a stated place before none, then by country and name', async () => {
    const before = await listed();
    // With no place stated, an international competition (no country) comes
    // first, as the scores page groups them.
    expect(before.map((c) => [c.name, c.display_order, c.country])).toEqual([
      [`Z Order Cup ${RUN}`, null, null],
      [`A Order League ${RUN}`, null, 'England'],
    ]);
  });

  it('refuses a place that is not one, and a change without a reason, naming each', async () => {
    for (const order of [0, -1, 1.5, 40000, '3', undefined]) {
      const response = await put(alpha, { order, reason: 'why not' });
      expect(response.statusCode).toBe(400);
      expect((response.json() as ApiError).fields?.order).toBeDefined();
    }
    const unexplained = await put(alpha, { order: FIRST, reason: '  ' });
    expect(unexplained.statusCode).toBe(400);
    expect((unexplained.json() as ApiError).fields?.reason).toBeDefined();
    expect((await put(randomUUID(), { order: FIRST, reason: 'x' })).statusCode).toBe(404);
    expect((await put('not-a-uuid', { order: FIRST, reason: 'x' })).statusCode).toBe(404);
  });

  it('states a place with its audit row, previous and next, and the list follows it', async () => {
    const set = await put(omega, { order: FIRST, reason: 'The cup first this month.' });
    expect(set.statusCode).toBe(200);
    const body = set.json<SetCompetitionOrderResponse>();
    expect(body).toMatchObject({ previous: null, next: FIRST });
    expect((await put(alpha, { order: SECOND, reason: 'Then the league.' })).statusCode).toBe(200);
    expect((await listed()).map((c) => c.id)).toEqual([omega, alpha]);

    const { rows } = await pool.query<{
      action: string;
      target_type: string;
      target_id: string;
      reason: string;
      previous: unknown;
      next: unknown;
    }>(
      `SELECT action, target_type, target_id, reason, previous, next FROM audit_log WHERE id = $1`,
      [body.audit_id],
    );
    expect(rows[0]).toEqual({
      action: 'catalog.competition_order_set',
      target_type: 'competition',
      target_id: omega,
      reason: 'The cup first this month.',
      previous: { display_order: null },
      next: { display_order: FIRST },
    });
  });

  it('clears a place with null, recording the one it had', async () => {
    const cleared = await put(omega, { order: null, reason: 'Back to by name.' });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json<SetCompetitionOrderResponse>()).toMatchObject({
      previous: FIRST,
      next: null,
    });
    expect((await listed()).map((c) => [c.id, c.display_order])).toEqual([
      [alpha, SECOND],
      [omega, null],
    ]);
  });
});
