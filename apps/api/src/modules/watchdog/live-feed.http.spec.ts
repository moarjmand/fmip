import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { liveFeed } from './internal/conditions';
import { WatchdogStore } from './internal/watchdog-store';

/**
 * T-1486 (D-258) against the real schema: the watchdog reads each match in
 * progress with its clock, its last change and the live list's last answer,
 * so a match held at 45 through the interval is not a stalled feed while the
 * provider answers, and a match in play unchanged as long still is.
 */
const DATABASE_URL = process.env.DATABASE_URL;

// Seeded Premier League 2024/25 and two clubs (packages/db/seed/001_catalog.sql).
const PL_2024 = '00000000-0000-4000-8000-000000000301';
const REAL_MADRID = '00000000-0000-4000-8000-000000000603';
const PERSEPOLIS = '00000000-0000-4000-8000-000000000604';

const HALF_TIME = randomUUID();
const IN_PLAY = randomUUID();
const FIXTURES: string[] = [HALF_TIME, IN_PLAY];
const RUN = randomUUID();
// As live-answer.http.spec.ts: a provider no other suite polls live. Its
// newest live run is this spec's or that one's, both within the minute.
const PROVIDER = 'highlightly';

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  'watchdog live feed: half-time counts the provider answer, play does not',
  () => {
    let pool: Pool;

    beforeAll(async () => {
      pool = new Pool({ connectionString: DATABASE_URL });
      // Twenty-five minutes unchanged: the minute reached 45, or the feed froze at 63.
      await pool.query(
        `INSERT INTO fixture (id, season_id, round, kickoff_at, status, minute, updated_at) VALUES
           ($1, $3, 'Live feed', now() - interval '70 minutes', 'live', 45, now() - interval '25 minutes'),
           ($2, $3, 'Live feed', now() - interval '90 minutes', 'live', 63, now() - interval '25 minutes')`,
        [HALF_TIME, IN_PLAY, PL_2024],
      );
      for (const id of FIXTURES) {
        await pool.query(
          `INSERT INTO fixture_participant (fixture_id, team_id, side, updated_at) VALUES
             ($1, $2, 'home', now() - interval '1 hour'), ($1, $3, 'away', now() - interval '1 hour')`,
          [id, REAL_MADRID, PERSEPOLIS],
        );
        await pool.query(
          `INSERT INTO provider_mapping (provider, entity_type, external_id, internal_id)
           VALUES ($1, 'fixture', $2, $3)`,
          [PROVIDER, `t1486-${id}`, id],
        );
      }
      await pool.query(
        `INSERT INTO ingest_run (id, provider, job, status, started_at, finished_at, items_seen, items_written)
         VALUES ($1, $2, 'live', 'succeeded', now() - interval '40 seconds',
                 now() - interval '30 seconds', 2, 0)`,
        [RUN, PROVIDER],
      );
    });

    afterAll(async () => {
      await pool.query(`DELETE FROM ingest_run WHERE id = $1`, [RUN]);
      await pool.query(
        `DELETE FROM provider_mapping WHERE entity_type = 'fixture' AND internal_id = ANY($1::uuid[])`,
        [FIXTURES],
      );
      await pool.query(`DELETE FROM fixture WHERE id = ANY($1::uuid[])`, [FIXTURES]);
      await pool.end();
    });

    it('reads each match with its clock and answer, and judges them apart', async () => {
      const all = await new WatchdogStore(pool).liveFixtures();
      // Other suites' live matches may be in the table too: judge only these.
      const mine = all.filter((m) => FIXTURES.includes(m.fixtureId));
      const now = new Date();
      const halfTime = mine.find((m) => m.fixtureId === HALF_TIME);
      const inPlay = mine.find((m) => m.fixtureId === IN_PLAY);
      expect(halfTime).toMatchObject({ status: 'live', minute: 45 });
      expect(now.getTime() - (halfTime?.liveAnsweredAt?.getTime() ?? 0)).toBeLessThan(120_000);
      expect(now.getTime() - (inPlay?.changedAt.getTime() ?? now.getTime())).toBeGreaterThan(
        24 * 60_000,
      );

      expect(
        liveFeed(
          mine.filter((m) => m.fixtureId === HALF_TIME),
          now,
        ).level,
      ).toBe('ok');
      expect(liveFeed(mine, now)).toMatchObject({
        level: 'degraded',
        note: "2 in progress, 1 behind for 20 minutes or more (1 at half-time or another break, counted from the provider's last answer)",
      });
    });
  },
);
