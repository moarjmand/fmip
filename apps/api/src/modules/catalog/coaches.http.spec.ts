import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { CoachPage, TeamPage } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { CatalogModule } from './catalog.module';

/**
 * `GET /coaches/:id` and the team page's `head_coach` (T-1439, D-230) against
 * the real schema: a coach page for a person the provider described as a
 * coach or a line-up named so, 404 for anyone else, the career with crests
 * and its coverage, and the team page's head coach once the team's coaches
 * were answered, told apart from the line-up's coach.
 */
const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  'coaches over HTTP (T-1439)',
  () => {
    let app: NestFastifyApplication;
    let pool: Pool;
    const id = {
      league: randomUUID(),
      season: randomUUID(),
      fixture: randomUUID(),
      club: randomUUID(),
      old: randomUUID(),
      coach: randomUUID(),
      before: randomUUID(),
      player: randomUUID(),
    };

    const get = <T>(url: string) =>
      app.inject({ method: 'GET', url }).then((r) => ({ status: r.statusCode, body: r.json<T>() }));

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
         VALUES ($1, 'T-1439 League', 'league', 'international', 'men')`,
        [id.league],
      );
      await pool.query(
        `INSERT INTO season (id, competition_id, label, start_date, end_date, is_current)
         VALUES ($1, $2, '2026/27', '2026-08-01', '2027-05-31', true)`,
        [id.season, id.league],
      );
      await pool.query(
        `INSERT INTO team (id, name, kind, gender) VALUES
           ($1, 'T-1439 Club', 'club', 'men'), ($2, 'T-1439 Old Club', 'club', 'men')`,
        [id.club, id.old],
      );
      await pool.query(
        `INSERT INTO person (id, full_name) VALUES
           ($1, 'T-1439 Coach'), ($2, 'T-1439 Before'), ($3, 'T-1439 Player')`,
        [id.coach, id.before, id.player],
      );
      await pool.query(
        `INSERT INTO fixture (id, season_id, kickoff_at, status)
         VALUES ($1, $2, now() - interval '3 days', 'finished')`,
        [id.fixture, id.season],
      );
      // The latest line-up still names the coach before.
      await pool.query(
        `INSERT INTO fixture_participant (fixture_id, team_id, side, coach_id)
         VALUES ($1, $2, 'home', $3)`,
        [id.fixture, id.club, id.before],
      );
    });

    afterAll(async () => {
      if (pool !== undefined) {
        await pool.query(`DELETE FROM fixture WHERE id = $1`, [id.fixture]);
        await pool.query(`DELETE FROM person WHERE id = ANY($1::uuid[])`, [
          [id.coach, id.before, id.player],
        ]);
        await pool.query(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [[id.club, id.old]]);
        await pool.query(`DELETE FROM season WHERE id = $1`, [id.season]);
        await pool.query(`DELETE FROM competition WHERE id = $1`, [id.league]);
        await pool.end();
      }
      await app?.close();
    });

    it('has no head coach until the team was answered, and no page for a non-coach', async () => {
      const team = await get<TeamPage>(`/teams/${id.club}`);
      expect(team.status).toBe(200);
      expect(team.body.head_coach).toEqual({
        coverage: 'not_supplied',
        last_updated_at: null,
        data: null,
      });
      expect(team.body.manager.coach.data?.id).toBe(id.before);

      expect((await get(`/coaches/${id.player}`)).status).toBe(404);
      expect((await get(`/coaches/${randomUUID()}`)).status).toBe(404);
      expect((await get(`/coaches/not-a-uuid`)).status).toBe(404);

      // Named on a line-up only: a page, with no career yet.
      const named = await get<CoachPage>(`/coaches/${id.before}`);
      expect(named.status).toBe(200);
      expect(named.body.career).toEqual({
        coverage: 'not_supplied',
        last_updated_at: null,
        data: null,
      });
      expect(named.body.lineups.count).toBe(1);
      expect(named.body.lineups.latest?.team).toEqual({ id: id.club, name: 'T-1439 Club' });
    });

    it('reads the answered careers: the head coach, the coach page, and the line-up told apart', async () => {
      await pool.query(
        `INSERT INTO coach_spell (source, person_id, team_id, start_date, end_date, fetched_at) VALUES
           ('api_football', $1, $3, '2026-08-01', NULL, now()),
           ('api_football', $1, $4, '2020-07-01', '2024-06-01', now()),
           ('api_football', $2, $3, '2016-07-01', NULL, now())`,
        [id.coach, id.before, id.club, id.old],
      );
      await pool.query(
        `INSERT INTO coach_fetch (source, person_id, fetched_at, spells_listed, spells_kept, spells_unmapped)
         VALUES ('api_football', $1, now(), 3, 2, 1), ('api_football', $2, now(), 1, 1, 0)`,
        [id.coach, id.before],
      );
      await pool.query(
        `INSERT INTO team_coach_fetch (source, team_id, asked_at, answered_at, coaches_listed,
                                       coaches_kept, coaches_unmapped)
         VALUES ('api_football', $1, now(), now(), 2, 2, 0)`,
        [id.club],
      );

      const team = await get<TeamPage>(`/teams/${id.club}`);
      expect(team.body.head_coach).toMatchObject({
        coverage: 'available',
        data: {
          person: { id: id.coach, name: 'T-1439 Coach', photo: { coverage: 'not_supplied' } },
          since: '2026-08-01',
          lineup_disagrees: true,
        },
      });

      const page = await get<CoachPage>(`/coaches/${id.coach}`);
      expect(page.status).toBe(200);
      expect(page.body.coach).toMatchObject({ id: id.coach, name: 'T-1439 Coach' });
      expect(page.body.career.coverage).toBe('limited');
      expect(page.body.spells_not_carried).toBe(1);
      expect(
        page.body.career.data?.map((s) => [s.team.id, s.start_date, s.end_date, s.current]),
      ).toEqual([
        [id.club, '2026-08-01', null, true],
        [id.old, '2020-07-01', '2024-06-01', false],
      ]);
      expect(page.body.career.data?.[0]?.team.crest).toEqual({
        coverage: 'not_supplied',
        url: null,
      });

      // The coach before: his open spell is no longer the latest at the club.
      const before = await get<CoachPage>(`/coaches/${id.before}`);
      expect(before.body.career.data?.map((s) => s.current)).toEqual([false]);
    });
  },
);
