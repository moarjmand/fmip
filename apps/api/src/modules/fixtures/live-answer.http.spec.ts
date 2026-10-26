import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresMatchCentreStore } from './internal/match-centre-store';
import { PostgresScoresStore } from './internal/scores-store';

/**
 * T-1394 (D-209) against the real schema: a match whose stored clock stands
 * still is measured from the live list's last answer as well as its last
 * change, so half-time is `current` while the provider answers; in play an
 * unchanged row is still `stale`; a finished match carries no live answer.
 */
const DATABASE_URL = process.env.DATABASE_URL;

// Seeded Premier League 2024/25 and two clubs (packages/db/seed/001_catalog.sql).
const PL_2024 = '00000000-0000-4000-8000-000000000301';
const REAL_MADRID = '00000000-0000-4000-8000-000000000603';
const PERSEPOLIS = '00000000-0000-4000-8000-000000000604';

const HALF_TIME = randomUUID();
const IN_PLAY = randomUUID();
const FINISHED = randomUUID();
const FROZEN = randomUUID();
const FIXTURES = [HALF_TIME, IN_PLAY, FINISHED, FROZEN];
const RUN = randomUUID();
// The provider no other suite polls live: its newest live run is this spec's.
const PROVIDER = 'highlightly';

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  'live answer: half-time is not behind while the provider answers',
  () => {
    let pool: Pool;

    beforeAll(async () => {
      pool = new Pool({ connectionString: DATABASE_URL });
      // Ten minutes unchanged: the whistle went at 45, or the feed froze at 63.
      await pool.query(
        `INSERT INTO fixture (id, season_id, round, kickoff_at, status, minute, updated_at) VALUES
           ($1, $4, 'Live answer', now() - interval '55 minutes', 'live', 45, now() - interval '10 minutes'),
           ($2, $4, 'Live answer', now() - interval '75 minutes', 'live', 63, now() - interval '10 minutes'),
           ($3, $4, 'Live answer', now() - interval '3 hours', 'finished', NULL, now() - interval '1 hour'),
           ($5, $4, 'Live answer', now() - interval '5 hours', 'live', 90, now() - interval '3 hours')`,
        [HALF_TIME, IN_PLAY, FINISHED, PL_2024, FROZEN],
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
          [PROVIDER, `t1394-${id}`, id],
        );
      }
      // The live list answered 30 seconds ago, reading three matches.
      await pool.query(
        `INSERT INTO ingest_run (id, provider, job, status, started_at, finished_at, items_seen, items_written)
         VALUES ($1, $2, 'live', 'succeeded', now() - interval '40 seconds',
                 now() - interval '30 seconds', 3, 0)`,
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

    it('keeps the match centre at half-time current, and an unchanged match in play stale', async () => {
      const store = new PostgresMatchCentreStore(pool);
      const halfTime = (await store.header(HALF_TIME))?.header;
      expect(halfTime?.live_answered_at).not.toBeNull();
      expect(Date.now() - Date.parse(halfTime?.live_answered_at ?? '')).toBeLessThan(120_000);
      expect(halfTime?.freshness).toBe('current');

      const inPlay = (await store.header(IN_PLAY))?.header;
      expect(inPlay?.live_answered_at).not.toBeNull();
      expect(inPlay?.freshness).toBe('stale');

      const finished = (await store.header(FINISHED))?.header;
      expect(finished?.live_answered_at).toBeNull();
      expect(finished?.freshness).toBeNull();
    });

    it('says the same on the scores list, which the live strip reads', async () => {
      const today = new Date().toISOString().slice(0, 10);
      const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
      const rows = await new PostgresScoresStore(pool).list({
        from: yesterday,
        to: today,
        timezone: 'UTC',
        live: false,
        favourites: false,
        country_id: null,
        competition_id: null,
        stage_id: null,
        gender: null,
        age: null,
      });
      const card = (id: string) => rows.find((r) => r.card.id === id)?.card;
      expect(card(HALF_TIME)?.freshness).toBe('current');
      expect(card(HALF_TIME)?.live_answered_at).not.toBeNull();
      expect(card(IN_PLAY)?.freshness).toBe('stale');
      expect(card(FINISHED)?.live_answered_at).toBeNull();
    });

    it('does not count a run past the live window as an answer about a match left live (T-1577)', async () => {
      // Kicked off five hours ago and left at 90' by the feed: the live job
      // stopped asking about it at 210 minutes, so today's runs say nothing.
      const frozen = (await new PostgresMatchCentreStore(pool).header(FROZEN))?.header;
      expect(frozen?.live_answered_at).toBeNull();
      expect(frozen?.freshness).toBe('stale');
    });

    it('ages half-time again once the provider stops answering', async () => {
      await pool.query(
        `UPDATE ingest_run SET started_at = now() - interval '6 minutes',
                               finished_at = now() - interval '5 minutes'
          WHERE id = $1`,
        [RUN],
      );
      const halfTime = (await new PostgresMatchCentreStore(pool).header(HALF_TIME))?.header;
      expect(halfTime?.freshness).toBe('stale');
    });
  },
);
