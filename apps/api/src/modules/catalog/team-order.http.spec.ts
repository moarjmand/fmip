import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { TeamPage } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { CatalogModule } from './catalog.module';

/**
 * `GET /teams/:id` lists a club's competitions in the page's order (T-1764,
 * D-379) against the real schema: one club plays a domestic league, a
 * continental competition with a league phase and a domestic cup in knockout
 * rounds, named so that the old order (by name) put the cup first and the
 * league last -- as the EFL Cup came before the Premier League on Arsenal's
 * page -- and only the cup has no table. Two more (code review, 2026-11-07):
 * an international cup with a group stage, whose group tables count, and a
 * continental cup of which only the knockout rounds are stored (D-378's
 * D13), whose missing league phase is missing data, not a format.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const STAGE_NAMES = { league: 'League phase', group: 'Group stage', knockout: 'Third round' };

const ENGLAND = '00000000-0000-4000-8000-000000000101';
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const LEAGUE = { competition: randomUUID(), season: randomUUID(), stage: randomUUID() };
const CONTINENTAL = { competition: randomUUID(), season: randomUUID(), stage: randomUUID() };
const CUP = { competition: randomUUID(), season: randomUUID(), stage: randomUUID() };
const GROUPS = { competition: randomUUID(), season: randomUUID(), stage: randomUUID() };
const KNOCKOUT_ONLY = { competition: randomUUID(), season: randomUUID(), stage: randomUUID() };
const TEAMS = { club: randomUUID(), home: randomUUID(), abroad: randomUUID() };

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  'team page competition order (T-1764)',
  () => {
    let app: NestFastifyApplication;
    let pool: Pool;
    const fixtures: string[] = [];

    async function competition(
      ids: { competition: string; season: string; stage: string },
      name: string,
      kind: 'league' | 'cup',
      scope: 'domestic' | 'continental' | 'international',
      stageKind: 'league' | 'group' | 'knockout',
    ): Promise<void> {
      await pool.query(
        `INSERT INTO competition (id, country_id, name, kind, scope, gender)
         VALUES ($1, $2, $3, $4, $5, 'men')`,
        [ids.competition, scope === 'domestic' ? ENGLAND : null, name, kind, scope],
      );
      await pool.query(
        `INSERT INTO season (id, competition_id, label, start_date, end_date, is_current)
         VALUES ($1, $2, '2026/27', DATE '2026-08-01', DATE '2027-05-31', true)`,
        [ids.season, ids.competition],
      );
      await pool.query(
        `INSERT INTO stage (id, season_id, name, kind, sort_order) VALUES ($1, $2, $3, $4, 1)`,
        [ids.stage, ids.season, STAGE_NAMES[stageKind], stageKind],
      );
    }

    async function played(
      ids: { season: string; stage: string },
      away: string,
      kickoff: string,
      score: [number, number],
      group: string | null = null,
    ): Promise<void> {
      const id = randomUUID();
      fixtures.push(id);
      await pool.query(
        `INSERT INTO fixture (id, season_id, stage_id, kickoff_at, status, group_name)
         VALUES ($1, $2, $3, $4::timestamptz, 'finished', $5)`,
        [id, ids.season, ids.stage, kickoff, group],
      );
      await pool.query(
        `INSERT INTO fixture_participant (fixture_id, team_id, side) VALUES ($1, $2, 'home'), ($1, $3, 'away')`,
        [id, TEAMS.club, away],
      );
      await pool.query(
        `INSERT INTO fixture_score (fixture_id, kind, home, away) VALUES ($1, 'full_time', $2, $3)`,
        [id, score[0], score[1]],
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

      // By name: "A Cup" < "B Continental" < "Z League".
      await competition(LEAGUE, `Z League ${RUN}`, 'league', 'domestic', 'league');
      await competition(CONTINENTAL, `B Continental ${RUN}`, 'cup', 'continental', 'league');
      await competition(CUP, `A Cup ${RUN}`, 'cup', 'domestic', 'knockout');
      await competition(GROUPS, `C Group Cup ${RUN}`, 'cup', 'international', 'group');
      await competition(KNOCKOUT_ONLY, `D Continental ${RUN}`, 'cup', 'continental', 'knockout');
      await pool.query(
        `INSERT INTO team (id, name, kind, gender, country_id) VALUES
           ($1, $4, 'club', 'men', $7), ($2, $5, 'club', 'men', $7), ($3, $6, 'club', 'men', NULL)`,
        [
          TEAMS.club,
          TEAMS.home,
          TEAMS.abroad,
          `Test Order Club ${RUN}`,
          `Test Order Rival ${RUN}`,
          `Test Order Abroad ${RUN}`,
          ENGLAND,
        ],
      );
      await played(LEAGUE, TEAMS.home, '2026-08-20T15:00:00Z', [2, 1]);
      await played(CONTINENTAL, TEAMS.abroad, '2026-09-17T19:00:00Z', [1, 1]);
      await played(CUP, TEAMS.home, '2026-08-27T19:00:00Z', [3, 0]);
      await played(GROUPS, TEAMS.abroad, '2026-09-24T19:00:00Z', [0, 0], 'A');
      await played(KNOCKOUT_ONLY, TEAMS.abroad, '2026-10-01T19:00:00Z', [2, 2]);
    });

    afterAll(async () => {
      await pool.query(`DELETE FROM fixture WHERE id = ANY($1::uuid[])`, [fixtures]);
      for (const ids of [LEAGUE, CONTINENTAL, CUP, GROUPS, KNOCKOUT_ONLY]) {
        await pool.query(`DELETE FROM stage WHERE id = $1`, [ids.stage]);
        await pool.query(`DELETE FROM season WHERE id = $1`, [ids.season]);
        await pool.query(`DELETE FROM competition WHERE id = $1`, [ids.competition]);
      }
      await pool.query(`DELETE FROM entity_alias WHERE entity_id = ANY($1::uuid[])`, [
        Object.values(TEAMS),
      ]);
      await pool.query(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [Object.values(TEAMS)]);
      await pool.end();
      await app.close();
    });

    // The league, then the continental and international ones by name, then the cup.
    const ORDER = () => [
      LEAGUE.competition,
      CONTINENTAL.competition,
      GROUPS.competition,
      KNOCKOUT_ONLY.competition,
      CUP.competition,
    ];

    it('lists the domestic league first, then the continental competitions, then the cup', async () => {
      const response = await app.inject({ method: 'GET', url: `/teams/${TEAMS.club}` });
      expect(response.statusCode).toBe(200);
      const page = response.json() as TeamPage;
      expect(page.competitions.map((c) => c.competition.id)).toEqual(ORDER());
      // Our own fields, the ones the order reads (rule 2: nothing of a provider's).
      expect(page.competitions.map((c) => [c.competition.kind, c.competition.scope])).toEqual([
        ['league', 'domestic'],
        ['cup', 'continental'],
        ['cup', 'international'],
        ['cup', 'continental'],
        ['cup', 'domestic'],
      ]);
      // The season figures and the top scorers follow the same order.
      expect(page.splits.map((s) => s.competition.id)).toEqual(ORDER());
      expect(page.top_scorers?.map((s) => s.competition.id)).toEqual(ORDER());
      // So "the first with a finished match" is the league's 2-1, not the cup's 3-0.
      expect(page.splits[0]!.total).toMatchObject({ played: 1, won: 1, goals_for: 2 });
    });

    it('says which competitions have a table: only the cup played in knockout rounds has none', async () => {
      const page = (
        await app.inject({ method: 'GET', url: `/teams/${TEAMS.club}` })
      ).json() as TeamPage;
      const [league, continental, groups, knockoutOnly, cup] = page.competitions;
      expect(league).toMatchObject({ has_table: true, context: { data: { position: 1 } } });
      // A cup with a league phase has a table and places the club.
      expect(continental).toMatchObject({ has_table: true });
      expect(continental!.context.data).not.toBeNull();
      // A cup with a group stage has its group tables, as its own page draws them.
      expect(groups).toMatchObject({ competition: { id: GROUPS.competition }, has_table: true });
      // A continental cup with only its knockout rounds stored lacks its
      // league phase: a table not supplied (rule 3), never "knockout format".
      expect(knockoutOnly).toMatchObject({
        competition: { id: KNOCKOUT_ONLY.competition },
        has_table: true,
        context: { coverage: 'not_supplied', data: null },
      });
      // A knockout cup has none: its format, not missing data.
      expect(cup).toMatchObject({ has_table: false, context: { data: null } });
    });
  },
);
