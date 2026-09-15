import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type {
  ForecastListResponse,
  ForecastVersion,
  ForecastVersionsResponse,
} from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { IDENTITY_OPTIONS, DEFAULT_IDENTITY_OPTIONS } from '../identity/identity.service';
import { ForecastModule } from './forecast.module';
import { MODEL_CLIENT, ModelClient } from './forecast.service';
import { withTriggersOff } from '../../testing/cleanup';

// Forecast versions are decided by the database: the next version number,
// the probability total, and the refusal to update or delete (rule 5). A fake
// store would prove nothing, so these run only with DATABASE_URL (CI has it).
const DATABASE_URL = process.env.DATABASE_URL;
// Set by CI after starting the real model service; the last block then asks it
// about the seeded fixture and stores what it answers.
const MODEL_SERVICE_URL = process.env.MODEL_SERVICE_URL;

// Seeded Liverpool v Man United, Premier League 2024/25 (packages/db/seed/002_fixtures.sql).
const FIXTURE = '00000000-0000-4000-8000-000000000901';
/** A seeded fixture the model has never been asked about. */
const NO_FORECAST = '00000000-0000-4000-8000-000000000902';
const ENGLAND = '00000000-0000-4000-8000-000000000101';
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);

const CONTRACT_DIR = join(__dirname, '..', '..', '..', '..', 'model', 'contract');
const golden = (name: string): unknown =>
  JSON.parse(readFileSync(join(CONTRACT_DIR, name), 'utf8')) as unknown;

/** A model client whose answer the test chooses per call. */
class ScriptedModel {
  next: unknown = golden('forecast-response.example.json');
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

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  '/fixtures/:id/forecasts',
  () => {
    let app: NestFastifyApplication;
    let pool: Pool;
    const model = new ScriptedModel();
    let memberCookie = '';
    let adminCookie = '';
    let adminId = '';
    const createdIds: string[] = [];

    const get = (fixtureId: string) =>
      app.inject({ method: 'GET', url: `/fixtures/${fixtureId}/forecasts` });
    const post = (fixtureId: string, payload: unknown, cookie?: string) =>
      app.inject({
        method: 'POST',
        url: `/fixtures/${fixtureId}/forecasts`,
        payload: payload as Record<string, unknown>,
        headers: cookie === undefined ? {} : { cookie: `fmip_session=${cookie}` },
      });

    async function register(username: string): Promise<{ id: string; cookie: string }> {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          username,
          display_name: 'Forecast Tester',
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
      const moduleRef = await Test.createTestingModule({
        imports: [DatabaseModule, ForecastModule],
      })
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

      const member = await register(`fc_${RUN}m`);
      memberCookie = member.cookie;
      const admin = await register(`fc_${RUN}a`);
      adminCookie = admin.cookie;
      adminId = admin.id;
      await pool.query(
        `INSERT INTO user_role (user_id, role, granted_by, reason) VALUES ($1, 'admin', $1, $2)`,
        [adminId, 'forecast http test'],
      );
    });

    afterAll(async () => {
      // Forecasts refuse DELETE by trigger (that is the point), so test rows are
      // removed with the trigger off for **this session** and nobody else's.
      //
      // The previous version argued that the `ALTER TABLE` lock serialised this
      // against any other suite doing the same. It did -- and that was never
      // the risk. A suite *asserting* the table is immutable takes no such lock
      // and would simply have found the trigger off, which is how the
      // moderation schema suite once passed for the wrong reason.
      if (createdIds.length > 0) {
        await withTriggersOff(pool, async (client) => {
          await client.query(`DELETE FROM forecast WHERE id = ANY($1::uuid[])`, [createdIds]);
          await client.query(
            `DELETE FROM input_snapshot s WHERE s.fixture_id = $1 AND NOT EXISTS
               (SELECT 1 FROM forecast f WHERE f.input_snapshot_id = s.id)`,
            [FIXTURE],
          );
        });
      }
      await pool.query(`DELETE FROM user_account WHERE username LIKE $1`, [`fc_${RUN}%`]);
      await pool.end();
      await app.close();
    });

    it('answers 404 for an unknown or malformed fixture id', async () => {
      expect((await get('00000000-0000-4000-8000-0000000009ff')).statusCode).toBe(404);
      expect((await get('not-a-uuid')).statusCode).toBe(404);
    });

    it('serves an honest empty list before any version exists', async () => {
      const response = await get(FIXTURE);
      expect(response.statusCode).toBe(200);
      const body = response.json() as ForecastVersionsResponse;
      expect(body.fixture_id).toBe(FIXTURE);
      expect(Array.isArray(body.versions)).toBe(true);
      if (body.versions.length === 0) {
        expect(body.coverage).toBe('not_supplied');
        expect(body.last_updated_at).toBeNull();
        expect(body.latest).toBeNull();
      }
    });

    it('requires an admin session to compute a version', async () => {
      expect((await post(FIXTURE, { kind: 'early' })).statusCode).toBe(401);
      expect((await post(FIXTURE, { kind: 'early' }, memberCookie)).statusCode).toBe(403);
    });

    it('validates the kind', async () => {
      const response = await post(FIXTURE, { kind: 'guess' }, adminCookie);
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        error: 'validation',
        fields: { kind: expect.any(String) },
      });
    });

    let first: ForecastVersion;
    let second: ForecastVersion;

    it('stores what the model answered as version N+1 with probabilities that total 1', async () => {
      const before = ((await get(FIXTURE)).json() as ForecastVersionsResponse).versions.length;
      const response = await post(FIXTURE, { kind: 'early' }, adminCookie);
      expect(response.statusCode).toBe(201);
      first = response.json() as ForecastVersion;
      createdIds.push(first.id);

      expect(first.version_number).toBe(before + 1);
      expect(first.kind).toBe('early');
      expect(first.status).toBe('available');
      expect(first.model_version).toBe('dixon-coles-elo@0.1.0');
      expect(first.probabilities).toEqual({ home: 0.4637, draw: 0.2622, away: 0.2741 });
      expect(first.data_completeness).toBe('available');
      expect(first.unavailable_reason).toBeNull();

      const stored = await pool.query<{ total: string; request: { division: string } }>(
        `SELECT f.p_home + f.p_draw + f.p_away AS total, s.request
         FROM forecast f JOIN input_snapshot s ON s.id = f.input_snapshot_id
        WHERE f.id = $1`,
        [first.id],
      );
      expect(stored.rows[0]?.total).toBe('1.0000');
      expect(stored.rows[0]?.request.division).toBe('E0');
    });

    it('never edits a version: a second computation is a new version, the old one unchanged', async () => {
      model.next = {
        fixture_id: FIXTURE,
        status: 'unavailable',
        computed_at: '2025-01-04T18:00:00Z',
        reason: 'no_history',
        detail: 'scripted',
      };
      const response = await post(FIXTURE, { kind: 'lineups_confirmed' }, adminCookie);
      expect(response.statusCode).toBe(201);
      second = response.json() as ForecastVersion;
      createdIds.push(second.id);

      expect(second.version_number).toBe(first.version_number + 1);
      expect(second.status).toBe('unavailable');
      expect(second.unavailable_reason).toBe('no_history');
      expect(second.probabilities).toBeNull();

      const list = (await get(FIXTURE)).json() as ForecastVersionsResponse;
      expect(list.versions.find((v) => v.id === first.id)).toEqual(first);
      expect(list.latest?.id).toBe(second.id);
      expect(list.coverage).toBe('not_supplied');
      expect(list.last_updated_at).toBe('2025-01-04T18:00:00.000Z');
    });

    it('lists the latest version for several fixtures, never the first (T-136)', async () => {
      // This fixture now has two versions, and the second is the one that
      // counts. `versions` is oldest first, so a list that reached for
      // `versions[0]` would answer with the forecast the model has already
      // replaced — wrong in a way nothing else would catch.
      const response = await app.inject({
        method: 'GET',
        url: `/forecasts?fixtures=${FIXTURE}`,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as ForecastListResponse;

      expect(body.fixtures).toHaveLength(1);
      expect(body.fixtures[0]?.latest?.id).toBe(second.id);
      expect(body.fixtures[0]?.latest?.version_number).toBe(first.version_number + 1);
    });

    it('says the model has no answer rather than leaving a fixture out', async () => {
      // A fixture with no forecast comes back with `latest` null. Omitting it
      // would make "the model has nothing" indistinguishable from "you asked
      // about a match that does not exist".
      const response = await app.inject({
        method: 'GET',
        url: `/forecasts?fixtures=${NO_FORECAST}`,
      });
      const body = response.json() as ForecastListResponse;

      expect(body.fixtures).toEqual([{ fixture_id: NO_FORECAST, latest: null }]);
    });

    it('is refused by the database on UPDATE and DELETE of a forecast or its snapshot', async () => {
      await expect(
        pool.query(`UPDATE forecast SET p_home = 0.9 WHERE id = $1`, [first.id]),
      ).rejects.toMatchObject({ code: '23001' });
      await expect(
        pool.query(`DELETE FROM forecast WHERE id = $1`, [first.id]),
      ).rejects.toMatchObject({ code: '23001' });
      await expect(
        pool.query(
          `UPDATE input_snapshot SET request = '{}'::jsonb
          WHERE id = (SELECT input_snapshot_id FROM forecast WHERE id = $1)`,
          [first.id],
        ),
      ).rejects.toMatchObject({ code: '23001' });
    });

    it('refuses probabilities that do not total 1 even when written directly', async () => {
      await expect(
        pool.query(
          `INSERT INTO forecast (fixture_id, input_snapshot_id, model_version_id, version_number,
                               computed_at, status, p_home, p_draw, p_away, expected_home_goals,
                               expected_away_goals, most_likely, leading_factors, data_completeness)
         SELECT fixture_id, input_snapshot_id, model_version_id, 9999, now(), 'available',
                0.5, 0.3, 0.3, 1, 1, '[]', '[]', 'available'
           FROM forecast WHERE id = $1`,
          [first.id],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });

    describe.skipIf(MODEL_SERVICE_URL === undefined || MODEL_SERVICE_URL === '')(
      'with the live model service',
      () => {
        it('stores a real answer for the seeded fixture', async () => {
          const live = await Test.createTestingModule({ imports: [DatabaseModule, ForecastModule] })
            .overrideProvider(MODEL_CLIENT)
            .useValue(new ModelClient({ baseUrl: MODEL_SERVICE_URL ?? '' }))
            .overrideProvider(IDENTITY_OPTIONS)
            .useValue({
              ...DEFAULT_IDENTITY_OPTIONS,
              sessionSecret: 'test-secret-'.repeat(4),
              webBaseUrl: 'http://web.test',
              cookieSecure: false,
            })
            .compile();
          const liveApp = live.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
          await liveApp.init();
          await liveApp.getHttpAdapter().getInstance().ready();
          try {
            const response = await liveApp.inject({
              method: 'POST',
              url: `/fixtures/${FIXTURE}/forecasts`,
              payload: { kind: 'manual' },
              headers: { cookie: `fmip_session=${adminCookie}` },
            });
            expect(response.statusCode).toBe(201);
            const version = response.json() as ForecastVersion;
            createdIds.push(version.id);
            // Whatever the training store holds, the answer is stored honestly:
            // either real probabilities that total 1, or a reason.
            if (version.status === 'available') {
              const p = version.probabilities;
              expect(p).not.toBeNull();
              expect(Math.round(((p?.home ?? 0) + (p?.draw ?? 0) + (p?.away ?? 0)) * 10_000)).toBe(
                10_000,
              );
              expect(version.model_version).toMatch(/^[a-z0-9-]+@\d+\.\d+\.\d+$/);
            } else {
              expect(version.unavailable_reason).not.toBeNull();
            }
          } finally {
            await liveApp.close();
          }
        });
      },
    );
  },
);
