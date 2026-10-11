import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { CompetitionPage } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { CatalogModule } from './catalog.module';

/**
 * T-1394 (D-209) against the real schema: a cup's season is its main
 * competition. Qualifying rounds stored without a stage, kicked off before
 * the league stage's first match, and a match of a `qualifying` stage, are
 * flagged and left out of the boards; a knockout play-off after the league
 * stage is in. A league season with no qualifying match is unchanged.
 */
const DATABASE_URL = process.env.DATABASE_URL;

const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const CUP = randomUUID();
const SEASON = randomUUID();
const LEAGUE_STAGE = randomUUID();
const QUALIFYING_STAGE = randomUUID();
const TEAMS = [randomUUID(), randomUUID(), randomUUID(), randomUUID()] as const;
const QUALIFIER_SCORER = randomUUID();
const LEAGUE_SCORER = randomUUID();

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  'a cup season counts its main competition',
  () => {
    let app: NestFastifyApplication;
    let pool: Pool;
    const ids: Record<string, string> = {};

    async function fixture(
      key: string,
      stage: string | null,
      round: string,
      kickoff: string,
      home: string,
      away: string,
      score: [number, number],
    ): Promise<void> {
      const id = randomUUID();
      ids[key] = id;
      await pool.query(
        `INSERT INTO fixture (id, season_id, stage_id, round, kickoff_at, status)
         VALUES ($1, $2, $3, $4, $5::timestamptz, 'finished')`,
        [id, SEASON, stage, round, kickoff],
      );
      await pool.query(
        `INSERT INTO fixture_participant (fixture_id, team_id, side) VALUES ($1, $2, 'home'), ($1, $3, 'away')`,
        [id, home, away],
      );
      await pool.query(
        `INSERT INTO fixture_score (fixture_id, kind, home, away) VALUES ($1, 'full_time', $2, $3)`,
        [id, score[0], score[1]],
      );
    }

    async function goal(key: string, person: string, minute: number, sequence: number) {
      await pool.query(
        `INSERT INTO incident (fixture_id, participant_id, person_id, kind, minute, sequence)
         SELECT $1, id, $2, 'goal', $3, $4 FROM fixture_participant WHERE fixture_id = $1 AND side = 'home'`,
        [ids[key], person, minute, sequence],
      );
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [DatabaseModule, CatalogModule],
      }).compile();
      app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      pool = new Pool({ connectionString: DATABASE_URL });

      await pool.query(
        `INSERT INTO competition (id, name, kind, scope, gender)
         VALUES ($1, $2, 'cup', 'continental', 'men')`,
        [CUP, `Test Champions Cup ${RUN}`],
      );
      await pool.query(
        `INSERT INTO season (id, competition_id, label, start_date, end_date, is_current)
         VALUES ($1, $2, '2086/87', DATE '2086-07-01', DATE '2087-06-01', true)`,
        [SEASON, CUP],
      );
      await pool.query(
        `INSERT INTO stage (id, season_id, name, kind, sort_order) VALUES
           ($1, $3, 'Qualifying Round', 'qualifying', 1),
           ($2, $3, 'League Stage', 'league', 2)`,
        [QUALIFYING_STAGE, LEAGUE_STAGE, SEASON],
      );
      await pool.query(
        `INSERT INTO team (id, name, kind, gender) VALUES
           ($1, $5, 'club', 'men'), ($2, $6, 'club', 'men'),
           ($3, $7, 'club', 'men'), ($4, $8, 'club', 'men')`,
        [...TEAMS, ...TEAMS.map((_, i) => `Test Cup Club ${i} ${RUN}`)],
      );
      await pool.query(`INSERT INTO person (id, full_name) VALUES ($1, $3), ($2, $4)`, [
        QUALIFIER_SCORER,
        LEAGUE_SCORER,
        `Qualifier Scorer ${RUN}`,
        `League Scorer ${RUN}`,
      ]);
      const [a, b, c, d] = TEAMS;
      // Stored without a stage, as the provider's qualifying rounds usually are.
      await fixture('q2', null, '2nd Qualifying Round', '2086-07-22T18:00:00Z', a, b, [3, 0]);
      await fixture('playoff', null, 'Play-offs', '2086-08-20T18:00:00Z', a, c, [2, 2]);
      // The main competition: the league stage, then a knockout play-off after it.
      await fixture(
        'league1',
        LEAGUE_STAGE,
        'League Stage - 1',
        '2086-09-15T19:00:00Z',
        c,
        d,
        [1, 0],
      );
      await fixture(
        'league2',
        LEAGUE_STAGE,
        'League Stage - 2',
        '2086-09-30T19:00:00Z',
        d,
        c,
        [0, 0],
      );
      await fixture('ko', null, 'Knockout Round Play-offs', '2087-02-10T20:00:00Z', c, a, [2, 1]);
      // A match an operator put in a qualifying stage is qualifying whatever its date.
      await fixture(
        'late',
        QUALIFYING_STAGE,
        'Qualifying Round',
        '2086-10-01T18:00:00Z',
        b,
        d,
        [1, 1],
      );
      await goal('q2', QUALIFIER_SCORER, 10, 1);
      await goal('q2', QUALIFIER_SCORER, 30, 2);
      await goal('q2', QUALIFIER_SCORER, 50, 3);
      await goal('playoff', QUALIFIER_SCORER, 12, 1);
      await goal('league1', LEAGUE_SCORER, 70, 1);
      await goal('ko', LEAGUE_SCORER, 5, 1);
    });

    afterAll(async () => {
      await pool.query(`DELETE FROM fixture WHERE id = ANY($1::uuid[])`, [Object.values(ids)]);
      await pool.query(`DELETE FROM person WHERE id = ANY($1::uuid[])`, [
        [QUALIFIER_SCORER, LEAGUE_SCORER],
      ]);
      await pool.query(`DELETE FROM stage WHERE season_id = $1`, [SEASON]);
      await pool.query(`DELETE FROM season WHERE id = $1`, [SEASON]);
      await pool.query(`DELETE FROM competition WHERE id = $1`, [CUP]);
      await pool.query(`DELETE FROM entity_alias WHERE entity_id = ANY($1::uuid[])`, [[...TEAMS]]);
      await pool.query(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [[...TEAMS]]);
      await pool.end();
      await app.close();
    });

    it('flags the qualifying matches and keeps the knockout play-off in', async () => {
      const response = await app.inject({ method: 'GET', url: `/competitions/${CUP}` });
      expect(response.statusCode).toBe(200);
      const page = response.json() as CompetitionPage;
      const flag = (key: string) => page.results.find((f) => f.id === ids[key])?.qualifying;
      expect(flag('q2')).toBe(true);
      expect(flag('playoff')).toBe(true);
      expect(flag('late')).toBe(true);
      expect(flag('league1')).toBe(false);
      expect(flag('league2')).toBe(false);
      expect(flag('ko')).toBe(false);
    });

    it("counts the top scorers' goals in the main competition only", async () => {
      const page = (
        await app.inject({ method: 'GET', url: `/competitions/${CUP}` })
      ).json() as CompetitionPage;
      // Four qualifying goals would have put the qualifier first; they are not his season here.
      expect(page.leaders.data?.map((l) => [l.person.id, l.goals])).toEqual([[LEAGUE_SCORER, 2]]);
    });
  },
);
