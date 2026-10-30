import { randomUUID } from 'node:crypto';
import type { NormalisedAbsence } from '@fmip/ingestion';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FIRST_SEASON_START } from './absence-history';
import { AbsenceHistoryStore } from './absence-history-store';

/**
 * The absence history's SQL on a database (T-1650, D-306): which past seasons
 * are asked, the upsert that finds the match, the club and the player through
 * `provider_mapping` only, the player kept by the provider's id until he is
 * mapped, and the audit row.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const PROVIDER = 'api_football' as const;
const ENGLAND = '00000000-0000-4000-8000-000000000101';

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  'the absence history store',
  () => {
    let pool: Pool;
    let store: AbsenceHistoryStore;
    const id = {
      league: randomUUID(),
      old: randomUUID(),
      past: randomUUID(),
      current: randomUUID(),
      home: randomUUID(),
      away: randomUUID(),
      mapped: randomUUID(),
      later: randomUUID(),
      fixture: randomUUID(),
      admin: '',
    };
    const ext = (n: string) => `t1650-${RUN}-${n}`;
    const absence = (over: {
      fixture?: string;
      team?: string;
      player?: string;
      status?: 'out' | 'doubtful';
      reason?: string | null;
    }): NormalisedAbsence => ({
      fixtureExternalId: over.fixture ?? ext('fixture'),
      team: { externalId: over.team ?? ext('home'), name: 'Provider Club' },
      player: { externalId: over.player ?? ext('mapped'), name: 'Provider Name' },
      status: over.status ?? 'out',
      kind: over.reason === null ? null : 'injury',
      reason: over.reason === undefined ? 'Knee Injury' : over.reason,
    });
    const rows = async () =>
      (
        await pool.query<{
          provider_person_id: string;
          person_id: string | null;
          team_id: string;
          season_id: string;
          status: string;
          kind: string | null;
          reason: string | null;
        }>(
          `SELECT provider_person_id, person_id, team_id, season_id, status, kind, reason
           FROM absence_history WHERE fixture_id = $1 ORDER BY provider_person_id`,
          [id.fixture],
        )
      ).rows;

    beforeAll(async () => {
      pool = new Pool({ connectionString: DATABASE_URL });
      store = new AbsenceHistoryStore(pool);
      await pool.query(
        `INSERT INTO competition (id, name, kind, scope, gender, model_training)
       VALUES ($1, 'T-1650 League', 'league', 'international', 'men', false)`,
        [id.league],
      );
      await pool.query(
        `INSERT INTO season (id, competition_id, label, start_date, end_date, is_current) VALUES
         ($1, $4, '2019/20', '2019-08-01', '2020-05-31', false),
         ($2, $4, '2023/24', '2023-08-01', '2024-05-31', false),
         ($3, $4, '2026/27', '2026-08-01', '2027-05-31', true)`,
        [id.old, id.past, id.current, id.league],
      );
      await pool.query(
        `INSERT INTO team (id, name, kind, gender) VALUES
         ($1, 'T-1650 Home', 'club', 'men'), ($2, 'T-1650 Away', 'club', 'men')`,
        [id.home, id.away],
      );
      await pool.query(
        `INSERT INTO person (id, full_name) VALUES ($1, 'T-1650 Mapped'), ($2, 'T-1650 Later')`,
        [id.mapped, id.later],
      );
      await pool.query(
        `INSERT INTO fixture (id, season_id, kickoff_at, status)
       VALUES ($1, $2, '2023-09-02T14:00:00Z', 'finished')`,
        [id.fixture, id.past],
      );
      const mappings: [string, string, string][] = [
        ['competition', ext('league'), id.league],
        ['team', ext('home'), id.home],
        ['team', ext('away'), id.away],
        ['person', ext('mapped'), id.mapped],
        ['fixture', ext('fixture'), id.fixture],
      ];
      for (const [type, external, internal] of mappings) {
        await pool.query(
          `INSERT INTO provider_mapping (provider, entity_type, external_id, internal_id)
         VALUES ('api_football', $1, $2, $3)`,
          [type, external, internal],
        );
      }
      const { rows: users } = await pool.query<{ id: string }>(
        `INSERT INTO user_account
         (username, display_name, email, country_id, preferred_language, timezone,
          accepted_rules_at, email_verified_at)
       VALUES ($1, 'T-1650 Admin', $2, $3, 'en', 'Europe/London', now(), now())
       RETURNING id`,
        [`ah${RUN}`.slice(0, 20), `ah${RUN}@example.test`, ENGLAND],
      );
      id.admin = users[0]?.id ?? '';
    });

    afterAll(async () => {
      if (pool === undefined) return;
      await pool.query(`DELETE FROM fixture WHERE id = $1`, [id.fixture]);
      await pool.query(`DELETE FROM provider_mapping WHERE external_id LIKE $1`, [
        `t1650-${RUN}-%`,
      ]);
      await pool.query(`DELETE FROM person WHERE id = ANY($1::uuid[])`, [[id.mapped, id.later]]);
      await pool.query(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [[id.home, id.away]]);
      await pool.query(`DELETE FROM season WHERE competition_id = $1`, [id.league]);
      await pool.query(`DELETE FROM competition WHERE id = $1`, [id.league]);
      if (id.admin !== '') {
        // The audit log refuses deletes (rule 10); a test's own row is removed past the trigger.
        const client = await pool.connect();
        try {
          await client.query(`SET session_replication_role = 'replica'`);
          await client.query(`DELETE FROM audit_log WHERE actor_id = $1`, [id.admin]);
        } finally {
          await client.query(`SET session_replication_role = 'origin'`);
          client.release();
        }
        await pool.query(`DELETE FROM user_account WHERE id = $1`, [id.admin]);
      }
      await pool.end();
    });

    it('asks the past seasons from 2021 on, a competition kept out of training included', async () => {
      const all = await store.seasons(
        PROVIDER,
        { seasonLabel: null, competitionExternalId: ext('league') },
        FIRST_SEASON_START,
      );
      expect(all.map((s) => [s.seasonLabel, s.absencesCovered])).toEqual([['2023/24', null]]);
      expect(all[0]).toMatchObject({ competitionId: id.league, seasonId: id.past });

      await pool.query(
        `INSERT INTO season_feed_coverage (season_id, provider, absences, answered_at)
       VALUES ($1, 'api_football', false, now())`,
        [id.past],
      );
      const narrowed = await store.seasons(
        PROVIDER,
        { seasonLabel: '2023/24', competitionExternalId: ext('league') },
        FIRST_SEASON_START,
      );
      expect(narrowed.map((s) => s.absencesCovered)).toEqual([false]);
      expect(
        await store.seasons(
          PROVIDER,
          { seasonLabel: '2026/27', competitionExternalId: ext('league') },
          FIRST_SEASON_START,
        ),
      ).toEqual([]);
    });

    it('writes what it can place, keeps an unmapped player by his provider id, and counts the rest', async () => {
      const answer = [
        absence({}),
        absence({ team: ext('away'), player: ext('later'), status: 'doubtful', reason: null }),
        absence({ player: ext('later') }), // the same player and match again: one row
        absence({ fixture: ext('not-held') }),
        absence({ team: ext('not-held'), player: ext('third') }),
      ];
      expect(await store.write(PROVIDER, answer, '2026-10-29T21:00:00.000Z')).toEqual({
        written: 2,
        skipped: 2,
        fixturesUnmapped: 1,
        personsUnmapped: 1,
      });
      const written = await rows();
      expect(written).toHaveLength(2);
      expect(written.find((r) => r.provider_person_id === ext('mapped'))).toMatchObject({
        person_id: id.mapped,
        team_id: id.home,
        season_id: id.past,
        status: 'out',
        kind: 'injury',
        reason: 'Knee Injury',
      });
      expect(written.find((r) => r.provider_person_id === ext('later'))?.person_id).toBeNull();
    });

    it('rewrites the same rows on a second run, and gives a player mapped since his id', async () => {
      await store.write(
        PROVIDER,
        [absence({ status: 'doubtful', reason: 'Suspended' })],
        '2026-10-30T01:00:00.000Z',
      );
      expect((await rows()).find((r) => r.person_id === id.mapped)).toMatchObject({
        status: 'doubtful',
        reason: 'Suspended',
      });
      await pool.query(
        `INSERT INTO provider_mapping (provider, entity_type, external_id, internal_id)
       VALUES ('api_football', 'person', $1, $2)`,
        [ext('later'), id.later],
      );
      expect(await store.relink(PROVIDER)).toBeGreaterThanOrEqual(1);
      const after = await rows();
      expect(after).toHaveLength(2);
      expect(after.find((r) => r.provider_person_id === ext('later'))?.person_id).toBe(id.later);
    });

    it('records who ran it and why, with the narrowing as the next value', async () => {
      await store.audit(id.admin, 'model factors', {
        seasonLabel: '2023/24',
        competitionExternalId: null,
      });
      const { rows: audits } = await pool.query<{ action: string; reason: string; next: unknown }>(
        `SELECT action, reason, next FROM audit_log WHERE actor_id = $1`,
        [id.admin],
      );
      expect(audits).toEqual([
        {
          action: 'ingestion.absence_history',
          reason: 'model factors',
          next: { season: '2023/24' },
        },
      ]);
    });

    it('records its run as a job of its own', async () => {
      const { rows: runs } = await pool.query<{ id: string }>(
        `INSERT INTO ingest_run (provider, job, scope, status, finished_at)
       VALUES ('api_football', 'absence_history', $1, 'succeeded', now())
       RETURNING id`,
        [`t1650-${RUN}`],
      );
      await pool.query(`DELETE FROM ingest_run WHERE id = $1`, [runs[0]?.id]);
      expect(runs).toHaveLength(1);
    });
  },
);
