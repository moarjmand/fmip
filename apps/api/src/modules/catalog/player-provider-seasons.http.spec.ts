import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { PlayerProviderSeasons } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { CatalogModule } from './catalog.module';
import { providerCoverage } from './internal/player-provider-seasons';

/**
 * `GET /players/:id/provider-seasons` (T-1431, D-223) against the real
 * schema: nothing until the provider was asked, the latest season's lines with
 * the ones our own record counts marked so, the career team by team, and
 * `limited` when the answer named what we do not hold.
 */
const DATABASE_URL = process.env.DATABASE_URL;

describe('providerCoverage (T-1431)', () => {
  it('is not supplied until answered, limited when something was left out', () => {
    expect(providerCoverage(null, 0)).toBe('not_supplied');
    expect(providerCoverage(new Date(), 0)).toBe('available');
    expect(providerCoverage(new Date(), 2)).toBe('limited');
  });
});

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  'a player’s provider seasons (T-1431)',
  () => {
    let app: NestFastifyApplication;
    let pool: Pool;
    const id = {
      league: randomUUID(),
      cup: randomUUID(),
      season: randomUUID(),
      fixture: randomUUID(),
      club: randomUUID(),
      other: randomUUID(),
      national: randomUUID(),
      asked: randomUUID(),
      never: randomUUID(),
      stranger: randomUUID(),
    };

    const get = (person: string) =>
      app.inject({ method: 'GET', url: `/players/${person}/provider-seasons` });

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [DatabaseModule, CatalogModule],
      }).compile();
      app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      pool = new Pool({ connectionString: DATABASE_URL });

      await pool.query(
        `INSERT INTO competition (id, name, short_name, kind, scope, gender) VALUES
           ($1, 'T-1431 League', 'TL', 'league', 'international', 'men'),
           ($2, 'T-1431 Cup', NULL, 'cup', 'international', 'men')`,
        [id.league, id.cup],
      );
      // We ingest the league's season match by match; the cup we do not.
      await pool.query(
        `INSERT INTO season (id, competition_id, label, start_date, end_date, is_current)
         VALUES ($1, $2, '2026/27', '2026-08-01', '2027-05-31', true)`,
        [id.season, id.league],
      );
      await pool.query(
        `INSERT INTO team (id, name, kind, gender) VALUES
           ($1, 'T-1431 Club', 'club', 'men'), ($2, 'T-1431 Old Club', 'club', 'men')`,
        [id.club, id.other],
      );
      await pool.query(
        `INSERT INTO team (id, name, kind, gender, country_id)
         SELECT $1, 'T-1431 Nation', 'national', 'men', id FROM country WHERE code = 'IRN'`,
        [id.national],
      );
      await pool.query(
        `INSERT INTO fixture (id, season_id, kickoff_at, status)
         VALUES ($1, $2, '2026-09-01T15:00:00Z', 'finished')`,
        [id.fixture, id.season],
      );
      await pool.query(
        `INSERT INTO person (id, full_name) VALUES
           ($1, 'T-1431 Asked'), ($2, 'T-1431 Never'), ($3, 'T-1431 Stranger')`,
        [id.asked, id.never, id.stranger],
      );
      // Our record holds the asked player's line-up in the league; the
      // stranger played in that league too, but in no match we hold.
      await pool.query(
        `WITH p AS (
           INSERT INTO fixture_participant (fixture_id, team_id, side)
           VALUES ($1, $2, 'home'), ($1, $3, 'away') RETURNING id, side)
         INSERT INTO lineup (participant_id, person_id, role)
         SELECT p.id, $4, 'starter' FROM p WHERE p.side = 'home'`,
        [id.fixture, id.club, id.other, id.asked],
      );
      await pool.query(
        `INSERT INTO player_season_stat
           (source, person_id, season_year, competition_id, team_id, appearances, fetched_at)
         VALUES ('api_football', $1, 2026, $2, $3, 4, now())`,
        [id.stranger, id.league, id.other],
      );
      await pool.query(
        `INSERT INTO player_season_fetch
           (provider, person_id, season_year, answered_at, lines, kept, unmapped)
         VALUES ('api_football', $1, 2026, now(), 1, 1, 0)`,
        [id.stranger],
      );
      await pool.query(
        `INSERT INTO player_season_stat
           (source, person_id, season_year, competition_id, team_id, appearances, starts, minutes,
            goals, assists, yellow_cards, second_yellow_cards, red_cards, rating, fetched_at)
         VALUES
           ('api_football', $1, 2026, $2, $4, 9, 8, 731, 6, NULL, 1, 0, 0, 7.43, now()),
           ('api_football', $1, 2026, $3, $4, 2, 2, 180, 1, 1, NULL, NULL, NULL, NULL, now()),
           ('api_football', $1, 2025, $3, $5, 30, 28, 2500, 12, 5, 3, 0, 1, 7.1, now())`,
        [id.asked, id.league, id.cup, id.club, id.other],
      );
      await pool.query(
        `INSERT INTO player_season_fetch
           (provider, person_id, season_year, answered_at, lines, kept, unmapped) VALUES
           ('api_football', $1, 2026, '2026-10-20T06:00:00Z', 4, 2, 2),
           ('api_football', $1, 2025, '2026-10-19T06:00:00Z', 1, 1, 0)`,
        [id.asked],
      );
      await pool.query(
        `INSERT INTO player_career_season (source, person_id, team_id, season_year, fetched_at)
         VALUES ('api_football', $1, $2, 2026, now()), ('api_football', $1, $2, 2025, now()),
                ('api_football', $1, $3, 2024, now()), ('api_football', $1, $4, 2026, now()),
                ('api_football', $1, $4, 2019, now())`,
        [id.asked, id.club, id.other, id.national],
      );
      await pool.query(
        `INSERT INTO player_career_fetch (provider, person_id, answered_at, teams, kept, unmapped)
         VALUES ('api_football', $1, '2026-10-18T06:00:00Z', 3, 3, 0)`,
        [id.asked],
      );
    });

    afterAll(async () => {
      if (pool !== undefined) {
        await pool.query(`DELETE FROM fixture WHERE id = $1`, [id.fixture]);
        await pool.query(`DELETE FROM person WHERE id = ANY($1::uuid[])`, [
          [id.asked, id.never, id.stranger],
        ]);
        await pool.query(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [
          [id.club, id.other, id.national],
        ]);
        await pool.query(`DELETE FROM season WHERE id = $1`, [id.season]);
        await pool.query(`DELETE FROM competition WHERE id = ANY($1::uuid[])`, [
          [id.league, id.cup],
        ]);
        await pool.end();
      }
      await app?.close();
    });

    it('is 404 for no such player', async () => {
      expect((await get(randomUUID())).statusCode).toBe(404);
      expect((await get('not-a-uuid')).statusCode).toBe(404);
    });

    it('says not supplied for a player the provider was never asked about', async () => {
      const res = await get(id.never);
      expect(res.statusCode).toBe(200);
      expect(res.json<PlayerProviderSeasons>()).toEqual({
        source_name: 'API-Football',
        seasons: { coverage: 'not_supplied', last_updated_at: null, data: null },
        career: { coverage: 'not_supplied', last_updated_at: null, data: null },
      });
    });

    it('gives the latest season, the lines our record does not count first, limited when some were left out', async () => {
      const body = (await get(id.asked)).json<PlayerProviderSeasons>();
      expect(body.seasons.coverage).toBe('limited');
      expect(body.seasons.last_updated_at).toBe('2026-10-20T06:00:00.000Z');
      expect(body.seasons.data?.unlisted).toBe(2);
      expect(body.seasons.data?.lines).toEqual([
        {
          season: { year: 2026, label: null },
          competition: { id: id.cup, name: 'T-1431 Cup', short_name: null },
          team: { id: id.club, name: 'T-1431 Club', short_name: null },
          counted_by_us: false,
          appearances: 2,
          starts: 2,
          minutes: 180,
          goals: 1,
          assists: 1,
          yellow_cards: null,
          second_yellow_cards: null,
          red_cards: null,
          saves: null,
          goals_conceded: null,
          rating: null,
        },
        expect.objectContaining({
          season: { year: 2026, label: '2026/27' },
          competition: { id: id.league, name: 'T-1431 League', short_name: 'TL' },
          counted_by_us: true,
          appearances: 9,
          assists: null,
          rating: 7.43,
        }),
      ]);
    });

    it('does not count a competition as ours for a player our record holds no line-up for', async () => {
      const body = (await get(id.stranger)).json<PlayerProviderSeasons>();
      expect(body.seasons.coverage).toBe('available');
      expect(body.seasons.data?.lines).toEqual([
        expect.objectContaining({
          competition: { id: id.league, name: 'T-1431 League', short_name: 'TL' },
          counted_by_us: false,
          appearances: 4,
          goals: null,
        }),
      ]);
    });

    it('lists the career team by team, the latest first, each with its seasons newest first', async () => {
      const body = (await get(id.asked)).json<PlayerProviderSeasons>();
      expect(body.career).toEqual({
        coverage: 'available',
        last_updated_at: '2026-10-18T06:00:00.000Z',
        data: {
          unlisted: 0,
          teams: [
            {
              team: { id: id.club, name: 'T-1431 Club', short_name: null },
              season_years: [2026, 2025],
            },
            {
              team: { id: id.national, name: 'T-1431 Nation', short_name: null },
              season_years: [2026, 2019],
            },
            {
              team: { id: id.other, name: 'T-1431 Old Club', short_name: null },
              season_years: [2024],
            },
          ],
        },
      });
    });
  },
);
