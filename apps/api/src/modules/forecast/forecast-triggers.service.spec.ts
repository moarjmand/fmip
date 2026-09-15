import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { ForecastTriggersService } from './forecast-triggers.service';
import { MODEL_CLIENT, ForecastService } from './forecast.service';
import { PostgresForecastStore } from './internal/forecast-store';
import { ModelClient } from './internal/model-client';
import { PowerIndexService } from './power-index.service';
import { withTriggersOff } from '../../testing/cleanup';

// The triggers against the real schema (T-120). The acceptance criterion is
// "each kind is produced once per fixture and named", so the test runs the
// triggers repeatedly and counts rows: the second run of an unchanged fixture
// must write nothing, and a line-up arriving must produce exactly one more.
//
// The model is deliberately unreachable here. An unavailable forecast is still
// a version — that is T-064's whole point — and it makes the test a statement
// about the triggers rather than about the model service being up.
const DATABASE_URL = process.env.DATABASE_URL;

const COUNTRY = '00000000-0000-4000-8000-000000000101';
const COMPETITION = randomUUID();
const SEASON = randomUUID();
const FIXTURE = randomUUID();
const HOME = randomUUID();
const AWAY = randomUUID();
const PLAYER = randomUUID();

const NOW = new Date('2026-01-05T12:00:00Z');
const KICKOFF = new Date('2026-01-07T15:00:00Z');

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  'producing forecast versions when they are due',
  () => {
    let pool: Pool;
    let triggers: ForecastTriggersService;
    let close: () => Promise<void>;

    beforeAll(async () => {
      pool = new Pool({ connectionString: DATABASE_URL });

      await pool.query(
        `INSERT INTO competition (id, country_id, name, kind, scope, gender)
         VALUES ($1, $2, 'Trigger Test League', 'league', 'domestic', 'men')`,
        [COMPETITION, COUNTRY],
      );
      await pool.query(
        `INSERT INTO season (id, competition_id, label, start_date, end_date, is_current)
         VALUES ($1, $2, '2025/26', '2025-08-01', '2026-05-30', false)`,
        [SEASON, COMPETITION],
      );
      await pool.query(
        `INSERT INTO team (id, name, kind, gender) VALUES ($1, 'Iota', 'club', 'men'), ($2, 'Kappa', 'club', 'men')`,
        [HOME, AWAY],
      );
      await pool.query(`INSERT INTO person (id, full_name) VALUES ($1, 'A Player')`, [PLAYER]);
      await pool.query(
        `INSERT INTO fixture (id, season_id, kickoff_at, status) VALUES ($1, $2, $3, 'scheduled')`,
        [FIXTURE, SEASON, KICKOFF],
      );
      await pool.query(
        `INSERT INTO fixture_participant (fixture_id, team_id, side)
         VALUES ($1, $2, 'home'), ($1, $3, 'away')`,
        [FIXTURE, HOME, AWAY],
      );

      const unreachable = new ModelClient({
        baseUrl: 'http://model.not-configured.invalid',
        fetchImpl: () => Promise.reject(new Error('no model service in this test')),
      });
      const moduleRef = await Test.createTestingModule({
        imports: [DatabaseModule],
        providers: [
          ForecastTriggersService,
          ForecastService,
          PostgresForecastStore,
          PowerIndexService,
          { provide: MODEL_CLIENT, useValue: unreachable },
        ],
      }).compile();
      await moduleRef.init();
      triggers = moduleRef.get(ForecastTriggersService);
      close = () => moduleRef.close();
    });

    afterAll(async () => {
      if (pool === undefined) return;
      // All three tables are immutable, so all three deletes go in one block:
      // the setting is the session's, not the table's, so there is nothing to
      // turn off per table.
      await withTriggersOff(pool, async (client) => {
        await client.query(
          `DELETE FROM power_index WHERE participant_id IN
             (SELECT id FROM fixture_participant WHERE fixture_id = $1)`,
          [FIXTURE],
        );
        await client.query(`DELETE FROM forecast WHERE fixture_id = $1`, [FIXTURE]);
        await client.query(`DELETE FROM input_snapshot WHERE fixture_id = $1`, [FIXTURE]);
      });
      await pool.query(`DELETE FROM fixture WHERE id = $1`, [FIXTURE]);
      await pool.query(`DELETE FROM season WHERE id = $1`, [SEASON]);
      await pool.query(`DELETE FROM competition WHERE id = $1`, [COMPETITION]);
      await pool.query(`DELETE FROM person WHERE id = $1`, [PLAYER]);
      await pool.query(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [[HOME, AWAY]]);
      await pool.end();
      await close?.();
    });

    async function kinds(): Promise<string[]> {
      const { rows } = await pool.query<{ kind: string }>(
        `SELECT s.kind FROM forecast f
           JOIN input_snapshot s ON s.id = f.input_snapshot_id
          WHERE f.fixture_id = $1
          ORDER BY f.version_number`,
        [FIXTURE],
      );
      return rows.map((row) => row.kind);
    }

    it('produces the early version once, and nothing on a second pass', async () => {
      const first = await triggers.runDue(NOW);
      expect(first.considered).toBeGreaterThan(0);
      expect(first.computed.early).toBe(1);
      expect(await kinds()).toEqual(['early']);

      const second = await triggers.runDue(NOW);
      expect(second.computed.early ?? 0).toBe(0);
      expect(await kinds()).toEqual(['early']);
      // And it says why it did nothing, rather than being silently idle.
      expect(Object.keys(second.skipped).join(' ')).toContain('early version is recorded');
    });

    it('produces the confirmed version when a line-up arrives, and only then', async () => {
      await pool.query(
        `INSERT INTO lineup (participant_id, person_id, role, shirt_number)
         VALUES ((SELECT id FROM fixture_participant WHERE fixture_id = $1 AND side = 'home'),
                 $2, 'starter', 9)`,
        [FIXTURE, PLAYER],
      );

      const third = await triggers.runDue(NOW);
      expect(third.computed.lineups_confirmed).toBe(1);
      expect(await kinds()).toEqual(['early', 'lineups_confirmed']);

      const fourth = await triggers.runDue(NOW);
      expect(fourth.computed.lineups_confirmed ?? 0).toBe(0);
      expect(await kinds()).toEqual(['early', 'lineups_confirmed']);
    });

    it('stops once kick-off has passed, rather than adding a version to a live match', async () => {
      const afterKickoff = new Date(KICKOFF.getTime() + 60 * 1000);
      const report = await triggers.runDue(afterKickoff);
      expect(Object.values(report.computed).reduce((sum, n) => sum + n, 0)).toBe(0);
      expect(await kinds()).toEqual(['early', 'lineups_confirmed']);
    });
  },
);
