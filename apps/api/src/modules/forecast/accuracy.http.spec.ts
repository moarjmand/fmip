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
// An earlier version of Sunday's forecast, wrong, superseded before kick-off.
const P_SUNDAY_EARLY = { home: 0.2, draw: 0.3, away: 0.5 };
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
  // T-1430: a finished match whose forecast is not scored yet, and one never forecast.
  const unscored = randomUUID();
  const bare = randomUUID();

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
      [unscored, MONDAY],
      [bare, MONDAY],
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
      version(sunday, SUNDAY, 'published', PUBLISHED, '2031-03-01T10:00:00Z', P_SUNDAY_EARLY),
    );
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
    await store.record(
      version(unscored, MONDAY, 'published', PUBLISHED, '2031-03-02T12:00:00Z', P_MONDAY),
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
      for (const id of [sunday, monday, unscored, bare]) {
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
    // Both published versions, each scored; the shadow version is never served.
    expect(body.evaluations).toHaveLength(2);
    expect(body.evaluations.map((e) => e.rps).sort()).toEqual(
      [rps(P_SUNDAY, 'home'), rps(P_SUNDAY_EARLY, 'home')].sort(),
    );
  });

  it('sums RPS in SQL as rps() does, and splits the weeks at Monday 00:00 UTC', async () => {
    const store = new PostgresEvaluationStore(pool);
    const rows = (await store.accuracySums('week', 'by_model')).filter(
      (r) => r.modelVersion === PUBLISHED,
    );
    expect(rows.map((r) => [r.periodStart, r.forecasts, r.matches])).toEqual([
      ['2031-02-24', 2, 1], // two versions of Sunday, the match counted once
      ['2031-03-03', 1, 1], // the post-kick-off version is not here
    ]);
    // Every sum is the last version before kick-off's alone (D-209).
    expect(rows[0]?.brier).toBeCloseTo(
      (P_SUNDAY.home - 1) ** 2 + P_SUNDAY.draw ** 2 + P_SUNDAY.away ** 2,
      5,
    );
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
      ['2031-03-01', 3, 2],
    ]);
    // One right of two matches, whatever the superseded version said.
    expect(months.map((r) => r.correct)).toEqual([1]);
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
    expect(published?.total).toMatchObject({
      forecasts: 3,
      matches: 2,
      coverage: 'limited',
      accuracy: 0.5,
    });
    expect(published?.total.rps).toBeCloseTo(
      (rps(P_SUNDAY, 'home') + rps(P_MONDAY, 'draw')) / 2,
      6,
    );
    expect(
      body.series.find((s) => s.model_version === PUBLISHED && s.competition?.id === COMPETITION),
    ).toBeDefined();
    const shadow = body.series.find((s) => s.model_version === SHADOW && s.competition === null);
    expect(shadow?.role).toBe('shadow');
    // A shadow version being judged gives counts only (T-1771, D-380). Whether
    // this one is depends on which published version is newest in the shared
    // test database, so both answers are held to the contract here; the rule
    // itself is pinned in console-model.spec.ts.
    if (shadow?.withheld === true) {
      expect(shadow.total).toMatchObject({ rps: null, log_loss: null, accuracy: null });
      expect(shadow.total.matches).toBeGreaterThan(0);
    } else {
      expect(shadow?.total.rps).toBeCloseTo(rps(P_SHADOW, 'home'), 6);
    }
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
    expect(march).toMatchObject({ forecasts: 3, matches: 2, coverage: 'limited' });
    // The share and the count are over the same two matches: 1 of 2.
    expect(march?.accuracy).toBe(0.5);
    expect(march?.rps).toBeCloseTo((rps(P_SUNDAY, 'home') + rps(P_MONDAY, 'draw')) / 2, 6);
    // Each competition carries its logo from the media boundary; none is
    // stored for this one, and it says so rather than leaving it out (T-1620).
    expect(league?.competition?.logo).toEqual({ coverage: 'not_supplied', url: null });
    expect(body.overall.competition).toBeNull();
  });

  it('serves the public page by ISO week when asked, and refuses an unknown period (T-1413)', async () => {
    expect((await get('/model/accuracy?period=day')).statusCode).toBe(400);
    const response = await get('/model/accuracy?period=week');
    expect(response.statusCode).toBe(200);
    const body = response.json() as PublicModelAccuracyResponse;
    expect(body.period).toBe('week');
    const league = body.competitions.find((c) => c.competition?.id === COMPETITION);
    expect(league?.points.map((p) => p.period)).toEqual(['2031-W09', '2031-W10']);
    expect(league?.model_versions).not.toContain(SHADOW);
    expect(league?.total).toMatchObject({ forecasts: 3, matches: 2, coverage: 'limited' });
  });

  it('serves each published version on its own with its calibration, never a shadow (T-1751)', async () => {
    const counts = async () =>
      // This run's matches only: other files write to the same database meanwhile.
      (
        await pool.query<{ forecasts: number; evaluations: number; latest: Date | null }>(
          `SELECT (SELECT COUNT(*)::int FROM forecast WHERE fixture_id = ANY($1::uuid[])) AS forecasts,
                  (SELECT COUNT(*)::int FROM evaluation WHERE fixture_id = ANY($1::uuid[]))
                    AS evaluations,
                  (SELECT MAX(computed_at) FROM forecast WHERE fixture_id = ANY($1::uuid[]))
                    AS latest`,
          [[sunday, monday, unscored, bare]],
        )
      ).rows[0];
    const before = await counts();
    const body = (await get('/model/accuracy?period=week')).json() as PublicModelAccuracyResponse;
    // Read only: not a forecast or an evaluation written (rule 5).
    expect(await counts()).toEqual(before);

    expect(body.versions.map((v) => v.model_version)).toContain(PUBLISHED);
    expect(body.versions.map((v) => v.model_version)).not.toContain(SHADOW);
    const own = body.versions.find((v) => v.model_version === PUBLISHED);
    expect(own?.total).toMatchObject({ forecasts: 3, matches: 2, coverage: 'limited' });
    expect(own?.points.map((p) => [p.period, p.period_end])).toEqual([
      ['2031-W09', '2031-03-03'],
      ['2031-W10', '2031-03-10'],
    ]);
    // 2031 is still to come: neither week is over.
    expect(own?.points.map((p) => p.complete)).toEqual([false, false]);
    // Every version's matches add up to the whole, each match under one version.
    expect(body.versions.reduce((sum, v) => sum + v.total.matches, 0)).toBe(
      body.overall.total.matches,
    );

    // Sunday's counted 0.5 / 0.3 / 0.2 (home won) and Monday's 0.1 / 0.3 / 0.6
    // (a draw): never the earlier Sunday version, the shadow's, or the one after kick-off.
    const bins = own?.calibration.bins ?? [];
    expect(bins).toHaveLength(10);
    expect(bins.map((b) => [b.forecasts, b.happened])).toEqual([
      [0, 0],
      [1, 0],
      [1, 0],
      [2, 1],
      [0, 0],
      [1, 1],
      [1, 0],
      [0, 0],
      [0, 0],
      [0, 0],
    ]);
    expect(bins[3]?.said).toBeCloseTo(0.3, 6);
    expect(own?.calibration.coverage).toBe('limited');

    // Rule 8: the same steps recomputed here from the stored forecasts and
    // their evaluations alone, the last published one before kick-off a match.
    const { rows } = await pool.query<{
      p_home: string;
      p_draw: string;
      p_away: string;
      outcome: string;
    }>(
      `SELECT DISTINCT ON (e.fixture_id) f.p_home, f.p_draw, f.p_away, e.outcome
         FROM evaluation e
         JOIN forecast f ON f.id = e.forecast_id
         JOIN model_version m ON m.id = f.model_version_id
        WHERE e.pre_kickoff AND f.role = 'published' AND m.model_id = $1
        ORDER BY e.fixture_id, f.computed_at DESC, f.id DESC`,
      [PUBLISHED],
    );
    const recomputed = Array.from({ length: 10 }, () => [0, 0]);
    for (const row of rows) {
      for (const [side, p] of [
        ['home', row.p_home],
        ['draw', row.p_draw],
        ['away', row.p_away],
      ] as const) {
        const step = recomputed[Math.min(Math.floor(Number(p) * 10 + 1e-9), 9)];
        if (step === undefined) continue;
        step[0] = (step[0] ?? 0) + 1;
        if (row.outcome === side) step[1] = (step[1] ?? 0) + 1;
      }
    }
    expect(bins.map((b) => [b.forecasts, b.happened])).toEqual(recomputed);

    // Over the same matches as the version's figures: three probabilities a match.
    expect(bins.reduce((sum, b) => sum + b.forecasts, 0)).toBe(3 * (own?.total.matches ?? 0));
    expect(body.overall.calibration.bins).toHaveLength(10);
  });

  it('keeps a week running while one of its matches waits for its score (T-1751)', async () => {
    const store = new PostgresEvaluationStore(pool);
    // An hour and a half after Monday's kick-off: the unscored match is waiting.
    const soon = await store.pendingPeriods('week', new Date('2031-03-03T02:00:00Z'));
    expect(soon).toContainEqual({ competitionId: COMPETITION, periodStart: '2031-03-03' });
    // Sunday and Monday's scored matches are not waiting: the week before is not there.
    expect(soon).not.toContainEqual({ competitionId: COMPETITION, periodStart: '2031-02-24' });
    // Past the 48 hours it is missing, not late: nothing waits for it.
    const later = await store.pendingPeriods('week', new Date('2031-03-05T01:00:00Z'));
    expect(later).not.toContainEqual({ competitionId: COMPETITION, periodStart: '2031-03-03' });
    const months = await store.pendingPeriods('month', new Date('2031-03-03T02:00:00Z'));
    expect(months).toContainEqual({ competitionId: COMPETITION, periodStart: '2031-03-01' });
  });

  it("reads each match's counted evaluation, never a shadow's or a post-kick-off one (T-1430)", async () => {
    const service = app.get(EvaluationService);
    const unknown = randomUUID();
    const counted = await service.countedFor([sunday, monday, unscored, bare, unknown]);
    expect(counted.has(unknown)).toBe(false);
    // Sunday: the later of the two published versions before kick-off, right.
    expect(counted.get(sunday)?.hasForecast).toBe(true);
    expect(counted.get(sunday)?.evaluation).toMatchObject({
      fixture_id: sunday,
      model_version: PUBLISHED,
      pre_kickoff: true,
      actual: { home: 2, away: 1 },
      correct: true,
      probabilities: P_SUNDAY,
    });
    // Monday: the version before kick-off, not the one after it, and wrong.
    expect(counted.get(monday)?.evaluation).toMatchObject({
      actual: { home: 1, away: 1 },
      correct: false,
      probabilities: P_MONDAY,
    });
    expect(counted.get(unscored)).toEqual({ hasForecast: true, evaluation: null });
    expect(counted.get(bare)).toEqual({ hasForecast: false, evaluation: null });
    expect(await service.countedFor([])).toEqual(new Map());
  });
});
