import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresForecastStore } from './internal/forecast-store';

/**
 * Which fixtures the forecast treats as clubs of different leagues (T-503),
 * against the real schema: a continental cup's are; a national-team
 * competition's are not (T-1332), since the model holds no history for
 * national teams at all and the published reason must say that instead.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const HOME = '00000000-0000-4000-8000-000000000602';
const AWAY = '00000000-0000-4000-8000-000000000601';

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  'the forecast’s reading of a competition',
  () => {
    let pool: Pool;
    let store: PostgresForecastStore;
    const competitions = { continental: randomUUID(), international: randomUUID() };
    const seasons = { continental: randomUUID(), international: randomUUID() };
    const fixtures = { continental: randomUUID(), international: randomUUID() };

    beforeAll(async () => {
      pool = new Pool({ connectionString: DATABASE_URL });
      store = new PostgresForecastStore(pool);
      for (const scope of ['continental', 'international'] as const) {
        await pool.query(
          `INSERT INTO competition (id, name, kind, scope, gender, age_group, is_active)
           VALUES ($1, $2, 'cup', $3, 'men', 'senior', true)`,
          [competitions[scope], `T-1332 ${scope} cup`, scope],
        );
        await pool.query(
          `INSERT INTO season (id, competition_id, label, start_date, end_date, is_current)
           VALUES ($1, $2, '2099', '2099-01-01', '2099-12-31', false)`,
          [seasons[scope], competitions[scope]],
        );
        await pool.query(
          `INSERT INTO fixture (id, season_id, round, kickoff_at, status)
           VALUES ($1, $2, 'Group Stage - 1', TIMESTAMPTZ '2099-02-01 15:00:00+00', 'scheduled')`,
          [fixtures[scope], seasons[scope]],
        );
        await pool.query(
          `INSERT INTO fixture_participant (fixture_id, team_id, side)
           VALUES ($1, $2, 'home'), ($1, $3, 'away')`,
          [fixtures[scope], HOME, AWAY],
        );
      }
    });

    afterAll(async () => {
      const ids = Object.values(fixtures);
      await pool.query(`DELETE FROM fixture_participant WHERE fixture_id = ANY($1::uuid[])`, [ids]);
      await pool.query(`DELETE FROM fixture WHERE id = ANY($1::uuid[])`, [ids]);
      await pool.query(`DELETE FROM season WHERE id = ANY($1::uuid[])`, [Object.values(seasons)]);
      await pool.query(`DELETE FROM competition WHERE id = ANY($1::uuid[])`, [
        Object.values(competitions),
      ]);
      await pool.end();
    });

    it('reads a continental cup as clubs of different leagues', async () => {
      const fixture = await store.fixtureForModel(fixtures.continental);
      expect(fixture).toMatchObject({ division: null, mixesLeagues: true });
    });

    it('reads a national-team competition as one the model has no history for', async () => {
      const fixture = await store.fixtureForModel(fixtures.international);
      expect(fixture).toMatchObject({ division: null, mixesLeagues: false });
    });
  },
);
