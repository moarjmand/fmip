import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type {
  AdminModelAccuracyResponse,
  FixtureEvaluationsResponse,
  PublicModelAccuracyResponse,
} from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { withTriggersOff } from '../../testing/cleanup';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../identity/identity.service';
import { EvaluationService } from './evaluation.service';
import { ForecastModule } from './forecast.module';
import { MODEL_CLIENT, ModelClient } from './forecast.service';
import { PostgresEvaluationStore } from './internal/evaluation-store';
import { PostgresForecastStore, type NewForecast } from './internal/forecast-store';
import { rps, uniformRps } from './internal/scoring';

/**
 * T-1369 against the real schema: RPS computed when read agrees with
 * `rps()`, the week boundary is the database's (Monday, UTC), the console's
 * series keep each version and role apart, and the public page serves the
 * published forecasts only. The model versions carry this run's tag and the
 * matches are in 2031, so rows other files leave behind are ignored.
 */
const DATABASE_URL = process.env.DATABASE_URL;

// Seeded Premier League 2024/25 and its two clubs (packages/db/seed/001_catalog.sql).
const COMPETITION = '00000000-0000-4000-8000-000000000201';
const SEASON = '00000000-0000-4000-8000-000000000301';
const HOME = '00000000-0000-4000-8000-000000000602';
const AWAY = '00000000-0000-4000-8000-000000000601';
const ENGLAND = '00000000-0000-4000-8000-000000000101';
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const PUBLISHED = `accuracy-${RUN}@0.1.0`;
const SHADOW = `accuracy-${RUN}@0.9.0`;

// A Sunday night and the Monday just after it: two ISO weeks, one month.
const SUNDAY = '2031-03-02T23:30:00.000Z';
const MONDAY = '2031-03-03T00:30:00.000Z';

const P_SUNDAY = { home: 0.5, draw: 0.3, away: 0.2 }; // the home side won 2-1
const P_SHADOW = { home: 0.6, draw: 0.25, away: 0.15 };
const P_MONDAY = { home: 0.1, draw: 0.3, away: 0.6 }; // a 1-1 draw

function cookieValue(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const match = /^fmip_session=([^;]*)/.exec(header ?? '');
  return match?.[1] ?? '';
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('model accuracy', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let adminCookie = '';
  let memberCookie = '';
  const sunday = randomUUID();
  const monday = randomUUID();

  const version = (
    fixture: string,
    kickoff: string,
    role: 'published' | 'shadow',
    modelId: string,
    computedAt: string,
    p: { home: number; draw: number; away: number },
  ): NewForecast => ({
    fixtureId: fixture,
    kind: 'early',
    role,
    modelId,
    request: {
      fixture_id: fixture,
      home_team_id: HOME,
      away_team_id: AWAY,
      division: 'E0',
      kickoff_at: kickoff,
    },
    computedAt: new Date(computedAt),
    available: {
      probabilities: p,
      expectedGoals: { home: 1.5, away: 1.0 },
      mostLikely: [{ home: 1, away: 0, probability: 0.12 }],
      leadingFactors: [],
      inputs: {
        model_version: modelId,
        fit_date: '2031-03-01',
        matches_used: 100,
        elo_used: true,
        history_from: '2029-03-01',
        data_completeness: 'available',
      },
    },
    unavailable: null,
  });

  const get = (url: string, cookie?: string) =>
    app.inject({
      method: 'GET',
      url,
      headers: cookie === undefined ? {} : { cookie: `fmip_session=${cookie}` },
    });

  async function register(username: string): Promise<{ id: string; cookie: string }> {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        username,
        display_name: 'Accuracy Tester',
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
      .useValue(
        new ModelClient({
          baseUrl: 'http://model.test',
          fetchImpl: () => Promise.reject(new Error('unused')),
        }),
      )
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

    for (const [id, kickoff] of [
      [sunday, SUNDAY],
      [monday, MONDAY],
    ] as const) {
      await pool.query(
        `INSERT INTO fixture (id, season_id, round, kickoff_at, status)
         VALUES ($1, $2, 'Accuracy test', $3, 'finished')`,
        [id, SEASON, kickoff],
      );
      await pool.query(
        `INSERT INTO fixture_participant (fixture_id, team_id, side)
         VALUES ($1, $2, 'home'), ($1, $3, 'away')`,
        [id, HOME, AWAY],
      );
    }
    const store = new PostgresForecastStore(pool);
    await store.record(
      version(sunday, SUNDAY, 'published', PUBLISHED, '2031-03-02T10:00:00Z', P_SUNDAY),
    );
    await store.record(version(sunday, SUNDAY, 'shadow', SHADOW, '2031-03-02T10:00:00Z', P_SHADOW));
    await store.record(
      version(monday, MONDAY, 'published', PUBLISHED, '2031-03-02T12:00:00Z', P_MONDAY),
    );
    // After kick-off: evaluated, never counted (D-031).
    await store.record(
      version(monday, MONDAY, 'published', PUBLISHED, '2031-03-03T09:00:00Z', {
        home: 0.05,
        draw: 0.9,
        away: 0.05,
      }),
    );
    await pool.query(
      `INSERT INTO fixture_score (fixture_id, kind, home, away)
       VALUES ($1, 'full_time', 2, 1), ($2, 'full_time', 1, 1)`,
      [sunday, monday],
    );
    const evaluations = new EvaluationService(new PostgresEvaluationStore(pool));
    await evaluations.evaluateFixture(sunday);
    await evaluations.evaluateFixture(monday);

    const member = await register(`acc_${RUN}m`);
    memberCookie = member.cookie;
    const admin = await register(`acc_${RUN}a`);
    adminCookie = admin.cookie;
    await pool.query(
      `INSERT INTO user_role (user_id, role, granted_by, reason) VALUES ($1, 'admin', $1, $2)`,
      [admin.id, 'accuracy http test'],
    );
    // A cold Nest module and two password hashes: more than the default 10 s on a slow host.
  }, 60_000);

  afterAll(async () => {
    await withTriggersOff(pool, async (client) => {
      for (const id of [sunday, monday]) {
        await client.query(`DELETE FROM evaluation WHERE fixture_id = $1`, [id]);
        await client.query(`DELETE FROM forecast WHERE fixture_id = $1`, [id]);
        await client.query(`DELETE FROM input_snapshot WHERE fixture_id = $1`, [id]);
        await client.query(`DELETE FROM fixture_score WHERE fixture_id = $1`, [id]);
        await client.query(`DELETE FROM fixture_participant WHERE fixture_id = $1`, [id]);
        await client.query(`DELETE FROM fixture WHERE id = $1`, [id]);
      }
    });
    // Outside the replica session, so the accounts' cascade runs.
    await pool.query(`DELETE FROM user_account WHERE username LIKE $1`, [`acc_${RUN}%`]);
    await pool.end();
    await app.close();
  });

  it('serves each evaluation its RPS, computed from the stored probabilities', async () => {
    const body = (
      await get(`/fixtures/${sunday}/evaluations`)
    ).json() as FixtureEvaluationsResponse;
    expect(body.evaluations).toHaveLength(1); // the shadow version is never served
    expect(body.evaluations[0]?.rps).toBe(rps(P_SUNDAY, 'home'));
  });

  it('sums RPS in SQL as rps() does, and splits the weeks at Monday 00:00 UTC', async () => {
    const store = new PostgresEvaluationStore(pool);
    const rows = (await store.accuracySums('week', 'by_model')).filter(
      (r) => r.modelVersion === PUBLISHED,
    );
    expect(rows.map((r) => [r.periodStart, r.forecasts, r.matches])).toEqual([
      ['2031-02-24', 1, 1],
      ['2031-03-03', 1, 1], // the post-kick-off version is not here
    ]);
    expect(rows[0]?.rps).toBeCloseTo(rps(P_SUNDAY, 'home'), 6);
    expect(rows[1]?.rps).toBeCloseTo(rps(P_MONDAY, 'draw'), 6);
    expect(rows[0]?.uniformRps).toBeCloseTo(uniformRps('home'), 6);
    expect(rows[1]?.uniformRps).toBeCloseTo(uniformRps('draw'), 6);
    expect(rows[0]?.logLoss).toBeCloseTo(-Math.log(0.5), 5);
    expect(rows.map((r) => r.correct)).toEqual([1, 0]);

    const months = (await store.accuracySums('month', 'by_model')).filter(
      (r) => r.modelVersion === PUBLISHED,
    );
    expect(months.map((r) => [r.periodStart, r.forecasts, r.matches])).toEqual([
      ['2031-03-01', 2, 2],
    ]);
  });

  it('refuses the console series to a guest and a member, and an unknown period', async () => {
    expect((await get('/admin/model/accuracy')).statusCode).toBe(401);
    expect((await get('/admin/model/accuracy', memberCookie)).statusCode).toBe(403);
    expect((await get('/admin/model/accuracy?period=day', adminCookie)).statusCode).toBe(400);
  });

  it('gives the console every version in its role, by ISO week', async () => {
    const response = await get('/admin/model/accuracy?period=week', adminCookie);
    expect(response.statusCode).toBe(200);
    const body = response.json() as AdminModelAccuracyResponse;
    expect(body.period).toBe('week');
    const published = body.series.find(
      (s) => s.model_version === PUBLISHED && s.role === 'published' && s.competition === null,
    );
    expect(published?.points.map((p) => p.period)).toEqual(['2031-W09', '2031-W10']);
    expect(published?.total).toMatchObject({ forecasts: 2, matches: 2, coverage: 'limited' });
    expect(published?.total.rps).toBeCloseTo(
      (rps(P_SUNDAY, 'home') + rps(P_MONDAY, 'draw')) / 2,
      6,
    );
    expect(
      body.series.find((s) => s.model_version === PUBLISHED && s.competition?.id === COMPETITION),
    ).toBeDefined();
    const shadow = body.series.find((s) => s.model_version === SHADOW && s.competition === null);
    expect(shadow?.role).toBe('shadow');
    expect(shadow?.total.rps).toBeCloseTo(rps(P_SHADOW, 'home'), 6);
  });

  it('serves the public page the published forecasts only, by month', async () => {
    const response = await get('/model/accuracy');
    expect(response.statusCode).toBe(200);
    const body = response.json() as PublicModelAccuracyResponse;
    expect(body.period).toBe('month');
    expect(body.minimum_matches).toBe(30);
    expect(body.overall.model_versions).toContain(PUBLISHED);
    expect(body.overall.model_versions).not.toContain(SHADOW);
    const league = body.competitions.find((c) => c.competition?.id === COMPETITION);
    expect(league?.model_versions).not.toContain(SHADOW);
    const march = league?.points.find((p) => p.period === '2031-03');
    expect(march).toMatchObject({ forecasts: 2, matches: 2, coverage: 'limited' });
    expect(march?.accuracy).toBe(0.5);
  });
});
