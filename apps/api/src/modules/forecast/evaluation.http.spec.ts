import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type {
  FixtureEvaluationsResponse,
  ForecastVersion,
  ModelPerformanceResponse,
} from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../identity/identity.service';
import { ForecastModule } from './forecast.module';
import { MODEL_CLIENT, ModelClient } from './forecast.service';

// Evaluations are decided by the database (one per version, immutable) and
// the performance figures are SQL aggregates, so these need the real schema.
// Skipped, visibly, without DATABASE_URL (CI has it).
const DATABASE_URL = process.env.DATABASE_URL;

// Seeded Premier League 2024/25 and its two clubs (packages/db/seed/001_catalog.sql).
const COMPETITION = '00000000-0000-4000-8000-000000000201';
const SEASON = '00000000-0000-4000-8000-000000000301';
const LIVERPOOL = '00000000-0000-4000-8000-000000000602';
const MAN_UNITED = '00000000-0000-4000-8000-000000000601';
const ENGLAND = '00000000-0000-4000-8000-000000000101';
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);

// This file owns a fixture of its own, so it never races the forecast HTTP
// suite over the seeded one: an evaluation would pin that suite's versions.
const FIXTURE = randomUUID();
const KICKOFF = '2025-02-01T15:00:00.000Z';

const answer = (computedAt: string, status: 'available' | 'unavailable' = 'available') =>
  status === 'available'
    ? {
        fixture_id: FIXTURE,
        status,
        computed_at: computedAt,
        probabilities: { home: 0.4637, draw: 0.2622, away: 0.2741 },
        expected_goals: { home: 1.49, away: 1.084 },
        most_likely_scorelines: [{ home: 1, away: 1, probability: 0.1247 }],
        leading_factors: [],
        inputs: {
          model_version: 'dixon-coles-elo@0.1.0',
          fit_date: '2025-01-31',
          matches_used: 210,
          elo_used: false,
          history_from: '2024-08-16',
          data_completeness: 'available',
        },
      }
    : {
        fixture_id: FIXTURE,
        status,
        computed_at: computedAt,
        reason: 'no_history',
        detail: 'scripted',
      };

class ScriptedModel {
  next: unknown = answer('2025-01-31T12:00:00Z');
  readonly client = new ModelClient({
    baseUrl: 'http://model.test',
    fetchImpl: async () =>
      new Response(JSON.stringify(this.next), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  });
}

function cookieValue(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const match = /^fmip_session=([^;]*)/.exec(header ?? '');
  return match?.[1] ?? '';
}

/** Runs statements in one transaction so trigger toggles never leak to another suite. */
async function inTransaction(pool: Pool, statements: [string, unknown[]?][]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [sql, params] of statements) await client.query(sql, params);
    await client.query('COMMIT');
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('evaluations', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  const model = new ScriptedModel();
  let adminCookie = '';
  let memberCookie = '';

  const post = (url: string, cookie?: string, payload?: unknown) =>
    app.inject({
      method: 'POST',
      url,
      payload: payload as Record<string, unknown> | undefined,
      headers: cookie === undefined ? {} : { cookie: `fmip_session=${cookie}` },
    });
  const get = (url: string) => app.inject({ method: 'GET', url });

  async function register(username: string): Promise<{ id: string; cookie: string }> {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        username,
        display_name: 'Evaluation Tester',
        email: `${username}@example.test`,
        password: 'correct horse battery staple',
        country_id: ENGLAND,
        preferred_language: 'en',
        timezone: 'Europe/London',
        accept_rules: true,
      },
    });
    expect(response.statusCode).toBe(201);
    return {
      id: (response.json() as { user: { id: string } }).user.id,
      cookie: cookieValue(response.headers['set-cookie']),
    };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [DatabaseModule, ForecastModule] })
      .overrideProvider(MODEL_CLIENT)
      .useValue(model.client)
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

    // A scheduled fixture with no score yet; the tests finish it.
    await pool.query(
      `INSERT INTO fixture (id, season_id, round, kickoff_at, status)
       VALUES ($1, $2, 'Evaluation test', $3, 'scheduled')`,
      [FIXTURE, SEASON, KICKOFF],
    );
    await pool.query(
      `INSERT INTO fixture_participant (fixture_id, team_id, side)
       VALUES ($1, $2, 'home'), ($1, $3, 'away')`,
      [FIXTURE, LIVERPOOL, MAN_UNITED],
    );

    const member = await register(`ev_${RUN}m`);
    memberCookie = member.cookie;
    const admin = await register(`ev_${RUN}a`);
    adminCookie = admin.cookie;
    await pool.query(
      `INSERT INTO user_role (user_id, role, granted_by, reason) VALUES ($1, 'admin', $1, $2)`,
      [admin.id, 'evaluation http test'],
    );
  });

  afterAll(async () => {
    await inTransaction(pool, [
      ['ALTER TABLE evaluation DISABLE TRIGGER evaluation_immutable'],
      ['ALTER TABLE forecast DISABLE TRIGGER forecast_immutable'],
      ['ALTER TABLE input_snapshot DISABLE TRIGGER input_snapshot_immutable'],
      ['DELETE FROM evaluation WHERE fixture_id = $1', [FIXTURE]],
      ['DELETE FROM forecast WHERE fixture_id = $1', [FIXTURE]],
      ['DELETE FROM input_snapshot WHERE fixture_id = $1', [FIXTURE]],
      ['ALTER TABLE input_snapshot ENABLE TRIGGER input_snapshot_immutable'],
      ['ALTER TABLE forecast ENABLE TRIGGER forecast_immutable'],
      ['ALTER TABLE evaluation ENABLE TRIGGER evaluation_immutable'],
      ['DELETE FROM fixture WHERE id = $1', [FIXTURE]],
      ['DELETE FROM user_account WHERE username LIKE $1', [`ev_${RUN}%`]],
    ]);
    await pool.end();
    await app.close();
  });

  const versions: ForecastVersion[] = [];

  it('computes three versions: before kick-off, unavailable, and after the result', async () => {
    for (const [next, kind] of [
      [answer('2025-01-31T12:00:00Z'), 'early'],
      [answer('2025-02-01T14:00:00Z', 'unavailable'), 'lineups_confirmed'],
      [answer('2025-02-02T09:00:00Z'), 'manual'],
    ] as const) {
      model.next = next;
      const response = await post(`/fixtures/${FIXTURE}/forecasts`, adminCookie, { kind });
      expect(response.statusCode).toBe(201);
      versions.push(response.json() as ForecastVersion);
    }
    expect(versions.map((v) => v.status)).toEqual(['available', 'unavailable', 'available']);
  });

  it('answers 404 for an unknown fixture and requires an admin session', async () => {
    expect((await get(`/fixtures/${randomUUID()}/evaluations`)).statusCode).toBe(404);
    expect((await post(`/fixtures/${FIXTURE}/evaluations`)).statusCode).toBe(401);
    expect((await post(`/fixtures/${FIXTURE}/evaluations`, memberCookie)).statusCode).toBe(403);
  });

  it('refuses to evaluate a fixture that is not finished, then one without a full-time score', async () => {
    const scheduled = await post(`/fixtures/${FIXTURE}/evaluations`, adminCookie);
    expect(scheduled.statusCode).toBe(409);
    expect(scheduled.json()).toEqual({
      error: 'conflict',
      message: 'The fixture is scheduled, not finished.',
    });

    await pool.query(`UPDATE fixture SET status = 'finished' WHERE id = $1`, [FIXTURE]);
    const unscored = await post(`/fixtures/${FIXTURE}/evaluations`, adminCookie);
    expect(unscored.statusCode).toBe(409);
    expect(unscored.json().message).toBe('The fixture has no full-time score yet.');

    const before = await get(`/fixtures/${FIXTURE}/evaluations`);
    expect(before.json()).toEqual({
      fixture_id: FIXTURE,
      coverage: 'not_supplied',
      last_updated_at: null,
      evaluations: [],
    });
  });

  it('scores every available version once the full-time score exists, skipping unavailable ones', async () => {
    await pool.query(
      `INSERT INTO fixture_score (fixture_id, kind, home, away) VALUES ($1, 'full_time', 2, 2)`,
      [FIXTURE],
    );
    const response = await post(`/fixtures/${FIXTURE}/evaluations`, adminCookie);
    expect(response.statusCode).toBe(201);
    const body = response.json() as FixtureEvaluationsResponse;

    expect(body.coverage).toBe('available');
    expect(body.evaluations.map((e) => e.version_number)).toEqual([1, 3]);
    const early = body.evaluations[0];
    expect(early).toMatchObject({
      forecast_id: versions[0]?.id,
      kind: 'early',
      model_version: 'dixon-coles-elo@0.1.0',
      pre_kickoff: true,
      actual: { home: 2, away: 2 },
      outcome: 'draw',
      p_outcome: 0.2622,
      log_loss: 1.338648,
      brier: 0.834497,
      correct: false,
      scoreline_hit: false,
    });
    expect(body.evaluations[1]?.pre_kickoff).toBe(false);
    expect(body.last_updated_at).toBe(body.evaluations[1]?.evaluated_at);
  });

  it('is idempotent: evaluating again adds nothing and changes nothing', async () => {
    const first = (
      await get(`/fixtures/${FIXTURE}/evaluations`)
    ).json() as FixtureEvaluationsResponse;
    const again = await post(`/fixtures/${FIXTURE}/evaluations`, adminCookie);
    expect(again.statusCode).toBe(201);
    expect((again.json() as FixtureEvaluationsResponse).evaluations).toEqual(first.evaluations);
  });

  it('is refused by the database on UPDATE and DELETE', async () => {
    const id = (
      (await get(`/fixtures/${FIXTURE}/evaluations`)).json() as FixtureEvaluationsResponse
    ).evaluations[0]?.id;
    await expect(
      pool.query(`UPDATE evaluation SET log_loss = 0 WHERE id = $1`, [id]),
    ).rejects.toMatchObject({ code: '23001' });
    await expect(pool.query(`DELETE FROM evaluation WHERE id = $1`, [id])).rejects.toMatchObject({
      code: '23001',
    });
  });

  it('serves model performance per competition from pre-kick-off versions only', async () => {
    const response = await get(`/competitions/${COMPETITION}/model-performance?season=${SEASON}`);
    expect(response.statusCode).toBe(200);
    const body = response.json() as ModelPerformanceResponse;

    expect(body.competition_id).toBe(COMPETITION);
    expect(body.season_id).toBe(SEASON);
    expect(body.reference).toEqual({ uniform_log_loss: 1.098612, uniform_brier: 0.666667 });
    expect(body.finished_fixtures).toBeGreaterThanOrEqual(2); // the seeded one and ours
    expect(body.fixtures_evaluated).toBeGreaterThanOrEqual(1);
    expect(body.unavailable_versions).toBeGreaterThanOrEqual(1);
    expect(body.post_kickoff_versions).toBeGreaterThanOrEqual(1);
    expect(body.coverage).toBe('limited'); // the seeded fixture has no pre-kick-off version

    const early = body.rows.find(
      (r) => r.model_version === 'dixon-coles-elo@0.1.0' && r.kind === 'early',
    );
    expect(early).toBeDefined();
    expect(early?.versions_evaluated).toBeGreaterThanOrEqual(1);
    expect(early?.log_loss).toBeGreaterThan(0);
    expect(early?.brier).toBeGreaterThan(0);
    // The post-kick-off `manual` version must not appear as a scored row.
    expect(body.rows.find((r) => r.kind === 'manual')).toBeUndefined();

    const other = await get(`/competitions/00000000-0000-4000-8000-000000000202/model-performance`);
    expect((other.json() as ModelPerformanceResponse).coverage).toBe('not_supplied');
    expect((await get(`/competitions/${randomUUID()}/model-performance`)).statusCode).toBe(404);
    expect(
      (await get(`/competitions/${COMPETITION}/model-performance?season=nope`)).statusCode,
    ).toBe(400);
  });
});
