import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { ApiError, LeaderboardResponse } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { MODEL_CLIENT, ModelClient } from '../forecast/forecast.service';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../identity/identity.service';
import { computeRating, type RatingInput } from './internal/formula';
import { LEADERBOARD_RULES_V1 } from './internal/leaderboard';
import { ReputationModule } from './reputation.module';
import { withTriggersOff } from '../../testing/cleanup';

// The friends, month and season boards (T-641). Settlements are written
// straight into the store with chosen times -- in a month and in seasons no
// other suite uses -- so each board's population is exactly this suite's
// members, and each rating can be checked against `computeRating` over the
// rows written. Needs the real schema.
const DATABASE_URL = process.env.DATABASE_URL;
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

const ENGLAND = '00000000-0000-4000-8000-000000000101';
const PREMIER_LEAGUE = '00000000-0000-4000-8000-000000000201';
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const FLOOR = LEADERBOARD_RULES_V1.floor;
// A month nobody else settles in, and two season labels only this run uses.
const MONTH = '2031-01';
const SEASON_A = `t641a-${RUN}`;
const SEASON_B = `t641b-${RUN}`;

type Name = 'ann' | 'ben' | 'cat' | 'dan';

function cookieValue(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const match = /^fmip_session=([^;]*)/.exec(header ?? '');
  return match?.[1] ?? '';
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('Period leaderboards', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  const users = {} as Record<Name, { id: string; username: string; cookie: string }>;
  const seasons: Record<'a' | 'b', string> = { a: randomUUID(), b: randomUUID() };
  const fixtures: string[] = [];
  /** What each member settled, as the formula reads it, per period. */
  const written: Record<string, RatingInput[]> = {};

  const get = (url: string, who?: Name) =>
    app.inject({
      method: 'GET',
      url,
      headers: who === undefined ? {} : { cookie: `fmip_session=${users[who].cookie}` },
    });
  const board = async (url: string, who?: Name): Promise<LeaderboardResponse> => {
    const response = await get(url, who);
    expect(response.statusCode).toBe(200);
    return response.json() as LeaderboardResponse;
  };
  const names = (b: LeaderboardResponse) => b.entries.map((e) => e.username);

  /**
   * `count` settled predictions for `who` on fixtures in `season`, one an hour
   * from `start`: correct on a fixed cycle, an exact score now and then.
   */
  async function settle(who: Name, season: 'a' | 'b', start: string, count: number, seed: number) {
    const key = `${who}:${season}`;
    written[key] = [];
    for (let i = 0; i < count; i += 1) {
      const fixtureId = randomUUID();
      fixtures.push(fixtureId);
      const settledAt = new Date(Date.parse(start) + i * 3_600_000).toISOString();
      const correct = (i + seed) % 3 !== 0;
      const exact = correct && (i + seed) % 5 === 0;
      const confidence = ((i + seed) % 5) + 1;
      // Kick-off in the future so the lock lets the version in; nothing here
      // reads it, and the fixture is removed afterwards.
      await pool.query(
        `INSERT INTO fixture (id, season_id, kickoff_at, status)
         VALUES ($1, $2, now() + interval '1 day', 'scheduled')`,
        [fixtureId, seasons[season]],
      );
      const prediction = await pool.query<{ id: string }>(
        `INSERT INTO user_prediction (user_id, fixture_id) VALUES ($1, $2) RETURNING id`,
        [users[who].id, fixtureId],
      );
      const predictionId = prediction.rows[0]!.id;
      const version = await pool.query<{ id: string }>(
        `INSERT INTO prediction_version
           (prediction_id, version_number, outcome, home_goals, away_goals, confidence)
         VALUES ($1, 1, $2, $3, $4, $5) RETURNING id`,
        [predictionId, correct ? 'home' : 'away', 2, correct ? 1 : 3, confidence],
      );
      const run = await pool.query<{ id: string }>(
        `INSERT INTO settlement_run (fixture_id, settled) VALUES ($1, 1) RETURNING id`,
        [fixtureId],
      );
      await pool.query(
        `INSERT INTO settlement
           (run_id, prediction_id, version_id, fixture_id, settled_at, status, actual_home,
            actual_away, outcome_correct, score_predicted, score_correct, confidence)
         VALUES ($1, $2, $3, $4, $5, 'settled', 2, $6, $7, true, $8, $9)`,
        [
          run.rows[0]!.id,
          predictionId,
          version.rows[0]!.id,
          fixtureId,
          settledAt,
          exact ? 1 : 0,
          correct,
          exact,
          confidence,
        ],
      );
      written[key].push({
        settlementId: `${key}:${i}`,
        settledAt,
        correct,
        scorePredicted: true,
        scoreCorrect: exact,
        confidence,
        difficulty: null,
      });
    }
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, ReputationModule],
    })
      .overrideProvider(IDENTITY_OPTIONS)
      .useValue({
        ...DEFAULT_IDENTITY_OPTIONS,
        sessionSecret: 'test-secret-'.repeat(4),
        webBaseUrl: 'http://web.test',
        cookieSecure: false,
      })
      .overrideProvider(MODEL_CLIENT)
      .useValue(new ModelClient({ baseUrl: 'http://model.test' }))
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    pool = new Pool({ connectionString: DATABASE_URL });

    for (const name of ['ann', 'ben', 'cat', 'dan'] as Name[]) {
      const username = `pb_${RUN}${name}`;
      const registered = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          username,
          display_name: 'Period Tester',
          email: `${username}@example.test`,
          password: 'correct horse battery staple',
          country_id: ENGLAND,
          preferred_language: 'en',
          timezone: 'Europe/London',
          accept_rules: true,
        },
      });
      users[name] = {
        id: (registered.json() as { user: { id: string } }).user.id,
        username,
        cookie: cookieValue(registered.headers['set-cookie']),
      };
    }

    // ann: public history. ben: friends only, and ann's friend. cat: private.
    // dan: public, with too few settlements to be ranked.
    for (const [name, visibility] of [
      ['ben', 'friends'],
      ['cat', 'private'],
    ] as const) {
      await pool.query(
        `INSERT INTO privacy_setting (user_id, prediction_history_visibility) VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET prediction_history_visibility = EXCLUDED.prediction_history_visibility`,
        [users[name].id, visibility],
      );
    }
    await pool.query(
      `INSERT INTO friendship (low_id, high_id)
       VALUES (LEAST($1::uuid, $2::uuid), GREATEST($1::uuid, $2::uuid))`,
      [users.ann.id, users.ben.id],
    );

    await pool.query(
      `INSERT INTO season (id, competition_id, label, start_date, end_date)
       VALUES ($1, $3, $4, DATE '2030-08-01', DATE '2031-05-31'),
              ($2, $3, $5, DATE '2031-01-15', DATE '2031-12-31')`,
      [seasons.a, seasons.b, PREMIER_LEAGUE, SEASON_A, SEASON_B],
    );

    // January 2031, season A for everyone; February, season B, for ann only.
    await settle('ann', 'a', '2031-01-02T00:00:00.000Z', FLOOR + 5, 1);
    await settle('ben', 'a', '2031-01-03T00:00:00.000Z', FLOOR + 2, 2);
    await settle('cat', 'a', '2031-01-04T00:00:00.000Z', FLOOR + 10, 0);
    await settle('dan', 'a', '2031-01-05T00:00:00.000Z', 5, 1);
    await settle('ann', 'b', '2031-02-02T00:00:00.000Z', 10, 1);

    // All-time snapshots for the friends board, which reads snapshots as the global one does.
    for (const [name, settled, rating] of [
      ['ann', 60, 70.5],
      ['ben', 45, 64],
      ['cat', 80, 90],
    ] as const) {
      await pool.query(
        `INSERT INTO rating_snapshot
           (user_id, formula_version, settled_count, rating, components, provisional, established,
            inputs_hash)
         VALUES ($1, 'performance-rating@1.0.0', $2, $3, $4::jsonb, false, $5, $6)`,
        [
          users[name].id,
          settled,
          rating,
          JSON.stringify({ result: 0.7, exact_score: 0.2, consistency: 0.6, confidence: 0.5 }),
          settled >= 50,
          `t641-${RUN}-${name}`,
        ],
      );
    }
  });

  afterAll(async () => {
    const ids = Object.values(users).map((u) => u.id);
    await withTriggersOff(pool, async (client) => {
      await client.query(`DELETE FROM rating_snapshot WHERE user_id = ANY($1::uuid[])`, [ids]);
      await client.query(`DELETE FROM settlement WHERE fixture_id = ANY($1::uuid[])`, [fixtures]);
      await client.query(`DELETE FROM settlement_run WHERE fixture_id = ANY($1::uuid[])`, [
        fixtures,
      ]);
      await client.query(
        `DELETE FROM prediction_version WHERE prediction_id IN
           (SELECT id FROM user_prediction WHERE fixture_id = ANY($1::uuid[]))`,
        [fixtures],
      );
    });
    await pool.query(`DELETE FROM user_prediction WHERE fixture_id = ANY($1::uuid[])`, [fixtures]);
    await pool.query(`DELETE FROM fixture WHERE id = ANY($1::uuid[])`, [fixtures]);
    await pool.query(`DELETE FROM season WHERE id = ANY($1::uuid[])`, [Object.values(seasons)]);
    await pool.query(`DELETE FROM user_account WHERE id = ANY($1::uuid[])`, [ids]);
    await pool.end();
    await app.close();
  });

  it("rates a month board over that month's settlements only, with computeRating", async () => {
    const month = await board(`/leaderboard?period=month&month=${MONTH}`, 'ann');
    expect(month.scope).toBe('everyone');
    expect(month.period).toEqual({
      kind: 'month',
      month: MONTH,
      from: '2031-01-01T00:00:00.000Z',
      to: '2031-02-01T00:00:00.000Z',
    });
    expect(month.min_settled).toBe(FLOOR);
    expect(month.available_periods.months).toContain(MONTH);
    expect(month.available_periods.months).toContain('2031-02');
    expect(month.available_periods.seasons).toEqual(expect.arrayContaining([SEASON_A, SEASON_B]));

    // ann sees herself and her friend ben; cat's history is private, dan is under the floor.
    const expectedOf = (name: Name) => computeRating(written[`${name}:a`]!)!;
    const [first, second] = (['ann', 'ben'] as const)
      .map((name) => ({ name, result: expectedOf(name) }))
      .sort(
        (a, b) =>
          b.result.rating - a.result.rating || b.result.settledCount - a.result.settledCount,
      );
    expect(names(month)).toEqual([users[first!.name].username, users[second!.name].username]);
    for (const entry of month.entries) {
      const expected = expectedOf(entry.username.slice(-3) as Name);
      expect(entry.rating).toBe(expected.rating);
      expect(entry.settled_count).toBe(expected.settledCount);
      expect(entry.provisional).toBe(expected.provisional);
      expect(entry.established).toBe(expected.established);
    }
    expect(month.entries.map((e) => e.rank)).toEqual([1, 2]);
    expect(month.total).toBe(2);

    // February holds only ann's ten: nobody reaches the floor, and the board says so by being empty.
    const february = await board('/leaderboard?period=month&month=2031-02');
    expect(february.entries).toEqual([]);
    expect(february.total).toBe(0);
  });

  it("follows each member's prediction-history visibility, as their history does", async () => {
    // Signed out: only the public history.
    expect(names(await board(`/leaderboard?period=month&month=${MONTH}`))).toEqual([
      users.ann.username,
    ]);
    // cat sees her own private history, and not ben's friends-only one.
    expect(names(await board(`/leaderboard?period=month&month=${MONTH}`, 'cat')).sort()).toEqual(
      [users.ann.username, users.cat.username].sort(),
    );
    // The all-time board shows current ratings, public by blueprint 7.2, as before.
    const allTime = await board('/leaderboard?limit=100');
    expect(allTime.period).toEqual({ kind: 'all' });
    const ours = allTime.entries.filter((e) => e.username.startsWith(`pb_${RUN}`));
    expect(ours.map((e) => e.username)).toEqual([
      users.cat.username,
      users.ann.username,
      users.ben.username,
    ]);
  });

  it('rates a season by its label across competitions, and the friends board needs a session', async () => {
    const season = await board(
      `/leaderboard?period=season&season=${encodeURIComponent(SEASON_A)}`,
      'ben',
    );
    expect(season.period).toEqual({ kind: 'season', label: SEASON_A });
    expect(names(season).sort()).toEqual([users.ann.username, users.ben.username].sort());
    const thin = await board(`/leaderboard?period=season&season=${encodeURIComponent(SEASON_B)}`);
    expect(thin.entries).toEqual([]);

    const anonymous = await get('/leaderboard?scope=friends');
    expect(anonymous.statusCode).toBe(401);
    expect((anonymous.json() as ApiError).error).toBe('unauthenticated');

    // ann's friends: ann and ben, ranked among themselves; cat is nobody's friend here.
    const friends = await board('/leaderboard?scope=friends', 'ann');
    expect(friends.scope).toBe('friends');
    expect(names(friends)).toEqual([users.ann.username, users.ben.username]);
    expect(friends.entries.map((e) => [e.rank, e.rating, e.settled_count])).toEqual([
      [1, 70.5, 60],
      [2, 64, 45],
    ]);
    // cat has no friends: the board is cat alone.
    expect(names(await board('/leaderboard?scope=friends', 'cat'))).toEqual([users.cat.username]);

    // Friends and a month together: the month's ratings, among friends.
    const friendsMonth = await board(
      `/leaderboard?scope=friends&period=month&month=${MONTH}`,
      'ben',
    );
    expect(names(friendsMonth).sort()).toEqual([users.ann.username, users.ben.username].sort());
  });

  it('refuses what it does not understand, and the floor, on every board', async () => {
    const bad = await get('/leaderboard?scope=world&period=week');
    expect(bad.statusCode).toBe(400);
    expect(Object.keys((bad.json() as ApiError).fields ?? {}).sort()).toEqual(['period', 'scope']);
    expect((await get(`/leaderboard?period=month&month=${MONTH}&min_settled=1`)).statusCode).toBe(
      400,
    );
  });
});
