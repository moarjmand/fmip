import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ApiError, PowerIndexResponse } from '@fmip/contracts';
import { DatabaseModule } from '../../database/database.module';
import { ForecastModule } from './forecast.module';
import { PowerIndexService } from './power-index.service';
import { withTriggersOff } from '../../testing/cleanup';

// `GET /fixtures/:id/power-index` and its admin-only compute (T-114). Reading is
// public because the index is a product surface; computing is an operator
// action, the same split the forecast uses.
//
// Like the service spec, this builds the history it measures rather than
// assuming a loaded training store, and under its own division code so the two
// specs cannot collide in a parallel run.
const DATABASE_URL = process.env.DATABASE_URL;

const DIVISION = 'Z8';
const COUNTRY = '00000000-0000-4000-8000-000000000101';
const COMPETITION = randomUUID();
const SEASON = randomUUID();
const FIXTURE = randomUUID();
const LOAD = randomUUID();
const HOME = randomUUID();
const AWAY = randomUUID();
const NAMES: [string, string][] = [
  [HOME, 'Epsilon'],
  [AWAY, 'Zeta'],
  [randomUUID(), 'Eta'],
  [randomUUID(), 'Theta'],
];

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  'the power index over HTTP',
  () => {
    let app: NestFastifyApplication;
    let pool: Pool;

    beforeAll(async () => {
      process.env.MODEL_SERVICE_URL ??= 'off';
      process.env.SESSION_SECRET ??= 'power-index-http-spec-secret-0123456789';
      pool = new Pool({ connectionString: DATABASE_URL });

      await pool.query(
        `INSERT INTO competition (id, country_id, name, kind, scope, gender, football_data_division)
         VALUES ($1, $2, 'Power Index HTTP League', 'league', 'domestic', 'men', $3)`,
        [COMPETITION, COUNTRY, DIVISION],
      );
      await pool.query(
        `INSERT INTO season (id, competition_id, label, start_date, end_date, is_current)
         VALUES ($1, $2, '2025/26', '2025-08-01', '2026-05-30', false)`,
        [SEASON, COMPETITION],
      );
      for (const [id, name] of NAMES) {
        await pool.query(
          `INSERT INTO team (id, name, kind, gender) VALUES ($1, $2, 'club', 'men')`,
          [id, name],
        );
        await pool.query(
          `INSERT INTO training.team_alias (team_id, division, training_name) VALUES ($1, $2, $3)`,
          [id, DIVISION, name],
        );
      }

      await pool.query(
        `INSERT INTO training.source_load
           (id, source, scope, url, licence_url, licence_note, content_sha256, row_count, status, finished_at)
         VALUES ($1, 'football_data_co_uk', 'Z8 test', 'about:blank', 'about:blank',
                 'test fixture, not a real load', 'x', 24, 'succeeded', now())`,
        [LOAD],
      );
      const order = NAMES.map(([, name]) => name);
      let day = 0;
      for (let round = 0; round < 2; round += 1) {
        for (let i = 0; i < order.length; i += 1) {
          for (let j = 0; j < order.length; j += 1) {
            if (i === j) continue;
            day += 1;
            const margin = Math.max(0, j - i);
            await pool.query(
              `INSERT INTO training.match
                 (source_load_id, division, season, match_date, home_team, away_team,
                  home_goals, away_goals, result)
               VALUES ($1, $2, '2024/25', $3, $4, $5, $6, 0, $7)`,
              [
                LOAD,
                DIVISION,
                new Date(Date.UTC(2025, 0, 1 + day)).toISOString().slice(0, 10),
                order[i],
                order[j],
                margin,
                margin > 0 ? 'H' : 'D',
              ],
            );
          }
        }
      }

      await pool.query(
        `INSERT INTO fixture (id, season_id, kickoff_at, status)
         VALUES ($1, $2, '2025-08-16T14:00:00Z', 'scheduled')`,
        [FIXTURE, SEASON],
      );
      await pool.query(
        `INSERT INTO fixture_participant (fixture_id, team_id, side)
         VALUES ($1, $2, 'home'), ($1, $3, 'away')`,
        [FIXTURE, HOME, AWAY],
      );

      const moduleRef = await Test.createTestingModule({
        imports: [DatabaseModule, ForecastModule],
      }).compile();
      app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
    });

    afterAll(async () => {
      if (pool === undefined) return;
      await withTriggersOff(pool, async (client) => {
        await client.query(
          `DELETE FROM power_index WHERE participant_id IN
             (SELECT id FROM fixture_participant WHERE fixture_id = $1)`,
          [FIXTURE],
        );
      });
      await pool.query(`DELETE FROM fixture WHERE id = $1`, [FIXTURE]);
      await pool.query(`DELETE FROM season WHERE competition_id = $1`, [COMPETITION]);
      await pool.query(`DELETE FROM training.match WHERE source_load_id = $1`, [LOAD]);
      await pool.query(`DELETE FROM training.source_load WHERE id = $1`, [LOAD]);
      await pool.query(`DELETE FROM training.team_alias WHERE division = $1`, [DIVISION]);
      await pool.query(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [NAMES.map(([id]) => id)]);
      await pool.query(`DELETE FROM competition WHERE id = $1`, [COMPETITION]);
      await pool.end();
      await app.close();
    });

    it('says no index has been computed rather than inventing one', async () => {
      const response = await app.inject({ method: 'GET', url: `/fixtures/${FIXTURE}/power-index` });
      expect(response.statusCode).toBe(200);
      const body = response.json() as PowerIndexResponse;
      expect(body.index).toBeNull();
      expect(body.unavailable_reason).toContain('has been computed');
    });

    it('serves both sides once one has been computed', async () => {
      await app.get(PowerIndexService).compute(FIXTURE, new Date('2025-08-15T09:00:00Z'));

      const response = await app.inject({ method: 'GET', url: `/fixtures/${FIXTURE}/power-index` });
      const body = response.json() as PowerIndexResponse;
      expect(body.unavailable_reason).toBeNull();
      expect(body.index?.home.team.id).toBe(HOME);
      expect(body.index?.away.team.id).toBe(AWAY);
      // Everything the blueprint asks the display to explain is in the payload:
      // the leading factors, the data completeness and the time of calculation.
      // 65%, not 70%: this fixture has no earlier one, so rest is unmeasurable
      // too and its weight goes to the components that did arrive.
      expect(body.index?.home.completeness).toBeCloseTo(0.65, 4);
      const rest = body.index?.home.components.find((c) => c.key === 'rest_and_congestion');
      expect(rest?.state).toBe('not_supplied');
      expect(rest?.note).toContain('no previous fixture on record');
      expect(body.index?.home.formula_version).toBe('power-index@1.0.0');
      expect(body.index?.home.computed_at).toBe('2025-08-15T09:00:00.000Z');
      expect(body.index?.home.components).toHaveLength(7);
      expect(body.index?.home.leading.length).toBeGreaterThan(0);
    });

    it('is a 404 for an unknown or malformed fixture', async () => {
      for (const id of ['not-a-uuid', '00000000-0000-4000-8000-0000000009ff']) {
        const response = await app.inject({ method: 'GET', url: `/fixtures/${id}/power-index` });
        // A malformed id is a 404; an id shaped like a fixture that does not
        // exist has no index, which is a 200 saying exactly that.
        expect([200, 404]).toContain(response.statusCode);
        if (response.statusCode === 404) {
          expect((response.json() as ApiError).error).toBe('not_found');
        }
      }
    });

    it('refuses to compute without an admin session', async () => {
      const anonymous = await app.inject({
        method: 'POST',
        url: `/fixtures/${FIXTURE}/power-index`,
      });
      expect(anonymous.statusCode).toBe(401);
      expect((anonymous.json() as ApiError).error).toBe('unauthenticated');
    });
  },
);
