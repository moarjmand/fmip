import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { AdminOverview, AdminUsersResponse, ApiError, AuditResponse } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../identity/identity.service';
import { AdminModule } from './admin.module';

// The administration area against the real schema: the admin role gates
// it, the overview reads across the platform, and every high-impact action
// writes an immutable audit record with actor, reason, previous and next.
const DATABASE_URL = process.env.DATABASE_URL;

const ENGLAND = '00000000-0000-4000-8000-000000000101';
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const COMPETITION = randomUUID();
const SEASON = randomUUID();

function cookieValue(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const match = /^fmip_session=([^;]*)/.exec(header ?? '');
  return match?.[1] ?? '';
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('administration', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let admin = { id: '', cookie: '', username: '' };
  let member = { id: '', cookie: '', username: '' };
  const auditIds: string[] = [];

  const inject = (
    method: 'GET' | 'POST' | 'PUT',
    url: string,
    cookie?: string,
    payload?: unknown,
  ) =>
    app.inject({
      method,
      url,
      payload: payload as Record<string, unknown> | undefined,
      headers: cookie === undefined ? {} : { cookie: `fmip_session=${cookie}` },
    });

  async function register(username: string, displayName: string) {
    const registered = await inject('POST', '/auth/register', undefined, {
      username,
      display_name: displayName,
      email: `${username}@example.test`,
      password: 'correct horse battery staple',
      country_id: ENGLAND,
      preferred_language: 'en',
      timezone: 'Europe/London',
      accept_rules: true,
    });
    const id = (registered.json() as { user: { id: string } }).user.id;
    return { id, cookie: cookieValue(registered.headers['set-cookie']), username };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, AdminModule],
    })
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
    admin = await register(`ad_${RUN}a`, 'Admin Tester');
    member = await register(`ad_${RUN}m`, 'Member Tester');
    await pool.query(
      `INSERT INTO user_role (user_id, role, granted_by, reason) VALUES ($1, 'admin', $1, 'admin test')`,
      [admin.id],
    );
    await pool.query(
      `INSERT INTO competition (id, country_id, name, kind, scope, gender) VALUES ($1, $2, $3, 'league', 'domestic', 'men')`,
      [COMPETITION, ENGLAND, `Test League ${RUN}`],
    );
    await pool.query(
      `INSERT INTO season (id, competition_id, label, start_date, end_date, is_current)
       VALUES ($1, $2, '2025/26', DATE '2025-08-01', DATE '2026-05-31', true)`,
      [SEASON, COMPETITION],
    );
    await pool.query(
      `INSERT INTO coverage_profile (season_id, module, state, provider) VALUES ($1, 'scores', 'limited', 'api_football')`,
      [SEASON],
    );
  });

  afterAll(async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('ALTER TABLE audit_log DISABLE TRIGGER audit_log_immutable');
      await client.query(`DELETE FROM audit_log WHERE actor_id = $1`, [admin.id]);
      await client.query('ALTER TABLE audit_log ENABLE TRIGGER audit_log_immutable');
      await client.query(`DELETE FROM user_account WHERE username LIKE $1`, [`ad_${RUN}%`]);
      await client.query(`DELETE FROM season WHERE id = $1`, [SEASON]);
      await client.query(`DELETE FROM competition WHERE id = $1`, [COMPETITION]);
      await client.query('COMMIT');
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    await pool.end();
    await app.close();
  });

  it('is closed to guests and to members without the admin role', async () => {
    expect((await inject('GET', '/admin/overview')).statusCode).toBe(401);
    const forbidden = await inject('GET', '/admin/overview', member.cookie);
    expect(forbidden.statusCode).toBe(403);
    expect((forbidden.json() as ApiError).message).toContain('admin role');
    expect((await inject('GET', `/admin/users?q=${RUN}`, member.cookie)).statusCode).toBe(403);
  });

  it('shows coverage, freshness, ingestion and the rating configuration in force', async () => {
    const response = await inject('GET', '/admin/overview', admin.cookie);
    expect(response.statusCode).toBe(200);
    const overview = response.json() as AdminOverview;
    expect(overview.coverage).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          season: { id: SEASON, label: '2025/26', is_current: true },
          module: 'scores',
          state: 'limited',
          provider: 'api_football',
        }),
      ]),
    );
    const fresh = overview.freshness.find((r) => r.season.id === SEASON);
    expect(fresh).toMatchObject({ fixtures: 0, live: 0, live_behind: 0, last_change_at: null });
    expect(Object.keys(overview.ingestion).sort()).toEqual([
      'checked_at',
      'failed_last_24h',
      'last_failure',
      'last_run',
      'recent',
      'running',
    ]);
    expect(overview.rating.formula.version).toMatch(/^performance-rating@/);
    expect(overview.rating.points.version).toMatch(/^career-points@/);
    expect(overview.rating.eligibility.version).toMatch(/^privilege-eligibility@/);
    expect(overview.rating.leaderboard.version).toMatch(/^leaderboard@/);
  });

  it('finds members by username, e-mail or display name, with their roles', async () => {
    const byName = (
      await inject('GET', `/admin/users?q=ad_${RUN}`, admin.cookie)
    ).json() as AdminUsersResponse;
    expect(byName.users.map((u) => u.username).sort()).toEqual([admin.username, member.username]);
    expect(byName.users.find((u) => u.id === admin.id)?.roles).toEqual(['admin']);
    expect(byName.users.find((u) => u.id === member.id)).toMatchObject({
      roles: [],
      status: 'active',
      email_verified: false,
    });
    const byDisplay = (
      await inject('GET', '/admin/users?q=Member%20Tester', admin.cookie)
    ).json() as AdminUsersResponse;
    expect(byDisplay.users.some((u) => u.id === member.id)).toBe(true);
    expect((await inject('GET', '/admin/users?q=a', admin.cookie)).statusCode).toBe(400);
  });

  it('suspends and reinstates an account, each with an audit record carrying actor, reason, previous and next', async () => {
    const noReason = await inject('POST', `/admin/users/${member.id}/status`, admin.cookie, {
      status: 'suspended',
    });
    expect(noReason.statusCode).toBe(400);
    expect((noReason.json() as ApiError).fields?.reason).toBeTruthy();

    const suspended = await inject('POST', `/admin/users/${member.id}/status`, admin.cookie, {
      status: 'suspended',
      reason: 'Spam in match discussion.',
    });
    expect(suspended.statusCode).toBe(200);
    const body = suspended.json() as { previous: string; next: string; audit_id: string };
    expect(body).toMatchObject({ previous: 'active', next: 'suspended' });
    auditIds.push(body.audit_id);
    const status = await pool.query<{ status: string }>(
      `SELECT status FROM user_account WHERE id = $1`,
      [member.id],
    );
    expect(status.rows[0]?.status).toBe('suspended');

    // Themselves: never.
    expect(
      (
        await inject('POST', `/admin/users/${admin.id}/status`, admin.cookie, {
          status: 'suspended',
          reason: 'x',
        })
      ).statusCode,
    ).toBe(400);

    const reinstated = await inject('POST', `/admin/users/${member.id}/status`, admin.cookie, {
      status: 'active',
      reason: 'Appeal upheld.',
    });
    expect(reinstated.json()).toMatchObject({ previous: 'suspended', next: 'active' });

    const audit = (
      await inject('GET', '/admin/audit?limit=10', admin.cookie)
    ).json() as AuditResponse;
    const ours = audit.records.filter((r) => r.actor.id === admin.id && r.target_id === member.id);
    expect(ours.map((r) => [r.action, r.previous, r.next, r.reason])).toEqual([
      ['user.status', { status: 'suspended' }, { status: 'active' }, 'Appeal upheld.'],
      ['user.status', { status: 'active' }, { status: 'suspended' }, 'Spam in match discussion.'],
    ]);
    expect(ours[0]!.actor.username).toBe(admin.username);
  });

  it("sets a season's declared coverage with an audit record, and refuses coverage without a provider", async () => {
    const bad = await inject('PUT', `/admin/coverage/${SEASON}/lineups`, admin.cookie, {
      state: 'available',
      reason: 'Provider promised line-ups.',
    });
    expect(bad.statusCode).toBe(400);
    expect((bad.json() as ApiError).fields?.provider).toBeTruthy();

    const created = await inject('PUT', `/admin/coverage/${SEASON}/lineups`, admin.cookie, {
      state: 'available',
      provider: 'api_football',
      note: 'Line-ups arrive about an hour before kick-off.',
      reason: 'Provider promised line-ups.',
    });
    expect(created.statusCode).toBe(200);

    const changed = await inject('PUT', `/admin/coverage/${SEASON}/scores`, admin.cookie, {
      state: 'not_supplied',
      reason: 'Feed withdrawn for this league.',
    });
    expect(changed.statusCode).toBe(200);

    const overview = (await inject('GET', '/admin/overview', admin.cookie)).json() as AdminOverview;
    const rows = overview.coverage.filter((r) => r.season.id === SEASON);
    expect(rows.map((r) => [r.module, r.state, r.provider])).toEqual([
      ['lineups', 'available', 'api_football'],
      ['scores', 'not_supplied', null],
    ]);

    const audit = (await inject('GET', '/admin/audit', admin.cookie)).json() as AuditResponse;
    const coverage = audit.records.filter(
      (r) => r.action === 'coverage.set' && r.target_id.startsWith(SEASON),
    );
    expect(
      coverage.map((r) => [r.target_id, r.previous, (r.next as { state: string }).state]),
    ).toEqual([
      [
        `${SEASON}:scores`,
        { state: 'limited', provider: 'api_football', note: null },
        'not_supplied',
      ],
      [`${SEASON}:lineups`, null, 'available'],
    ]);

    expect(
      (
        await inject('PUT', `/admin/coverage/${randomUUID()}/scores`, admin.cookie, {
          state: 'not_supplied',
          reason: 'x',
        })
      ).statusCode,
    ).toBe(404);
  });

  it('keeps every audit record immutable', async () => {
    const id = auditIds[0]!;
    await expect(
      pool.query(`UPDATE audit_log SET reason = 'edited' WHERE id = $1`, [id]),
    ).rejects.toMatchObject({
      code: '23001',
    });
    await expect(pool.query(`DELETE FROM audit_log WHERE id = $1`, [id])).rejects.toMatchObject({
      code: '23001',
    });
  });
});
