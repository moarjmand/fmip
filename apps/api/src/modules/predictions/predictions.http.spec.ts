import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { PredictionResponse } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../identity/identity.service';
import { PredictionsModule } from './predictions.module';

// Who may predict, and that versions are kept, are decided by the database
// and the session: these run only against the real schema (CI has it).
const DATABASE_URL = process.env.DATABASE_URL;

const ENGLAND = '00000000-0000-4000-8000-000000000101';
const PL_2025 = '00000000-0000-4000-8000-000000000302';
const LIVERPOOL = '00000000-0000-4000-8000-000000000602';
const MAN_UNITED = '00000000-0000-4000-8000-000000000601';
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);

// A fixture far in the future (open) and one in the past (locked).
const OPEN = randomUUID();
const PAST = randomUUID();

function cookieValue(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const match = /^fmip_session=([^;]*)/.exec(header ?? '');
  return match?.[1] ?? '';
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  '/fixtures/:id/prediction',
  () => {
    let app: NestFastifyApplication;
    let pool: Pool;
    let cookie = '';
    let userId = '';

    const put = (fixtureId: string, payload: unknown, withCookie = true) =>
      app.inject({
        method: 'PUT',
        url: `/fixtures/${fixtureId}/prediction`,
        payload: payload as Record<string, unknown>,
        headers: withCookie ? { cookie: `fmip_session=${cookie}` } : {},
      });
    const get = (fixtureId: string, withCookie = true) =>
      app.inject({
        method: 'GET',
        url: `/fixtures/${fixtureId}/prediction`,
        headers: withCookie ? { cookie: `fmip_session=${cookie}` } : {},
      });

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
        `INSERT INTO fixture (id, season_id, kickoff_at, status) VALUES
         ($1, $3, TIMESTAMPTZ '2088-04-04 15:00:00+00', 'scheduled'),
         ($2, $3, TIMESTAMPTZ '2025-09-01 15:00:00+00', 'finished')`,
        [OPEN, PAST, PL_2025],
      );
      await pool.query(
        `INSERT INTO fixture_participant (fixture_id, team_id, side) VALUES
         ($1, $3, 'home'), ($1, $4, 'away'), ($2, $4, 'home'), ($2, $3, 'away')`,
        [OPEN, PAST, LIVERPOOL, MAN_UNITED],
      );

      const registered = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          username: `pr_${RUN}`,
          display_name: 'Prediction Tester',
          email: `pr_${RUN}@example.test`,
          password: 'correct horse battery staple',
          country_id: ENGLAND,
          preferred_language: 'en',
          timezone: 'Europe/London',
          accept_rules: true,
        },
      });
      expect(registered.statusCode).toBe(201);
      cookie = cookieValue(registered.headers['set-cookie']);
      userId = (registered.json() as { user: { id: string } }).user.id;
    });

    afterAll(async () => {
      // Versions refuse DELETE (that is the point); the account cascade removes
      // user_prediction, and the trigger is toggled inside one transaction.
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
        await client.query(`DELETE FROM fixture WHERE id = ANY($1::uuid[])`, [[OPEN, PAST]]);
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

    const valid = {
      outcome: 'home',
      score: { home: 2, away: 1 },
      confidence: 4,
      reason_tags: ['form'],
    };

    it('blocks guests on both verbs', async () => {
      expect((await put(OPEN, valid, false)).statusCode).toBe(401);
      expect((await get(OPEN, false)).statusCode).toBe(401);
    });

    it('requires a verified e-mail before the first prediction', async () => {
      const response = await put(OPEN, valid);
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ error: 'email_unverified' });
      await pool.query(`UPDATE user_account SET email_verified_at = now() WHERE id = $1`, [userId]);
    });

    it('answers 404 for an unknown fixture and for a fixture not yet predicted', async () => {
      expect((await put(randomUUID(), valid)).statusCode).toBe(404);
      expect((await get(OPEN)).statusCode).toBe(404);
    });

    it('names every invalid field', async () => {
      const response = await put(OPEN, {
        outcome: 'away',
        score: { home: 3, away: 0 },
        confidence: 0,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        error: 'validation',
        fields: { score: expect.any(String), confidence: expect.any(String) },
      });
    });

    it('stores the first submission as version 1 and a change as version 2, keeping both', async () => {
      const first = await put(OPEN, valid);
      expect(first.statusCode).toBe(200);
      const v1 = (first.json() as PredictionResponse).prediction;
      expect(v1.latest).toMatchObject({
        version_number: 1,
        outcome: 'home',
        score: { home: 2, away: 1 },
        confidence: 4,
        reason_tags: ['form'],
        explanation: null,
      });
      expect(v1.locked).toBe(false);
      expect(v1.locks_at).toBe('2088-04-04T15:00:00.000Z');

      const second = await put(OPEN, {
        outcome: 'draw',
        confidence: 2,
        reason_tags: ['injuries', 'fatigue'],
        explanation: 'Two starters out.',
      });
      expect(second.statusCode).toBe(200);
      const v2 = (second.json() as PredictionResponse).prediction;
      expect(v2.id).toBe(v1.id);
      expect(v2.versions.map((v) => [v.version_number, v.outcome, v.confidence])).toEqual([
        [1, 'home', 4],
        [2, 'draw', 2],
      ]);
      expect(v2.latest.explanation).toBe('Two starters out.');
      expect(v2.latest.score).toBeNull();

      const own = (await get(OPEN)).json() as PredictionResponse;
      expect(own.prediction.versions).toHaveLength(2);
    });

    it('is refused by the database on any edit or removal of a version', async () => {
      const own = (await get(OPEN)).json() as PredictionResponse;
      const id = own.prediction.versions[0]?.id;
      await expect(
        pool.query(`UPDATE prediction_version SET outcome = 'away' WHERE id = $1`, [id]),
      ).rejects.toMatchObject({ code: '23001' });
      await expect(
        pool.query(`DELETE FROM prediction_version WHERE id = $1`, [id]),
      ).rejects.toMatchObject({ code: '23001' });
    });

    it('refuses a prediction on a match that has kicked off', async () => {
      const response = await put(PAST, valid);
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ error: 'locked' });
    });
  },
);
