import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { KeyPlayers } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../identity/identity.service';
import { FixturesModule } from './fixtures.module';

// T-841 against the real schema: a temporary league where the home side has
// player figures for two of its three matches before this one, the away side
// for none, a later match that must not count, and a provider answer about
// this match with one doubt.
const DATABASE_URL = process.env.DATABASE_URL;

const ENGLAND = '00000000-0000-4000-8000-000000000101';
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const LEAGUE = randomUUID();
const SEASON = randomUUID();
const TEAMS = { home: randomUUID(), away: randomUUID(), other: randomUUID() };
const PEOPLE = { h1: randomUUID(), h2: randomUUID(), h3: randomUUID(), h4: randomUUID() };
type Team = keyof typeof TEAMS;
type Person = keyof typeof PEOPLE;

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  'GET /fixtures/:id/key-players',
  () => {
    let app: NestFastifyApplication;
    let pool: Pool;
    const fixtures: string[] = [];
    const ids: Record<string, string> = {};

    const get = (id: string) => app.inject({ method: 'GET', url: `/fixtures/${id}/key-players` });

    /** A fixture; returns the participant id of each team. */
    async function fixture(
      name: string,
      home: Team,
      away: Team,
      kickoff: string,
      finished: boolean,
    ): Promise<Record<string, string>> {
      const id = randomUUID();
      fixtures.push(id);
      ids[name] = id;
      await pool.query(
        `INSERT INTO fixture (id, season_id, kickoff_at, status) VALUES ($1, $2, $3, $4)`,
        [id, SEASON, `${kickoff}T15:00:00Z`, finished ? 'finished' : 'scheduled'],
      );
      const { rows } = await pool.query<{ id: string; team_id: string }>(
        `INSERT INTO fixture_participant (fixture_id, team_id, side)
         VALUES ($1, $2, 'home'), ($1, $3, 'away') RETURNING id, team_id`,
        [id, TEAMS[home], TEAMS[away]],
      );
      if (finished) {
        await pool.query(
          `INSERT INTO fixture_score (fixture_id, kind, home, away) VALUES ($1, 'full_time', 1, 0)`,
          [id],
        );
      }
      return Object.fromEntries(rows.map((r) => [r.team_id, r.id]));
    }

    async function figures(
      participant: string,
      rows: [Person, 'minutes' | 'goals' | 'assists' | 'rating', number][],
    ): Promise<void> {
      for (const [person, metric, value] of rows) {
        await pool.query(
          `INSERT INTO fixture_player_stat (participant_id, person_id, metric, value)
           VALUES ($1, $2, $3, $4)`,
          [participant, PEOPLE[person], metric, value],
        );
      }
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [DatabaseModule, FixturesModule],
      })
        .overrideProvider(IDENTITY_OPTIONS)
        .useValue({
          ...DEFAULT_IDENTITY_OPTIONS,
          sessionSecret: 'test-secret-'.repeat(4),
          webBaseUrl: 'http://web.test',
          cookieSecure: false,
        })
        .compile();
      app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      pool = new Pool({ connectionString: DATABASE_URL });

      await pool.query(
        `INSERT INTO competition (id, country_id, name, kind, scope, gender)
         VALUES ($1, $2, $3, 'league', 'domestic', 'men')`,
        [LEAGUE, ENGLAND, `Key League ${RUN}`],
      );
      await pool.query(
        `INSERT INTO season (id, competition_id, label, start_date, end_date, is_current)
         VALUES ($1, $2, '2085/86', DATE '2085-08-01', DATE '2086-05-31', true)`,
        [SEASON, LEAGUE],
      );
      await pool.query(
        `INSERT INTO team (id, name, kind, gender) VALUES
           ($1, $4, 'club', 'men'), ($2, $5, 'club', 'men'), ($3, $6, 'club', 'men')`,
        [
          TEAMS.home,
          TEAMS.away,
          TEAMS.other,
          `Key Home ${RUN}`,
          `Key Away ${RUN}`,
          `Key Other ${RUN}`,
        ],
      );
      await pool.query(
        `INSERT INTO person (id, full_name) VALUES
           ($1, 'Key One ${RUN}'), ($2, 'Key Two ${RUN}'), ($3, 'Key Three ${RUN}'), ($4, 'Key Four ${RUN}')`,
        [PEOPLE.h1, PEOPLE.h2, PEOPLE.h3, PEOPLE.h4],
      );

      const m1 = await fixture('m1', 'home', 'other', '2086-01-01', true);
      await figures(m1[TEAMS.home]!, [
        ['h1', 'minutes', 90],
        ['h1', 'goals', 1],
        ['h1', 'rating', 9.9],
        ['h2', 'minutes', 90],
        ['h3', 'minutes', 60],
        ['h3', 'assists', 1],
        ['h4', 'minutes', 30],
      ]);
      await pool.query(
        `INSERT INTO lineup (participant_id, person_id, role, position) VALUES ($1, $2, 'starter', 'forward')`,
        [m1[TEAMS.home], PEOPLE.h1],
      );
      const m2 = await fixture('m2', 'other', 'home', '2086-01-08', true);
      await figures(m2[TEAMS.home]!, [
        ['h1', 'minutes', 90],
        ['h2', 'minutes', 45],
        ['h3', 'minutes', 90],
      ]);
      // Played, but no player figures for either side.
      await fixture('m3', 'away', 'other', '2086-01-08', true);
      await fixture('m4', 'home', 'away', '2086-01-12', true);

      const match = await fixture('match', 'home', 'away', '2086-01-15', false);
      await pool.query(
        `INSERT INTO fixture_availability_fetch (fixture_id, provider, fetched_at)
         VALUES ($1, 'api_football', TIMESTAMPTZ '2086-01-14 09:00:00+00')`,
        [ids.match],
      );
      await pool.query(
        `INSERT INTO fixture_absence (fixture_id, participant_id, person_id, status, kind, reason)
         VALUES ($1, $2, $3, 'doubtful', 'injury', 'Hamstring')`,
        [ids.match, match[TEAMS.home], PEOPLE.h2],
      );

      // After the match: never counted in its key players.
      const later = await fixture('later', 'other', 'home', '2086-01-22', true);
      await figures(later[TEAMS.home]!, [['h4', 'minutes', 900]]);
    });

    afterAll(async () => {
      await pool.query(`DELETE FROM fixture WHERE id = ANY($1::uuid[])`, [fixtures]);
      await pool.query(`DELETE FROM person WHERE id = ANY($1::uuid[])`, [Object.values(PEOPLE)]);
      await pool.query(`DELETE FROM season WHERE id = $1`, [SEASON]);
      await pool.query(`DELETE FROM competition WHERE id = $1`, [LEAGUE]);
      await pool.query(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [Object.values(TEAMS)]);
      await pool.end();
      await app.close();
    });

    it('answers 404 for an unknown or malformed id', async () => {
      expect((await get(randomUUID())).statusCode).toBe(404);
      expect((await get('nope')).statusCode).toBe(404);
    });

    it('picks the most minutes before kick-off, sums the figures, and says what is missing', async () => {
      const response = await get(ids.match!);
      expect(response.statusCode).toBe(200);
      const body = response.json() as KeyPlayers;
      expect(body).toMatchObject({
        competition: { id: LEAGUE },
        season: { id: SEASON, label: '2085/86' },
        availability_asked_at: '2086-01-14T09:00:00.000Z',
      });
      // Three matches played before this one, two with figures: a floor.
      expect(body.home.coverage).toBe('limited');
      expect(body.home.data).toMatchObject({
        team: { id: TEAMS.home },
        matches_played: 3,
        matches_with_figures: 2,
      });
      expect(body.home.data?.players).toEqual([
        {
          id: PEOPLE.h1,
          name: `Key One ${RUN}`,
          position: 'forward',
          appearances: 2,
          minutes: 180,
          goals: 1,
          assists: 0,
          availability: { status: 'not_listed', kind: null, reason: null },
        },
        {
          id: PEOPLE.h3,
          name: `Key Three ${RUN}`,
          position: null,
          appearances: 2,
          minutes: 150,
          goals: 0,
          assists: 1,
          availability: { status: 'not_listed', kind: null, reason: null },
        },
        {
          id: PEOPLE.h2,
          name: `Key Two ${RUN}`,
          position: null,
          appearances: 2,
          minutes: 135,
          goals: 0,
          assists: 0,
          availability: { status: 'doubtful', kind: 'injury', reason: 'Hamstring' },
        },
      ]);
      // No rating reaches the page, whatever the feed stored.
      expect(JSON.stringify(body)).not.toContain('rating');
    });

    it('is not supplied for a side whose matches carry no player figures', async () => {
      const body = (await get(ids.match!)).json() as KeyPlayers;
      expect(body.away).toEqual({ coverage: 'not_supplied', last_updated_at: null, data: null });
    });

    it('claims no availability for a match the provider was never asked about', async () => {
      const body = (await get(ids.m4!)).json() as KeyPlayers;
      expect(body.availability_asked_at).toBeNull();
      expect(body.home.data?.players.map((p) => p.availability)).toEqual([null, null, null]);
      expect(body.home.data?.matches_played).toBe(2);
    });
  },
);
