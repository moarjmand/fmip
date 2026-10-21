import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { CompetitionPage } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { CatalogModule } from './catalog.module';

// T-1441 (D-232): the competition page's player leader tables against the
// real schema. Three seasons of one competition:
//  - 2025/26 has incidents and line-ups: ties are broken by fewer appearances,
//    then name; yellow and red cards are their own tables; every row says how
//    many matches the player played.
//  - 2024/25 has no incident but the provider's season totals: the tables come
//    from them, flagged `provider_totals` and `limited`.
//  - 2023/24 has neither: `not_supplied`, never an empty table that looks full.
const DATABASE_URL = process.env.DATABASE_URL;

const ENGLAND = '00000000-0000-4000-8000-000000000101';
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const COMPETITION = randomUUID();
const RECORDED = randomUUID();
const PROVIDER = randomUUID();
const EMPTY = randomUUID();
const TEAMS = { alpha: randomUUID(), beta: randomUUID() };
const P = {
  early: randomUUID(), // two goals, one match
  often: randomUUID(), // two goals, three matches
  ann: randomUUID(), // one goal, two matches
  bea: randomUUID(), // one goal, two matches
  red: randomUUID(), // a straight red and a second yellow
  booked: randomUUID(), // two yellows
};
const FETCHED = '2026-10-02T08:00:00.000Z';

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  'competition player leaders (T-1441)',
  () => {
    let app: NestFastifyApplication;
    let pool: Pool;
    const fixtures: string[] = [];
    let sequence = 0;
    let shirt = 0;

    async function match(date: string, home: string, away: string, score: [number, number]) {
      const id = randomUUID();
      fixtures.push(id);
      await pool.query(
        `INSERT INTO fixture (id, season_id, round, kickoff_at, status)
         VALUES ($1, $2, 'Matchday', $3::timestamptz, 'finished')`,
        [id, RECORDED, date],
      );
      const sides = await pool.query<{ id: string; side: 'home' | 'away' }>(
        `INSERT INTO fixture_participant (fixture_id, team_id, side)
         VALUES ($1, $2, 'home'), ($1, $3, 'away') RETURNING id, side`,
        [id, home, away],
      );
      await pool.query(
        `INSERT INTO fixture_score (fixture_id, kind, home, away) VALUES ($1, 'full_time', $2, $3)`,
        [id, score[0], score[1]],
      );
      return {
        id,
        home: sides.rows.find((s) => s.side === 'home')!.id,
        away: sides.rows.find((s) => s.side === 'away')!.id,
      };
    }

    async function incident(fixtureId: string, participant: string, kind: string, person: string) {
      sequence += 1;
      await pool.query(
        `INSERT INTO incident (fixture_id, participant_id, person_id, kind, minute, sequence)
         VALUES ($1, $2, $3, $4, 50, $5)`,
        [fixtureId, participant, person, kind, sequence],
      );
    }

    async function named(participant: string, ...people: string[]) {
      for (const person of people) {
        await pool.query(
          `INSERT INTO lineup (participant_id, person_id, role, shirt_number, position)
           VALUES ($1, $2, 'starter', $3, 'forward')`,
          [participant, person, (shirt += 1)],
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
        `INSERT INTO competition (id, country_id, name, kind, scope, gender)
         VALUES ($1, $2, $3, 'league', 'domestic', 'men')`,
        [COMPETITION, ENGLAND, `Leaders League ${RUN}`],
      );
      await pool.query(
        `INSERT INTO season (id, competition_id, label, start_date, end_date, is_current) VALUES
           ($1, $4, '2025/26', DATE '2025-08-01', DATE '2026-05-31', true),
           ($2, $4, '2024/25', DATE '2024-08-01', DATE '2025-05-31', false),
           ($3, $4, '2023/24', DATE '2023-08-01', DATE '2024-05-31', false)`,
        [RECORDED, PROVIDER, EMPTY, COMPETITION],
      );
      await pool.query(
        `INSERT INTO team (id, name, kind, gender) VALUES ($1, $3, 'club', 'men'), ($2, $4, 'club', 'men')`,
        [TEAMS.alpha, TEAMS.beta, `Leaders Alpha ${RUN}`, `Leaders Beta ${RUN}`],
      );
      for (const [key, id] of Object.entries(P)) {
        const name = `${key[0]!.toUpperCase()}${key.slice(1)} ${RUN}`;
        await pool.query(`INSERT INTO person (id, full_name, known_as) VALUES ($1, $2, $2)`, [
          id,
          name,
        ]);
      }
      await pool.query(
        `INSERT INTO coverage_profile (season_id, module, state, provider) VALUES
           ($1, 'incidents', 'available', 'api_football')`,
        [RECORDED],
      );

      // Four goals in three matches, all named by incidents, so the season is whole.
      const one = await match('2025-09-01T15:00:00Z', TEAMS.alpha, TEAMS.beta, [2, 0]);
      await incident(one.id, one.home, 'goal', P.early);
      await incident(one.id, one.home, 'goal', P.early);
      await named(one.home, P.early, P.often, P.ann, P.bea, P.red, P.booked);
      await incident(one.id, one.home, 'yellow_card', P.booked);
      const two = await match('2025-09-08T15:00:00Z', TEAMS.beta, TEAMS.alpha, [0, 2]);
      await incident(two.id, two.away, 'goal', P.often);
      await incident(two.id, two.away, 'goal', P.often);
      await named(two.away, P.often, P.ann, P.bea, P.booked);
      await incident(two.id, two.away, 'yellow_card', P.booked);
      await incident(two.id, two.away, 'red_card', P.red);
      const three = await match('2025-09-15T15:00:00Z', TEAMS.alpha, TEAMS.beta, [2, 0]);
      await incident(three.id, three.home, 'goal', P.ann);
      await incident(three.id, three.home, 'goal', P.bea);
      await incident(three.id, three.home, 'second_yellow_card', P.red);
      await named(three.home, P.often, P.red);

      // 2024/25: no incident, only the provider's totals.
      await pool.query(
        `INSERT INTO player_season_stat
           (source, person_id, season_year, competition_id, team_id, appearances, minutes,
            goals, assists, yellow_cards, second_yellow_cards, red_cards, fetched_at)
         VALUES
           ('api_football', $1, 2024, $4, $5, 30, 2500, 12, 4, 3, 0, 0, $6),
           ('api_football', $2, 2024, $4, $5, 20, NULL, 12, NULL, NULL, NULL, NULL, $6),
           ('api_football', $3, 2024, $4, $5, 25, 2000, 3, 9, 7, 1, 1, $6)`,
        [P.often, P.early, P.booked, COMPETITION, TEAMS.alpha, FETCHED],
      );
    });

    afterAll(async () => {
      await pool.query(`DELETE FROM player_season_stat WHERE competition_id = $1`, [COMPETITION]);
      await pool.query(`DELETE FROM incident WHERE fixture_id = ANY($1::uuid[])`, [fixtures]);
      await pool.query(`DELETE FROM fixture WHERE id = ANY($1::uuid[])`, [fixtures]);
      await pool.query(`DELETE FROM season WHERE competition_id = $1`, [COMPETITION]);
      await pool.query(`DELETE FROM competition WHERE id = $1`, [COMPETITION]);
      await pool.query(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [Object.values(TEAMS)]);
      await pool.query(`DELETE FROM person WHERE id = ANY($1::uuid[])`, [Object.values(P)]);
      await pool.end();
      await app.close();
    });

    const get = async (season: string): Promise<CompetitionPage> => {
      const response = await app.inject({
        method: 'GET',
        url: `/competitions/${COMPETITION}?season=${season}`,
      });
      expect(response.statusCode).toBe(200);
      return response.json() as CompetitionPage;
    };

    it('breaks ties by fewer appearances, then name, and shows appearances on every row', async () => {
      const page = await get(RECORDED);
      expect(page.leaders_source).toBe('recorded');
      expect(page.leaders.coverage).toBe('available');
      expect(page.leaders.data!.map((r) => [r.person.id, r.goals, r.appearances])).toEqual([
        [P.early, 2, 1],
        [P.often, 2, 3],
        [P.ann, 1, 2],
        [P.bea, 1, 2],
      ]);
    });

    it('keeps yellow and red cards in their own tables, ranked by their own figure', async () => {
      const { boards } = await get(RECORDED);
      expect(boards.yellow_cards.data!.map((r) => [r.person.id, r.yellow_cards])).toEqual([
        [P.booked, 2],
      ]);
      // A second yellow counts as a red, as on the player page.
      expect(boards.red_cards.data!.map((r) => [r.person.id, r.red_cards, r.appearances])).toEqual([
        [P.red, 2, 2],
      ]);
    });

    it('falls back to the provider totals for a season with no incident, flagged and limited', async () => {
      const page = await get(PROVIDER);
      expect(page.leaders_source).toBe('provider_totals');
      expect(page.leaders.coverage).toBe('limited');
      expect(page.leaders.last_updated_at).toBe(FETCHED);
      // Level on 12: the one with 20 appearances ahead of the one with 30.
      expect(page.leaders.data!.map((r) => [r.person.id, r.goals, r.appearances])).toEqual([
        [P.early, 12, 20],
        [P.often, 12, 30],
        [P.booked, 3, 25],
      ]);
      expect(page.leaders.data![1]!.minutes).toMatchObject({ coverage: 'available', total: 2500 });
      expect(page.leaders.data![0]!.minutes.coverage).toBe('not_supplied');
      // A figure the provider left out is no row, never a nought.
      expect(page.boards.assists.data!.map((r) => [r.person.id, r.assists])).toEqual([
        [P.booked, 9],
        [P.often, 4],
      ]);
      expect(page.boards.yellow_cards.data!.map((r) => [r.person.id, r.yellow_cards])).toEqual([
        [P.booked, 7],
        [P.often, 3],
      ]);
      expect(page.boards.red_cards.data!.map((r) => [r.person.id, r.red_cards])).toEqual([
        [P.booked, 2],
      ]);
      // Clean sheets are not the provider's to give: ours, and we hold no line-up.
      expect(page.boards.clean_sheets.coverage).toBe('not_supplied');
    });

    it('applies the minutes floor to the provider totals as to ours', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/competitions/${COMPETITION}?season=${PROVIDER}&min_minutes=2400`,
      });
      const page = response.json() as CompetitionPage;
      expect(page.leaders.data!.map((r) => r.person.id)).toEqual([P.often]);
      // The player with no minutes supplied cannot show the floor: counted, not dropped silently.
      expect(page.leaders_filter.unproven).toBe(1);
    });

    it('says a season with neither incidents nor provider totals is not supplied', async () => {
      const page = await get(EMPTY);
      expect(page.leaders_source).toBe('recorded');
      expect(page.leaders.coverage).toBe('not_supplied');
      expect(page.leaders.data).toBeNull();
      expect(page.boards.yellow_cards.data).toBeNull();
      expect(page.boards.red_cards.data).toBeNull();
    });
  },
);
