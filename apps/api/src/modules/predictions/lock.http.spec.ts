import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { PredictionResponse } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../identity/identity.service';
import { PredictionsModule } from './predictions.module';
import { PredictionsService } from './predictions.service';

// The kick-off lock (T-051). The acceptance criterion is "no write succeeds
// after kick-off, verified by clock skew test": the API's clock is made to
// lie in both directions and the database must still have the last word.
const DATABASE_URL = process.env.DATABASE_URL;

const ENGLAND = '00000000-0000-4000-8000-000000000101';
const PL_2025 = '00000000-0000-4000-8000-000000000302';
// Two clubs that exist only for this run: nothing else can add results to them.
const HOME_TEAM = randomUUID();
const AWAY_TEAM = randomUUID();
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function cookieValue(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const match = /^fmip_session=([^;]*)/.exec(header ?? '');
  return match?.[1] ?? '';
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('kick-off lock', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let service: PredictionsService;
  let cookie = '';
  let userId = '';
  const fixtures: string[] = [];

  const put = (fixtureId: string, payload: unknown) =>
    app.inject({
      method: 'PUT',
      url: `/fixtures/${fixtureId}/prediction`,
      payload: payload as Record<string, unknown>,
      headers: { cookie: `fmip_session=${cookie}` },
    });

  /** A two throwaway clubs fixture kicking off at `kickoff` (SQL expression, DB clock). */
  async function fixtureAt(kickoff: string): Promise<string> {
    const id = randomUUID();
    fixtures.push(id);
    await pool.query(
      `INSERT INTO fixture (id, season_id, kickoff_at, status) VALUES ($1, $2, ${kickoff}, 'scheduled')`,
      [id, PL_2025],
    );
    await pool.query(
      `INSERT INTO fixture_participant (fixture_id, team_id, side) VALUES ($1, $2, 'home'), ($1, $3, 'away')`,
      [id, HOME_TEAM, AWAY_TEAM],
    );
    return id;
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
    service = moduleRef.get(PredictionsService);
    pool = new Pool({ connectionString: DATABASE_URL });
    await pool.query(
      `INSERT INTO team (id, name, kind, gender) VALUES ($1, $3, 'club', 'men'), ($2, $4, 'club', 'men')`,
      [HOME_TEAM, AWAY_TEAM, `Test Home ${RUN}`, `Test Away ${RUN}`],
    );

    const registered = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        username: `lk_${RUN}`,
        display_name: 'Lock Tester',
        email: `lk_${RUN}@example.test`,
        password: 'correct horse battery staple',
        country_id: ENGLAND,
        preferred_language: 'en',
        timezone: 'Europe/London',
        accept_rules: true,
      },
    });
    cookie = cookieValue(registered.headers['set-cookie']);
    userId = (registered.json() as { user: { id: string } }).user.id;
    await pool.query(`UPDATE user_account SET email_verified_at = now() WHERE id = $1`, [userId]);
  });

  afterAll(async () => {
    service.clock = () => new Date();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'ALTER TABLE prediction_version DISABLE TRIGGER prediction_version_immutable',
      );
      await client.query(
        `DELETE FROM prediction_version WHERE prediction_id IN
           (SELECT id FROM user_prediction WHERE user_id = $1)`,
        [userId],
      );
      await client.query(
        'ALTER TABLE prediction_version ENABLE TRIGGER prediction_version_immutable',
      );
      await client.query(`DELETE FROM user_account WHERE id = $1`, [userId]);
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

  const call = { outcome: 'home', confidence: 3 };

  it('accepts a prediction right up to kick-off and refuses the next write after it', async () => {
    // Wide enough that a loaded machine still gets the first write in before kick-off.
    const id = await fixtureAt(`now() + interval '4 seconds'`);
    const before = await put(id, call);
    expect(before.statusCode).toBe(200);
    expect((before.json() as PredictionResponse).prediction.locked).toBe(false);

    await sleep(4_500);
    const after = await put(id, { outcome: 'draw', confidence: 3 });
    expect(after.statusCode).toBe(409);
    expect(after.json()).toMatchObject({ error: 'locked' });

    const own = await app.inject({
      method: 'GET',
      url: `/fixtures/${id}/prediction`,
      headers: { cookie: `fmip_session=${cookie}` },
    });
    const prediction = (own.json() as PredictionResponse).prediction;
    expect(prediction.versions).toHaveLength(1);
    expect(prediction.locked).toBe(true);
  }, 15_000);

  it('clock skew: an API clock that lags behind cannot slip a write past the database', async () => {
    // Kicked off ten seconds ago by the database clock; the API believes it is
    // still a minute early.
    const id = await fixtureAt(`now() - interval '10 seconds'`);
    service.clock = () => new Date(Date.now() - 70_000);
    try {
      const response = await put(id, call);
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ error: 'locked' });
    } finally {
      service.clock = () => new Date();
    }
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM user_prediction WHERE user_id = $1 AND fixture_id = $2`,
      [userId, id],
    );
    // The transaction rolled back whole: no prediction row was left behind either.
    expect(rows[0]?.n).toBe('0');
  });

  it('clock skew: an API clock that runs ahead refuses a match the database still has open', async () => {
    const id = await fixtureAt(`now() + interval '1 hour'`);
    service.clock = () => new Date(Date.now() + 2 * 3_600_000);
    try {
      const response = await put(id, call);
      expect(response.statusCode).toBe(409);
    } finally {
      service.clock = () => new Date();
    }
    // With an honest clock the same write goes through.
    expect((await put(id, call)).statusCode).toBe(200);
  });

  it('is enforced on a direct write to the table as well', async () => {
    const id = await fixtureAt(`now() - interval '1 day'`);
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO user_prediction (user_id, fixture_id) VALUES ($1, $2) RETURNING id`,
      [userId, id],
    );
    await expect(
      pool.query(
        `INSERT INTO prediction_version (prediction_id, version_number, outcome, confidence)
         VALUES ($1, 1, 'home', 3)`,
        [rows[0]?.id],
      ),
    ).rejects.toMatchObject({ code: 'PL001' });
  });
});
