import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CoverageService } from '../coverage.service';

/**
 * T-1824 (D-418) against the real schema: a season whose line-ups reach us
 * after kick-off as a rule (the Persian Gulf Pro League's, 56 to 105 hours
 * after, on 2026-11-13) is `delayed` for line-ups, never `available`; a
 * season whose line-ups arrive before kick-off stays `available`; a match
 * loaded after it was played is not measured.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  'line-up coverage measured by arrival',
  () => {
    let pool: Pool;
    let coverage: CoverageService;
    const LEAGUE = randomUUID();
    const LATE = randomUUID();
    const ON_TIME = randomUUID();
    const BACKFILLED = randomUUID();
    const SMALL = randomUUID();
    const HOME = randomUUID();
    const AWAY = randomUUID();
    const PLAYER = randomUUID();
    const externalIds: string[] = [];

    /**
     * A finished match in `season`, known `knownHours` before kick-off (a
     * negative number: loaded after it), its home line-up first stored
     * `lineupHours` after kick-off (negative: before).
     */
    async function match(
      season: string,
      day: number,
      knownHours: number,
      lineupHours: number,
    ): Promise<void> {
      const id = randomUUID();
      const kickoff = new Date(Date.UTC(2088, 1, day, 15));
      const at = (hours: number) => new Date(kickoff.getTime() + hours * 3_600_000);
      await pool.query(
        `INSERT INTO fixture (id, season_id, kickoff_at, status, created_at)
         VALUES ($1, $2, $3, 'finished', $4)`,
        [id, season, kickoff, at(-knownHours)],
      );
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO fixture_participant (fixture_id, team_id, side)
         VALUES ($1, $2, 'home'), ($1, $3, 'away') RETURNING id`,
        [id, HOME, AWAY],
      );
      await pool.query(
        `INSERT INTO lineup (participant_id, person_id, role, created_at)
         VALUES ($1, $2, 'starter', $3)`,
        [rows[0]?.id, PLAYER, at(lineupHours)],
      );
      const externalId = `t1824-${id.slice(0, 12)}`;
      externalIds.push(externalId);
      await pool.query(
        `INSERT INTO provider_mapping (provider, entity_type, external_id, internal_id)
         VALUES ('api_football', 'fixture', $1, $2)`,
        [externalId, id],
      );
    }

    const lineups = async (season: string) => (await coverage.recompute(season)).states.lineups;

    beforeAll(async () => {
      pool = new Pool({ connectionString: DATABASE_URL });
      coverage = new CoverageService(pool);
      await pool.query(
        `INSERT INTO competition (id, name, kind, scope, gender)
         VALUES ($1, $2, 'league', 'international', 'men')`,
        [LEAGUE, `Arrival League ${RUN}`],
      );
      for (const [season, label] of [
        [LATE, '2088'],
        [ON_TIME, '2089'],
        [BACKFILLED, '2090'],
        [SMALL, '2091'],
      ] as const) {
        await pool.query(
          `INSERT INTO season (id, competition_id, label, start_date, end_date, is_current)
           VALUES ($1, $2, $3, DATE '2088-01-01', DATE '2088-12-31', false)`,
          [season, LEAGUE, label],
        );
      }
      await pool.query(
        `INSERT INTO team (id, name, kind, gender) VALUES ($1, $3, 'club', 'men'), ($2, $4, 'club', 'men')`,
        [HOME, AWAY, `Arrival home ${RUN}`, `Arrival away ${RUN}`],
      );
      await pool.query(`INSERT INTO person (id, full_name) VALUES ($1, $2)`, [
        PLAYER,
        `Arrival player ${RUN}`,
      ]);
      // Twelve matches each, above the ten-match floor.
      for (let day = 1; day <= 12; day += 1) {
        // Line-ups 56 to 105 hours after kick-off in ten of twelve.
        await match(LATE, day, 48, day <= 10 ? 56 + day * 4 : -0.4);
        // Twenty-five minutes before kick-off in ten of twelve, two after.
        await match(ON_TIME, day, 48, day <= 10 ? -0.4 : 0.5);
        // A season loaded after its matches: every line-up stored "late".
        await match(BACKFILLED, day, -200, 300);
      }
      // Three late matches only: below the floor, the counts decide.
      for (const day of [1, 2, 3]) await match(SMALL, day, 48, 60);
    });

    afterAll(async () => {
      if (pool === undefined) return;
      await pool.query(
        `DELETE FROM provider_mapping WHERE provider = 'api_football' AND external_id = ANY($1)`,
        [externalIds],
      );
      await pool.query(`DELETE FROM fixture WHERE season_id = ANY($1::uuid[])`, [
        [LATE, ON_TIME, BACKFILLED, SMALL],
      ]);
      await pool.query(`DELETE FROM season WHERE competition_id = $1`, [LEAGUE]);
      await pool.query(`DELETE FROM competition WHERE id = $1`, [LEAGUE]);
      await pool.query(`DELETE FROM person WHERE id = $1`, [PLAYER]);
      await pool.query(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [[HOME, AWAY]]);
      await pool.end();
    });

    it('says delayed, with its counts, where line-ups come after kick-off as a rule', async () => {
      expect(await lineups(LATE)).toBe('delayed');
      const { rows } = await pool.query<{ note: string }>(
        `SELECT note FROM coverage_profile WHERE season_id = $1 AND module = 'lineups'`,
        [LATE],
      );
      expect(rows[0]?.note).toBe(
        '12 of 12 fixtures have lineups; 10 of the last 12 had them only after kick-off.',
      );
    });

    it('stays available where they come before kick-off', async () => {
      expect(await lineups(ON_TIME)).toBe('available');
    });

    it('does not measure a season loaded after its matches were played', async () => {
      expect(await lineups(BACKFILLED)).toBe('available');
    });

    it('does not call a season delayed on fewer than ten measured matches', async () => {
      expect(await lineups(SMALL)).toBe('available');
    });
  },
);
