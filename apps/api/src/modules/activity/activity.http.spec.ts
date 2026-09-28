import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { ActivityReport, ApiError } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { withTriggersOff } from '../../testing/cleanup';
import {
  DEFAULT_IDENTITY_OPTIONS,
  IDENTITY_OPTIONS,
  IdentityService,
} from '../identity/identity.service';
import { ActivityModule } from './activity.module';

// T-807 against the real schema: the endpoint is the administrator's, the
// counts land on the right UTC day, and -- the acceptance -- a deleted
// account's rows still count, without its name anywhere in the answer.
//
// The spec's rows are stamped on one day seventeen days back, which no other
// suite writes to, and every assertion is a difference from what that day
// held before, so a shared database with other suites running is fine.
const DATABASE_URL = process.env.DATABASE_URL;
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

const ENGLAND = '00000000-0000-4000-8000-000000000101';
const UPCOMING = '00000000-0000-4000-8000-000000000902';
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const PASSWORD = 'correct horse battery staple';
const DAY_MS = 24 * 60 * 60 * 1000;

function cookieValue(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return /^fmip_session=([^;]*)/.exec(header ?? '')?.[1] ?? '';
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('activity counts', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  const ids: string[] = [];
  let admin = '';
  let member = '';

  const today = new Date();
  const stamped = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) -
      17 * DAY_MS +
      12 * 60 * 60 * 1000,
  );
  const stampedDay = stamped.toISOString().slice(0, 10);

  const get = (url: string, cookie?: string) =>
    app.inject({
      method: 'GET',
      url,
      headers: cookie === undefined ? {} : { cookie: `fmip_session=${cookie}` },
    });

  async function register(username: string): Promise<{ id: string; cookie: string }> {
    const registered = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        username,
        display_name: 'Activity Tester',
        email: `${username}@example.test`,
        password: PASSWORD,
        country_id: ENGLAND,
        preferred_language: 'en',
        timezone: 'Europe/London',
        accept_rules: true,
      },
    });
    const id = (registered.json() as { user: { id: string } }).user.id;
    ids.push(id);
    return { id, cookie: cookieValue(registered.headers['set-cookie']) };
  }

  /** The stamped day's count of each metric. */
  async function onStampedDay(): Promise<Record<string, number>> {
    const report = (await get('/admin/activity', admin)).json() as ActivityReport;
    const at = report.days.indexOf(stampedDay);
    expect(at).toBeGreaterThanOrEqual(0);
    return Object.fromEntries(report.series.map((s) => [s.metric, s.counts[at] ?? -1]));
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, ActivityModule],
    })
      .overrideProvider(IDENTITY_OPTIONS)
      .useValue({
        ...DEFAULT_IDENTITY_OPTIONS,
        sessionSecret: 'test-secret-'.repeat(4),
        webBaseUrl: 'http://web.test',
        cookieSecure: false,
      })
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
      logger: false,
    });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    pool = new Pool({ connectionString: DATABASE_URL });
    const a = await register(`act_${RUN}a`);
    const m = await register(`act_${RUN}m`);
    admin = a.cookie;
    member = m.cookie;
    await pool.query(
      `INSERT INTO user_role (user_id, role, granted_by, reason) VALUES ($1, 'admin', $1, 'activity test')`,
      [a.id],
    );
  });

  afterAll(async () => {
    await withTriggersOff(pool, async (c) => {
      await c.query(
        `DELETE FROM prediction_version WHERE prediction_id IN
           (SELECT id FROM user_prediction WHERE user_id = ANY($1::uuid[]))`,
        [ids],
      );
      await c.query(`DELETE FROM user_prediction WHERE user_id = ANY($1::uuid[])`, [ids]);
      await c.query(`DELETE FROM report WHERE reporter_id = ANY($1::uuid[])`, [ids]);
      await c.query(`DELETE FROM audit_log WHERE actor_id = ANY($1::uuid[])`, [ids]);
      await c.query(`DELETE FROM retired_username WHERE username LIKE $1`, [`act\\_${RUN}%`]);
    });
    await pool.query(`DELETE FROM user_account WHERE id = ANY($1::uuid[])`, [ids]);
    await pool.end();
    await app.close();
  });

  it('is closed to guests and to members without the admin role', async () => {
    expect((await get('/admin/activity')).statusCode).toBe(401);
    expect((await get('/admin/activity', member)).statusCode).toBe(403);
  });

  it('answers thirty UTC days ending today, every metric, and refuses a bad window', async () => {
    const response = await get('/admin/activity', admin);
    expect(response.statusCode).toBe(200);
    const report = response.json() as ActivityReport;
    expect(report.days).toHaveLength(30);
    expect(report.days.at(-1)).toBe(new Date().toISOString().slice(0, 10));
    expect(report.series.length).toBeGreaterThan(10);
    for (const series of report.series) expect(series.counts).toHaveLength(30);
    // Both registrations of this spec happened today.
    const registrations = report.series.find((s) => s.metric === 'registrations');
    expect(registrations?.counts.at(-1)).toBeGreaterThanOrEqual(2);
    expect(
      ((await get('/admin/activity?days=7', admin)).json() as ActivityReport).days,
    ).toHaveLength(7);

    const refused = await get('/admin/activity?days=365', admin);
    expect(refused.statusCode).toBe(400);
    expect((refused.json() as ApiError).fields).toHaveProperty('days');
  });

  it("a deleted account's rows still count, and its name appears nowhere (T-807)", async () => {
    const before = await onStampedDay();
    const username = `act_${RUN}d`;
    const gone = await register(username);
    // As if this member had joined, verified, predicted twice and reported
    // someone on the stamped day.
    await pool.query(
      `UPDATE user_account SET created_at = $2, email_verified_at = $2 WHERE id = $1`,
      [gone.id, stamped],
    );
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO user_prediction (user_id, fixture_id, created_at, updated_at)
       VALUES ($1, $2, $3, $3) RETURNING id`,
      [gone.id, UPCOMING, stamped],
    );
    const predictionId = rows[0]?.id;
    await pool.query(
      `INSERT INTO prediction_version (prediction_id, version_number, outcome, confidence, submitted_at)
       VALUES ($1, 1, 'home', 3, $2), ($1, 2, 'draw', 4, $2)`,
      [predictionId, stamped],
    );
    await pool.query(
      `INSERT INTO report (reporter_id, subject_type, subject_id, reason, created_at)
       VALUES ($1, 'member', $2, 'spam', $3)`,
      [gone.id, ids[0], stamped],
    );

    const live = await onStampedDay();
    expect(live.registrations).toBe((before.registrations ?? 0) + 1);
    expect(live.verifications).toBe((before.verifications ?? 0) + 1);
    expect(live.predictions).toBe((before.predictions ?? 0) + 1);
    expect(live.prediction_changes).toBe((before.prediction_changes ?? 0) + 1);
    expect(live.active_members).toBe((before.active_members ?? 0) + 1);
    expect(live.reports).toBe((before.reports ?? 0) + 1);

    const deletionsToday = async () => {
      const report = (await get('/admin/activity', admin)).json() as ActivityReport;
      return report.series.find((s) => s.metric === 'deletions')?.counts.at(-1) ?? 0;
    };
    const deletionsBefore = await deletionsToday();
    const outcome = await app
      .get(IdentityService)
      .deleteAccount(gone.id, { password: PASSWORD, confirm: username });
    expect(outcome).toBe('deleted');

    const after = await onStampedDay();
    // Kept by the product, unnamed, and so still counted.
    expect(after.registrations).toBe(live.registrations);
    expect(after.predictions).toBe(live.predictions);
    expect(after.prediction_changes).toBe(live.prediction_changes);
    expect(after.active_members).toBe(live.active_members);
    expect(after.reports).toBe(live.reports);
    // Erased by the product with the address (D-094), and not reconstructed.
    expect(after.verifications).toBe(before.verifications);
    expect(await deletionsToday()).toBeGreaterThanOrEqual(deletionsBefore + 1);

    const body = (await get('/admin/activity?days=90', admin)).body;
    expect(body).not.toContain(username);
    expect(body).not.toContain(gone.id);
    expect(body).not.toContain('example.test');
  });
});
