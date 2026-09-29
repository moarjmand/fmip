import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { RatingThresholdListResponse, RatingThresholdVersion } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { withTriggersOff } from '../../testing/cleanup';
import { CaptureMailer, MAILER } from '../identity/internal/mailer';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../identity/identity.service';
import { RatingThresholdsModule } from './rating-thresholds.module';
import { RatingThresholdsService, THRESHOLDS_V1 } from './rating-thresholds.service';
import { valuesOf } from './internal/thresholds';

/**
 * Rating thresholds as versioned rows (T-1160, D-152, D-164): administrators
 * only; a new version with a reason, a start never in the past and an audit
 * row carrying the version it supersedes; no row edited; the version in
 * force is the latest start at or before the instant, the higher version
 * winning a tie.
 *
 * Every version this spec writes starts about 290 days ahead (the reputation
 * spec's starts 300 ahead), so a suite running beside it never rates under
 * one; it deletes them afterwards.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const ENGLAND = '00000000-0000-4000-8000-000000000101';
const DAY = 86_400_000;

function cookieValue(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return /^fmip_session=([^;]*)/.exec(header ?? '')?.[1] ?? '';
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('rating thresholds', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let service: RatingThresholdsService;
  const cookies = new Map<string, string>();
  const ids = new Map<string, string>();
  const admin = `th_${RUN}a`;
  const moderator = `th_${RUN}o`;
  const member = `th_${RUN}m`;
  // Whole minutes, so the start reads back exactly as sent.
  const later = new Date(Math.floor((Date.now() + 290 * DAY) / 60_000) * 60_000);

  async function register(username: string): Promise<void> {
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
      `SELECT id FROM user_account WHERE username = $1`,
      [username],
    );
    ids.set(username, rows[0]!.id);
  }

  const as = (username: string | null) =>
    username === null ? {} : { cookie: `fmip_session=${cookies.get(username) ?? ''}` };
  const post = (who: string | null, payload: unknown) =>
    app.inject({
      method: 'POST',
      url: '/admin/rating-thresholds',
      headers: as(who),
      payload: payload as Record<string, unknown>,
    });
  const body = (overrides: Record<string, unknown> = {}) => ({
    ...valuesOf(THRESHOLDS_V1),
    effective_from: later.toISOString(),
    reason: 'A review of the contributor threshold.',
    ...overrides,
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, RatingThresholdsModule],
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
    service = moduleRef.get(RatingThresholdsService);
    pool = new Pool({ connectionString: DATABASE_URL });
    await register(admin);
    await register(moderator);
    await register(member);
    await pool.query(
      `INSERT INTO user_role (user_id, role, granted_by, reason)
       VALUES ($1, 'admin', $1, 'the threshold test'), ($2, 'moderator', $2, 'the threshold test')`,
      [ids.get(admin), ids.get(moderator)],
    );
  });

  afterAll(async () => {
    const actors = [ids.get(admin)];
    await withTriggersOff(pool, async (client) => {
      await client.query(`DELETE FROM rating_threshold_version WHERE set_by = ANY($1::uuid[])`, [
        actors,
      ]);
      await client.query(`DELETE FROM audit_log WHERE actor_id = ANY($1::uuid[])`, [actors]);
    });
    await pool.query(`DELETE FROM user_account WHERE username LIKE $1`, [`th_${RUN}%`]);
    await pool.end();
    await app.close();
  });

  it('is for administrators only; a moderator is not one', async () => {
    expect((await post(null, body())).statusCode).toBe(401);
    for (const who of [member, moderator]) {
      expect((await post(who, body())).statusCode).toBe(403);
      const list = await app.inject({
        method: 'GET',
        url: '/admin/rating-thresholds',
        headers: as(who),
      });
      expect(list.statusCode).toBe(403);
    }
  });

  it("starts from version 1, today's constants, in force now", async () => {
    const list = (
      await app.inject({ method: 'GET', url: '/admin/rating-thresholds', headers: as(admin) })
    ).json<RatingThresholdListResponse>();
    const first = list.versions.find((v) => v.version === 1);
    expect(first).toMatchObject({
      ...valuesOf(THRESHOLDS_V1),
      effective_from: '1970-01-01T00:00:00.000Z',
      set_by: null,
    });
    expect(await service.inForce()).toEqual(THRESHOLDS_V1);
  });

  it('refuses a missing reason, bad values, a start in the past and a change of nothing', async () => {
    const { reason: _, ...unexplained } = body();
    const noReason = await post(admin, unexplained);
    expect(noReason.statusCode).toBe(400);
    expect(noReason.json()).toMatchObject({ fields: { reason: 'Say why.' } });

    const bad = await post(admin, body({ established_at: 10, flag_period_days: 400 }));
    expect(bad.statusCode).toBe(400);
    expect(Object.keys(bad.json<{ fields: object }>().fields).sort()).toEqual([
      'established_at',
      'flag_period_days',
    ]);

    const past = await post(
      admin,
      body({ effective_from: new Date(Date.now() - DAY).toISOString() }),
    );
    expect(past.statusCode).toBe(400);
    expect(past.json()).toMatchObject({ fields: { effective_from: expect.any(String) } });

    const far = await post(
      admin,
      body({ effective_from: new Date(Date.now() + 400 * DAY).toISOString() }),
    );
    expect(far.statusCode).toBe(400);

    const same = await post(admin, body());
    expect(same.statusCode).toBe(400);
    expect(same.json<{ message: string }>().message).toMatch(/nothing would change/);

    const { rows } = await pool.query(`SELECT 1 FROM audit_log WHERE actor_id = $1`, [
      ids.get(admin),
    ]);
    expect(rows).toEqual([]);
  });

  it('records a new version from its start, audited, and leaves the one in force alone until then', async () => {
    const created = await post(admin, body({ contributor_min_rating: 72.5 }));
    expect(created.statusCode, created.body).toBe(201);
    const version = created.json<RatingThresholdVersion>();
    expect(version).toMatchObject({
      contributor_min_rating: 72.5,
      effective_from: later.toISOString(),
      set_by: admin,
      reason: 'A review of the contributor threshold.',
    });
    expect(version.version).toBeGreaterThan(1);

    // Now is still whatever was in force; the start is when it changes.
    expect((await service.inForce()).version).not.toBe(version.version);
    expect(await service.inForce(new Date(later.getTime() + 1000))).toMatchObject({
      version: version.version,
      contributorMinRating: 72.5,
    });

    const audit = await pool.query<{
      action: string;
      target_id: string;
      reason: string;
      previous: Record<string, unknown>;
      next: Record<string, unknown>;
    }>(
      `SELECT action, target_id, reason, previous, next FROM audit_log
        WHERE actor_id = $1 AND target_type = 'rating_threshold_version'`,
      [ids.get(admin)],
    );
    expect(audit.rows).toEqual([
      {
        action: 'rating_thresholds.supersede',
        target_id: String(version.version),
        reason: 'A review of the contributor threshold.',
        previous: expect.objectContaining({ contributor_min_rating: 70 }),
        next: expect.objectContaining({ contributor_min_rating: 72.5, version: version.version }),
      },
    ]);

    // A second version at the same start corrects the first: the higher wins a tie.
    const fixed = await post(admin, body({ contributor_min_rating: 71, reason: 'Corrected.' }));
    expect(fixed.statusCode, fixed.body).toBe(201);
    const correction = fixed.json<RatingThresholdVersion>();
    expect(correction.version).toBe(version.version + 1);
    expect(await service.inForce(new Date(later.getTime() + 1000))).toMatchObject({
      version: correction.version,
      contributorMinRating: 71,
    });

    const list = (
      await app.inject({ method: 'GET', url: '/admin/rating-thresholds', headers: as(admin) })
    ).json<RatingThresholdListResponse>();
    expect(list.versions.slice(0, 2).map((v) => v.version)).toEqual([
      correction.version,
      version.version,
    ]);
    expect(list.in_force).toBe((await service.inForce()).version);
  });

  it('never edits or deletes a version', async () => {
    await expect(
      pool.query(`UPDATE rating_threshold_version SET reason = 'edited' WHERE version = 1`),
    ).rejects.toThrow(/immutable/);
    await expect(
      pool.query(`DELETE FROM rating_threshold_version WHERE version = 1`),
    ).rejects.toThrow(/immutable/);
  });
});
