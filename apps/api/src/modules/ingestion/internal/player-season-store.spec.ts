import { randomUUID } from 'node:crypto';
import type { NormalisedPlayerSeasonLine } from '@fmip/ingestion';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PlayerSeasonStore } from './player-season-store';

/**
 * The `player_seasons` job's SQL on a database (T-1431, D-223): who is owed a
 * season or a career ask, the replacing writes that keep only competitions and
 * teams we know, and the ask records that pace the retries.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const PROVIDER = 'api_football' as const;
const LATER = '2999-01-01T00:00:00Z';
const EARLIER = '2000-01-01T00:00:00Z';

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  'the player seasons store',
  () => {
    let pool: Pool;
    let store: PlayerSeasonStore;
    const id = {
      league: randomUUID(),
      cup: randomUUID(),
      season: randomUUID(),
      home: randomUUID(),
      away: randomUUID(),
      starter: randomUUID(),
      bench: randomUUID(),
      unmapped: randomUUID(),
      fixture: randomUUID(),
      next: randomUUID(),
    };
    const ext = (n: string) => `t1431-${RUN}-${n}`;
    const people: string[] = [id.starter, id.bench, id.unmapped];
    const at = (
      over: Partial<
        Record<'playedBeforeIso' | 'retryBeforeIso' | 'answeredBeforeIso', string>
      > = {},
    ) => ({
      playedBeforeIso: LATER,
      retryBeforeIso: EARLIER,
      answeredBeforeIso: EARLIER,
      ...over,
    });
    const seasonsDue = async (over = {}, maxFailures = 5) =>
      (await store.seasonsDue(PROVIDER, at(over), maxFailures, 50_000)).filter((a) =>
        people.includes(a.personId),
      );
    const careersDue = async (over = {}, maxFailures = 5) =>
      (await store.careersDue(PROVIDER, at(over), maxFailures, 50_000)).filter((a) =>
        people.includes(a.personId),
      );

    function line(over: Partial<NormalisedPlayerSeasonLine>): NormalisedPlayerSeasonLine {
      return {
        competition: { externalId: ext('league'), name: 'League' },
        team: { externalId: ext('home'), name: 'Home' },
        seasonYear: 2026,
        appearances: 9,
        starts: 8,
        minutes: 731,
        goals: 6,
        assists: null,
        yellowCards: 1,
        secondYellowCards: 0,
        redCards: 0,
        saves: null,
        goalsConceded: null,
        rating: 7.43,
        ...over,
      };
    }

    beforeAll(async () => {
      pool = new Pool({ connectionString: DATABASE_URL });
      store = new PlayerSeasonStore(pool);
      await pool.query(
        `INSERT INTO competition (id, name, kind, scope, gender) VALUES
         ($1, 'T-1431 League', 'league', 'international', 'men'),
         ($2, 'T-1431 Cup', 'cup', 'international', 'men')`,
        [id.league, id.cup],
      );
      await pool.query(
        `INSERT INTO season (id, competition_id, label, start_date, end_date, is_current)
       VALUES ($1, $2, '2026/27', '2026-08-01', '2027-05-31', true)`,
        [id.season, id.league],
      );
      await pool.query(
        `INSERT INTO team (id, name, kind, gender) VALUES
         ($1, 'T-1431 Home', 'club', 'men'), ($2, 'T-1431 Away', 'club', 'men')`,
        [id.home, id.away],
      );
      await pool.query(
        `INSERT INTO person (id, full_name) VALUES
         ($1, 'T-1431 Starter'), ($2, 'T-1431 Bench'), ($3, 'T-1431 Unmapped')`,
        people,
      );
      const mappings: [string, string, string][] = [
        ['competition', ext('league'), id.league],
        ['competition', ext('cup'), id.cup],
        ['team', ext('home'), id.home],
        ['team', ext('away'), id.away],
        ['person', ext('starter'), id.starter],
        ['person', ext('bench'), id.bench],
      ];
      for (const [type, external, internal] of mappings) {
        await pool.query(
          `INSERT INTO provider_mapping (provider, entity_type, external_id, internal_id)
         VALUES ('api_football', $1, $2, $3)`,
          [type, external, internal],
        );
      }
      // Two days ago, by the database's clock: the answers are stamped with it.
      await pool.query(
        `INSERT INTO fixture (id, season_id, kickoff_at, status)
       VALUES ($1, $2, now() - interval '2 days', 'finished')`,
        [id.fixture, id.season],
      );
      await pool.query(
        `WITH p AS (
         INSERT INTO fixture_participant (fixture_id, team_id, side)
         VALUES ($1, $2, 'home'), ($1, $3, 'away') RETURNING id, side)
       INSERT INTO lineup (participant_id, person_id, role)
       SELECT p.id, x.person, x.role FROM p
         JOIN (VALUES ('home', $4::uuid, 'starter'), ('away', $5::uuid, 'bench'),
                      ('away', $6::uuid, 'starter')) AS x (side, person, role)
           ON x.side = p.side`,
        [id.fixture, id.home, id.away, id.starter, id.bench, id.unmapped],
      );
    });

    afterAll(async () => {
      if (pool === undefined) return;
      await pool.query(`DELETE FROM fixture WHERE id = ANY($1::uuid[])`, [[id.fixture, id.next]]);
      await pool.query(`DELETE FROM provider_mapping WHERE external_id LIKE $1`, [
        `t1431-${RUN}-%`,
      ]);
      await pool.query(`DELETE FROM person WHERE id = ANY($1::uuid[])`, [people]);
      await pool.query(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [[id.home, id.away]]);
      await pool.query(`DELETE FROM season WHERE id = $1`, [id.season]);
      await pool.query(`DELETE FROM competition WHERE id = ANY($1::uuid[])`, [[id.league, id.cup]]);
      await pool.end();
    });

    it('owes a season ask to each mapped player named in a current season, once the match settles', async () => {
      expect(await seasonsDue({ playedBeforeIso: EARLIER })).toEqual([]);
      const due = await seasonsDue();
      expect(due.map((a) => [a.personId, a.externalId, a.seasonYear]).sort()).toEqual(
        [
          [id.starter, ext('starter'), 2026],
          [id.bench, ext('bench'), 2026],
        ].sort(),
      );
    });

    it('keeps the lines of competitions and teams we know, counts the rest, and replaces them on the next answer', async () => {
      const ask = { personId: id.starter, externalId: ext('starter'), seasonYear: 2026 };
      const kept = await store.saveSeason(
        PROVIDER,
        ask,
        [
          line({}),
          line({ competition: { externalId: ext('cup'), name: 'Cup' }, appearances: 2, goals: 1 }),
          line({ competition: { externalId: ext('friendlies'), name: 'Friendlies' } }),
          line({
            competition: { externalId: ext('cup'), name: 'Cup' },
            team: { externalId: ext('elsewhere'), name: 'Elsewhere' },
          }),
        ],
        '2026-10-20T00:00:00Z',
      );
      expect(kept).toEqual({ kept: 2, unmapped: 2 });
      const rows = await pool.query<{
        competition_id: string;
        goals: number;
        assists: number | null;
        rating: string;
      }>(
        `SELECT competition_id, goals, assists, rating FROM player_season_stat
        WHERE person_id = $1 ORDER BY appearances DESC`,
        [id.starter],
      );
      expect(rows.rows).toEqual([
        { competition_id: id.league, goals: 6, assists: null, rating: '7.43' },
        { competition_id: id.cup, goals: 1, assists: null, rating: '7.43' },
      ]);
      const fetch = await pool.query(
        `SELECT lines, kept, unmapped, failures, answered_at IS NOT NULL AS answered
         FROM player_season_fetch WHERE person_id = $1`,
        [id.starter],
      );
      expect(fetch.rows).toEqual([{ lines: 4, kept: 2, unmapped: 2, failures: 0, answered: true }]);
      expect((await seasonsDue()).map((a) => a.personId)).toEqual([id.bench]);

      await store.saveSeason(PROVIDER, ask, [line({ goals: 7 })], '2026-10-21T00:00:00Z');
      const after = await pool.query(
        `SELECT competition_id, goals FROM player_season_stat WHERE person_id = $1`,
        [id.starter],
      );
      expect(after.rows).toEqual([{ competition_id: id.league, goals: 7 }]);
    });

    it('owes the season again after a match he was named for that kicked off after the answer', async () => {
      await pool.query(
        `INSERT INTO fixture (id, season_id, kickoff_at, status)
       VALUES ($1, $2, now() + interval '1 hour', 'finished')`,
        [id.next, id.season],
      );
      await pool.query(
        `WITH p AS (
         INSERT INTO fixture_participant (fixture_id, team_id, side)
         VALUES ($1, $2, 'home'), ($1, $3, 'away') RETURNING id, side)
       INSERT INTO lineup (participant_id, person_id, role)
       SELECT p.id, $4, 'starter' FROM p WHERE p.side = 'home'`,
        [id.next, id.home, id.away, id.starter],
      );
      expect((await seasonsDue()).map((a) => a.personId).sort()).toEqual(
        [id.starter, id.bench].sort(),
      );
    });

    it('asks again after an unanswered ask only past the retry wait, and not past the failures', async () => {
      const ask = { personId: id.bench, externalId: ext('bench'), seasonYear: 2026 };
      await store.markSeasonAsked(PROVIDER, ask);
      const bench = async (over = {}, max = 5) =>
        (await seasonsDue(over, max)).some((a) => a.personId === id.bench);
      expect(await bench()).toBe(false);
      expect(await bench({ retryBeforeIso: LATER })).toBe(true);
      expect(await bench({ retryBeforeIso: LATER }, 1)).toBe(false);
    });

    it('keeps the career teams we know, season by season, and asks again once the answer is old', async () => {
      expect((await careersDue()).map((a) => a.personId).sort()).toEqual(
        [id.starter, id.bench].sort(),
      );
      const ask = { personId: id.starter, externalId: ext('starter') };
      const kept = await store.saveCareer(
        PROVIDER,
        ask,
        [
          { team: { externalId: ext('home'), name: 'Home' }, seasonYears: [2026, 2025] },
          { team: { externalId: ext('youth'), name: 'Youth' }, seasonYears: [2019] },
          { team: { externalId: ext('away'), name: 'Away' }, seasonYears: [2024] },
        ],
        '2026-10-20T00:00:00Z',
      );
      expect(kept).toEqual({ kept: 2, unmapped: 1 });
      const rows = await pool.query(
        `SELECT team_id, season_year FROM player_career_season
        WHERE person_id = $1 ORDER BY season_year DESC`,
        [id.starter],
      );
      expect(rows.rows).toEqual([
        { team_id: id.home, season_year: 2026 },
        { team_id: id.home, season_year: 2025 },
        { team_id: id.away, season_year: 2024 },
      ]);
      expect((await careersDue()).map((a) => a.personId)).toEqual([id.bench]);
      expect(
        (await careersDue({ answeredBeforeIso: LATER })).map((a) => a.personId).sort(),
      ).toEqual([id.starter, id.bench].sort());

      await store.markCareerAsked(PROVIDER, { personId: id.bench, externalId: ext('bench') });
      expect((await careersDue()).map((a) => a.personId)).toEqual([]);
      expect((await careersDue({ retryBeforeIso: LATER })).map((a) => a.personId)).toEqual([
        id.bench,
      ]);
    });
  },
);
