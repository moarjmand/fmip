import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type {
  FixtureSettlementsResponse,
  PredictionResponse,
  SettlementRunResponse,
} from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../identity/identity.service';
import { PredictionsModule } from './predictions.module';

// Settlement is decided by rows in the database and must be safe to re-run:
// these tests run only against the real schema (CI has it).
const DATABASE_URL = process.env.DATABASE_URL;

const ENGLAND = '00000000-0000-4000-8000-000000000101';
const PL_2025 = '00000000-0000-4000-8000-000000000302';
// Two clubs that exist only for this run: nothing else can add results to them.
const HOME_TEAM = randomUUID();
const AWAY_TEAM = randomUUID();
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);

function cookieValue(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const match = /^fmip_session=([^;]*)/.exec(header ?? '');
  return match?.[1] ?? '';
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('settlement', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  const users: { id: string; cookie: string }[] = [];
  let admin = '';
  const fixtures: string[] = [];

  const put = (fixtureId: string, cookie: string, payload: unknown) =>
    app.inject({
      method: 'PUT',
      url: `/fixtures/${fixtureId}/prediction`,
      payload: payload as Record<string, unknown>,
      headers: { cookie: `fmip_session=${cookie}` },
    });
  const settle = (fixtureId: string, cookie?: string) =>
    app.inject({
      method: 'POST',
      url: `/fixtures/${fixtureId}/settle`,
      headers: cookie === undefined ? {} : { cookie: `fmip_session=${cookie}` },
    });
  const own = (fixtureId: string, cookie: string) =>
    app.inject({
      method: 'GET',
      url: `/fixtures/${fixtureId}/prediction`,
      headers: { cookie: `fmip_session=${cookie}` },
    });

  /** A two throwaway clubs fixture; predictions are placed while it is open, then it is moved into the past. */
  async function openFixture(): Promise<string> {
    const id = randomUUID();
    fixtures.push(id);
    await pool.query(
      `INSERT INTO fixture (id, season_id, kickoff_at, status) VALUES ($1, $2, now() + interval '1 hour', 'scheduled')`,
      [id, PL_2025],
    );
    await pool.query(
      `INSERT INTO fixture_participant (fixture_id, team_id, side) VALUES ($1, $2, 'home'), ($1, $3, 'away')`,
      [id, HOME_TEAM, AWAY_TEAM],
    );
    return id;
  }

  /** The match happened: kick-off in the past, status set, optional full-time score. */
  async function finish(
    id: string,
    status: string,
    score: { home: number; away: number } | null,
  ): Promise<void> {
    await pool.query(
      `UPDATE fixture SET kickoff_at = now() - interval '2 hours', status = $2 WHERE id = $1`,
      [id, status],
    );
    if (score !== null) {
      await pool.query(
        `INSERT INTO fixture_score (fixture_id, kind, home, away) VALUES ($1, 'full_time', $2, $3)
           ON CONFLICT (fixture_id, kind) DO UPDATE SET home = EXCLUDED.home, away = EXCLUDED.away`,
        [id, score.home, score.away],
      );
    }
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, PredictionsModule],
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
    await pool.query(
      `INSERT INTO team (id, name, kind, gender) VALUES ($1, $3, 'club', 'men'), ($2, $4, 'club', 'men')`,
      [HOME_TEAM, AWAY_TEAM, `Test Home ${RUN}`, `Test Away ${RUN}`],
    );

    for (const suffix of ['a', 'b', 'c']) {
      const registered = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          username: `st_${RUN}${suffix}`,
          display_name: 'Settlement Tester',
          email: `st_${RUN}${suffix}@example.test`,
          password: 'correct horse battery staple',
          country_id: ENGLAND,
          preferred_language: 'en',
          timezone: 'Europe/London',
          accept_rules: true,
        },
      });
      const id = (registered.json() as { user: { id: string } }).user.id;
      users.push({ id, cookie: cookieValue(registered.headers['set-cookie']) });
      await pool.query(`UPDATE user_account SET email_verified_at = now() WHERE id = $1`, [id]);
    }
    admin = users[2]?.cookie ?? '';
    await pool.query(
      `INSERT INTO user_role (user_id, role, granted_by, reason) VALUES ($1, 'admin', $1, 'settlement test')`,
      [users[2]?.id],
    );
  });

  afterAll(async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'ALTER TABLE points_transaction DISABLE TRIGGER points_transaction_immutable',
      );
      await client.query(
        `DELETE FROM points_transaction WHERE user_id IN (SELECT id FROM user_account WHERE username LIKE $1)`,
        [`st_${RUN}%`],
      );
      await client.query(
        'ALTER TABLE points_transaction ENABLE TRIGGER points_transaction_immutable',
      );
      await client.query('ALTER TABLE rating_snapshot DISABLE TRIGGER rating_snapshot_immutable');
      await client.query(
        `DELETE FROM rating_snapshot WHERE user_id IN (SELECT id FROM user_account WHERE username LIKE $1)`,
        [`st_${RUN}%`],
      );
      await client.query('ALTER TABLE rating_snapshot ENABLE TRIGGER rating_snapshot_immutable');
      await client.query('ALTER TABLE settlement DISABLE TRIGGER settlement_immutable');
      await client.query('ALTER TABLE settlement_run DISABLE TRIGGER settlement_run_immutable');
      await client.query(
        'ALTER TABLE prediction_version DISABLE TRIGGER prediction_version_immutable',
      );
      await client.query(`DELETE FROM settlement WHERE fixture_id = ANY($1::uuid[])`, [fixtures]);
      await client.query(`DELETE FROM settlement_run WHERE fixture_id = ANY($1::uuid[])`, [
        fixtures,
      ]);
      await client.query(
        `DELETE FROM prediction_version WHERE prediction_id IN
           (SELECT id FROM user_prediction WHERE fixture_id = ANY($1::uuid[]))`,
        [fixtures],
      );
      await client.query(
        'ALTER TABLE prediction_version ENABLE TRIGGER prediction_version_immutable',
      );
      await client.query('ALTER TABLE settlement_run ENABLE TRIGGER settlement_run_immutable');
      await client.query('ALTER TABLE settlement ENABLE TRIGGER settlement_immutable');
      await client.query(`DELETE FROM user_account WHERE username LIKE $1`, [`st_${RUN}%`]);
      await client.query(`DELETE FROM fixture WHERE id = ANY($1::uuid[])`, [fixtures]);
      await client.query(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [[HOME_TEAM, AWAY_TEAM]]);
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

  it('is an operator action: guests and members are refused, a live match is not settleable', async () => {
    const id = await openFixture();
    expect((await settle(id)).statusCode).toBe(401);
    expect((await settle(id, users[0]?.cookie)).statusCode).toBe(403);
    const early = await settle(id, admin);
    expect(early.statusCode).toBe(409);
    expect(early.json()).toMatchObject({ error: 'conflict' });
    expect((await settle(randomUUID(), admin)).statusCode).toBe(404);
  });

  it('settles every prediction once against the full-time score, and a re-run changes nothing', async () => {
    const id = await openFixture();
    const [a, b] = users;
    expect(
      (await put(id, a!.cookie, { outcome: 'home', score: { home: 2, away: 1 }, confidence: 5 }))
        .statusCode,
    ).toBe(200);
    expect((await put(id, b!.cookie, { outcome: 'draw', confidence: 2 })).statusCode).toBe(200);
    // b changes their mind before kick-off: version 2 is what gets settled.
    expect(
      (await put(id, b!.cookie, { outcome: 'away', score: { home: 0, away: 1 }, confidence: 3 }))
        .statusCode,
    ).toBe(200);
    await finish(id, 'finished', { home: 2, away: 1 });

    const first = await settle(id, admin);
    expect(first.statusCode).toBe(200);
    expect(first.json() as SettlementRunResponse).toMatchObject({
      settled: 2,
      void: 0,
      unchanged: 0,
    });

    const again = await settle(id, admin);
    expect(again.json() as SettlementRunResponse).toMatchObject({
      settled: 0,
      void: 0,
      unchanged: 2,
    });
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM settlement WHERE fixture_id = $1`,
      [id],
    );
    expect(rows[0]?.n).toBe('2');

    const mine = (await own(id, a!.cookie)).json() as PredictionResponse;
    expect(mine.prediction.settlement).toMatchObject({
      status: 'settled',
      actual: { home: 2, away: 1 },
      outcome_correct: true,
      score_predicted: true,
      score_correct: true,
      confidence: 5,
      version_number: 1,
    });
    const theirs = (await own(id, b!.cookie)).json() as PredictionResponse;
    expect(theirs.prediction.settlement).toMatchObject({
      status: 'settled',
      outcome_correct: false,
      score_correct: false,
      version_number: 2,
    });

    const summary = (
      await app.inject({ method: 'GET', url: `/fixtures/${id}/settlements` })
    ).json() as FixtureSettlementsResponse;
    expect(summary).toMatchObject({
      fixture_status: 'finished',
      predictions: 2,
      settled: 2,
      void: 0,
      outcome_correct: 1,
      score_correct: 1,
    });
  });

  it('voids a postponed match with the reason, once, then supersedes the void when it is played', async () => {
    const id = await openFixture();
    const [a] = users;
    await put(id, a!.cookie, { outcome: 'home', confidence: 3 });
    await finish(id, 'postponed', null);

    expect((await settle(id, admin)).json() as SettlementRunResponse).toMatchObject({
      settled: 0,
      void: 1,
    });
    expect((await settle(id, admin)).json() as SettlementRunResponse).toMatchObject({
      void: 0,
      unchanged: 1,
    });
    let mine = (await own(id, a!.cookie)).json() as PredictionResponse;
    expect(mine.prediction.settlement).toMatchObject({ status: 'void', void_reason: 'postponed' });

    // The rearranged match is played and finished 0-0: the void is superseded.
    await finish(id, 'finished', { home: 0, away: 0 });
    expect((await settle(id, admin)).json() as SettlementRunResponse).toMatchObject({ settled: 1 });
    mine = (await own(id, a!.cookie)).json() as PredictionResponse;
    expect(mine.prediction.settlement).toMatchObject({
      status: 'settled',
      outcome_correct: false,
      score_predicted: false,
      score_correct: null,
    });
    const { rows } = await pool.query<{ status: string }>(
      `SELECT status FROM settlement WHERE fixture_id = $1 ORDER BY settled_at`,
      [id],
    );
    // Both rows remain: the history is never rewritten.
    expect(rows.map((r) => r.status)).toEqual(['void', 'settled']);
  });

  it('is refused by the database on any edit of a settlement or a run', async () => {
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM settlement WHERE fixture_id = ANY($1::uuid[]) LIMIT 1`,
      [fixtures],
    );
    await expect(
      pool.query(`UPDATE settlement SET outcome_correct = true WHERE id = $1`, [rows[0]?.id]),
    ).rejects.toMatchObject({ code: '23001' });
    await expect(
      pool.query(`DELETE FROM settlement_run WHERE fixture_id = ANY($1::uuid[])`, [fixtures]),
    ).rejects.toMatchObject({ code: '23001' });
  });

  it('settleDue settles every final fixture that still owes a settlement', async () => {
    const id = await openFixture();
    await put(id, users[1]!.cookie, { outcome: 'away', confidence: 1 });
    await finish(id, 'abandoned', null);
    const run = await app.inject({
      method: 'POST',
      url: '/settlements/run',
      headers: { cookie: `fmip_session=${admin}` },
    });
    expect(run.statusCode).toBe(200);
    expect((run.json() as { fixtures: number; void: number }).void).toBeGreaterThanOrEqual(1);
    const mine = (await own(id, users[1]!.cookie)).json() as PredictionResponse;
    expect(mine.prediction.settlement).toMatchObject({ status: 'void', void_reason: 'abandoned' });
  });
});
