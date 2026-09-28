import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { CompetitionContext } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { CatalogModule } from './catalog.module';

// T-840 against the real schema: a temporary league, a continental cup with a
// group stage and a two-legged round of 16, and a domestic cup final with no
// stage row. The table is the one before kick-off; a cup tie says its round
// and its legs, never an empty table.
const DATABASE_URL = process.env.DATABASE_URL;

const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const LEAGUE = randomUUID();
const LEAGUE_SEASON = randomUUID();
const LEAGUE_STAGE = randomUUID();
const CUP = randomUUID();
const CUP_SEASON = randomUUID();
const GROUPS = randomUUID();
const ROUND_OF_16 = randomUUID();
const HOME_CUP = randomUUID();
const HOME_CUP_SEASON = randomUUID();
const TEAMS = { a: randomUUID(), b: randomUUID(), c: randomUUID(), d: randomUUID() };
type Side = keyof typeof TEAMS;

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  'GET /fixtures/:id/competition-context',
  () => {
    let app: NestFastifyApplication;
    let pool: Pool;
    const fixtures: string[] = [];
    const ids: Record<string, string> = {};

    const get = (id: string) =>
      app.inject({ method: 'GET', url: `/fixtures/${id}/competition-context` });

    async function fixture(
      name: string,
      where: { season: string; stage: string | null; round: string | null; group?: string },
      home: Side,
      away: Side,
      kickoff: string,
      score: [number, number] | null,
    ): Promise<void> {
      const id = randomUUID();
      fixtures.push(id);
      ids[name] = id;
      await pool.query(
        `INSERT INTO fixture (id, season_id, stage_id, round, group_name, kickoff_at, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          id,
          where.season,
          where.stage,
          where.round,
          where.group ?? null,
          `${kickoff}T15:00:00Z`,
          score === null ? 'scheduled' : 'finished',
        ],
      );
      await pool.query(
        `INSERT INTO fixture_participant (fixture_id, team_id, side)
         VALUES ($1, $2, 'home'), ($1, $3, 'away')`,
        [id, TEAMS[home], TEAMS[away]],
      );
      if (score !== null) {
        await pool.query(
          `INSERT INTO fixture_score (fixture_id, kind, home, away) VALUES ($1, 'full_time', $2, $3)`,
          [id, score[0], score[1]],
        );
      }
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
        `INSERT INTO competition (id, name, kind, scope, gender, country_id) VALUES
           ($1, $4, 'league', 'domestic', 'men', '00000000-0000-4000-8000-000000000101'),
           ($2, $5, 'cup', 'continental', 'men', NULL),
           ($3, $6, 'cup', 'domestic', 'men', '00000000-0000-4000-8000-000000000101')`,
        [
          LEAGUE,
          CUP,
          HOME_CUP,
          `Context League ${RUN}`,
          `Context Cup ${RUN}`,
          `Context Home Cup ${RUN}`,
        ],
      );
      await pool.query(
        `INSERT INTO season (id, competition_id, label, start_date, end_date, is_current) VALUES
           ($1, $4, '2085/86', DATE '2085-08-01', DATE '2086-05-31', true),
           ($2, $5, '2086/87', DATE '2086-07-01', DATE '2087-06-30', true),
           ($3, $6, '2086/87', DATE '2086-07-01', DATE '2087-06-30', true)`,
        [LEAGUE_SEASON, CUP_SEASON, HOME_CUP_SEASON, LEAGUE, CUP, HOME_CUP],
      );
      await pool.query(
        `INSERT INTO stage (id, season_id, name, kind, sort_order, legs) VALUES
           ($1, $4, 'Regular season', 'league', 1, 1),
           ($2, $5, 'Group stage', 'group', 1, 1),
           ($3, $5, 'Round of 16', 'knockout', 2, 2)`,
        [LEAGUE_STAGE, GROUPS, ROUND_OF_16, LEAGUE_SEASON, CUP_SEASON],
      );
      await pool.query(
        `INSERT INTO team (id, name, short_name, kind, gender) VALUES
           ($1, $5, NULL, 'club', 'men'), ($2, $6, NULL, 'club', 'men'),
           ($3, $7, NULL, 'club', 'men'), ($4, $8, NULL, 'club', 'men')`,
        [
          TEAMS.a,
          TEAMS.b,
          TEAMS.c,
          TEAMS.d,
          `Ctx Alpha ${RUN}`,
          `Ctx Beta ${RUN}`,
          `Ctx Gamma ${RUN}`,
          `Ctx Delta ${RUN}`,
        ],
      );
      await pool.query(
        `INSERT INTO coverage_profile (season_id, module, state, provider) VALUES
           ($1, 'standings', 'available', 'api_football'),
           ($2, 'standings', 'available', 'api_football')`,
        [LEAGUE_SEASON, CUP_SEASON],
      );

      const league = { season: LEAGUE_SEASON, stage: LEAGUE_STAGE, round: 'Regular Season' };
      // Before the match: A 6 points, B 3, C 1 (-1), D 1 (-4).
      await fixture('opener', league, 'a', 'd', '2085-12-01', null);
      await fixture('l1', league, 'a', 'b', '2086-01-01', [2, 0]);
      await fixture('l2', league, 'c', 'd', '2086-01-01', [1, 1]);
      await fixture('l3', league, 'a', 'c', '2086-01-08', [1, 0]);
      await fixture('l4', league, 'b', 'd', '2086-01-08', [3, 0]);
      await fixture('match', league, 'b', 'c', '2086-01-15', [0, 0]);
      // After it: never counted in its context.
      await fixture('later', league, 'd', 'a', '2086-01-22', [5, 0]);

      const group = { season: CUP_SEASON, stage: GROUPS, round: 'Group A - 1', group: 'A' };
      await fixture('g1', group, 'a', 'b', '2086-09-16', [1, 0]);
      await fixture('g2', { ...group, round: 'Group A - 2' }, 'b', 'a', '2086-09-30', null);

      const r16 = { season: CUP_SEASON, stage: ROUND_OF_16, round: 'Round of 16' };
      await fixture('r16a', r16, 'c', 'd', '2087-02-01', [2, 1]);
      await fixture('r16b', r16, 'd', 'c', '2087-02-08', null);

      await fixture(
        'final',
        { season: HOME_CUP_SEASON, stage: null, round: 'Final' },
        'a',
        'b',
        '2087-05-20',
        [1, 0],
      );
    });

    afterAll(async () => {
      await pool.query(`DELETE FROM fixture WHERE id = ANY($1::uuid[])`, [fixtures]);
      await pool.query(`DELETE FROM coverage_profile WHERE season_id = ANY($1::uuid[])`, [
        [LEAGUE_SEASON, CUP_SEASON],
      ]);
      await pool.query(`DELETE FROM stage WHERE id = ANY($1::uuid[])`, [
        [LEAGUE_STAGE, GROUPS, ROUND_OF_16],
      ]);
      await pool.query(`DELETE FROM season WHERE id = ANY($1::uuid[])`, [
        [LEAGUE_SEASON, CUP_SEASON, HOME_CUP_SEASON],
      ]);
      await pool.query(`DELETE FROM competition WHERE id = ANY($1::uuid[])`, [
        [LEAGUE, CUP, HOME_CUP],
      ]);
      await pool.query(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [Object.values(TEAMS)]);
      await pool.end();
      await app.close();
    });

    it('answers 404 for an unknown or malformed id', async () => {
      expect((await get(randomUUID())).statusCode).toBe(404);
      expect((await get('nope')).statusCode).toBe(404);
    });

    it('states both sides in the league table as it stood before kick-off', async () => {
      const response = await get(ids.match!);
      expect(response.statusCode).toBe(200);
      const context = response.json() as CompetitionContext;
      expect(context).toMatchObject({
        competition: { id: LEAGUE, kind: 'league' },
        season: { id: LEAGUE_SEASON, label: '2085/86' },
        stage: { name: 'Regular season', kind: 'league' },
        knockout: null,
      });
      expect(context.table?.coverage).toBe('available');
      expect(context.table?.data).toMatchObject({
        scope: 'league',
        matches_counted: 4,
        teams: 4,
        leader: { team: { id: TEAMS.a }, points: 6 },
        places: 'not_supplied',
        home: {
          team: { id: TEAMS.b },
          position: 2,
          played: 2,
          points: 3,
          form: ['W', 'L'],
          points_from_top: 3,
          points_to_place_above: 3,
          points_clear_of_place_below: 2,
        },
        away: { team: { id: TEAMS.c }, position: 3, points: 1, points_from_top: 5 },
      });
    });

    it('says a table has not started before its first match, with no positions', async () => {
      const context = (await get(ids.opener!)).json() as CompetitionContext;
      expect(context.table).toMatchObject({
        coverage: 'available',
        data: { matches_counted: 0, teams: 4, leader: null, home: null, away: null },
      });
    });

    it('ranks a group stage match within its own group', async () => {
      const context = (await get(ids.g2!)).json() as CompetitionContext;
      expect(context.group_name).toBe('A');
      expect(context.knockout).toBeNull();
      expect(context.table?.data).toMatchObject({
        scope: 'group',
        group_name: 'A',
        matches_counted: 1,
        teams: 2,
        home: { team: { id: TEAMS.b }, position: 2, points: 0 },
        away: { team: { id: TEAMS.a }, position: 1, points: 3 },
      });
    });

    it('gives a knockout match its round and both legs, and no table', async () => {
      const context = (await get(ids.r16b!)).json() as CompetitionContext;
      expect(context.table).toBeNull();
      expect(context.knockout).toMatchObject({
        round: 'Round of 16',
        round_key: 'round_of_16',
        legs_expected: 2,
        tie: { aggregate: null, winner: null },
      });
      expect(context.knockout?.tie.legs.map((l) => [l.fixture_id, l.score])).toEqual([
        [ids.r16a, { home: 2, away: 1 }],
        [ids.r16b, null],
      ]);
    });

    it('names a domestic cup round with no stage record and judges nothing it cannot', async () => {
      const context = (await get(ids.final!)).json() as CompetitionContext;
      expect(context.table).toBeNull();
      expect(context.knockout).toMatchObject({
        round: 'Final',
        round_key: null,
        legs_expected: null,
        tie: { winner: null, decided_by: null },
      });
      expect(context.knockout?.tie.legs).toHaveLength(1);
    });
  },
);
