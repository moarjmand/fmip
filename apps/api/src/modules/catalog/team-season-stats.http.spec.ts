import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { TeamSeasonStats } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { CatalogModule } from './catalog.module';
import {
  lineCoverage,
  seasonCount,
  toLine,
  type TeamSeasonStatRow,
} from './internal/team-season-stats';

/**
 * `GET /teams/:id/season-stats` (T-1437, D-228) against the real schema:
 * nothing until the provider was asked, then the stored season whole, the
 * seasons to choose from, `?season=` picking one, and `limited` where the
 * provider left part out or its minute bands were withheld.
 */
const DATABASE_URL = process.env.DATABASE_URL;

const ROW: TeamSeasonStatRow = {
  played_home: 19,
  played_away: 19,
  wins_home: 13,
  wins_away: 7,
  draws_home: 3,
  draws_away: 8,
  losses_home: 3,
  losses_away: 4,
  goals_for_home: 39,
  goals_for_away: 30,
  goals_against_home: 24,
  goals_against_away: 26,
  clean_sheets_home: 4,
  clean_sheets_away: 4,
  failed_to_score_home: 2,
  failed_to_score_away: 2,
  form: 'WDLWW',
  goals_for_by_minute: [{ from: 0, to: 15, goals: 9 }],
  goals_against_by_minute: [{ from: 76, to: 90, goals: 15 }],
  bands_withheld: false,
  penalties_scored: 4,
  penalties_missed: 0,
  biggest: {
    win: { home: { for: 4, against: 2 }, away: null },
    defeat: { home: null, away: { for: 0, against: 3 } },
    run: { wins: 4, draws: 3, losses: 1 },
  },
  formations: [{ formation: '4-2-3-1', played: 20 }],
  fetched_at: new Date('2026-10-21T10:00:00Z'),
};

describe('the season statistics line (T-1437)', () => {
  it('sums home and away only when both are known', () => {
    expect(seasonCount(3, 4)).toEqual({ home: 3, away: 4, total: 7 });
    expect(seasonCount(3, null)).toEqual({ home: 3, away: null, total: null });
  });

  it('is available whole, limited with a part left out or the bands withheld', () => {
    expect(lineCoverage(toLine(ROW))).toBe('available');
    expect(lineCoverage(toLine({ ...ROW, clean_sheets_home: null }))).toBe('limited');
    expect(lineCoverage(toLine({ ...ROW, form: null }))).toBe('limited');
    expect(
      lineCoverage(
        toLine({
          ...ROW,
          bands_withheld: true,
          goals_for_by_minute: null,
          goals_against_by_minute: null,
          penalties_scored: null,
          penalties_missed: null,
        }),
      ),
    ).toBe('limited');
  });

  it('reads a biggest result the row lacks as none', () => {
    const line = toLine({ ...ROW, biggest: {} });
    expect(line.biggest_win).toEqual({ home: null, away: null });
    expect(line.longest_run).toEqual({ wins: null, draws: null, losses: null });
  });
});

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  'a team’s season statistics (T-1437)',
  () => {
    let app: NestFastifyApplication;
    let pool: Pool;
    const id = {
      league: randomUUID(),
      cup: randomUUID(),
      current: randomUUID(),
      past: randomUUID(),
      cupSeason: randomUUID(),
      team: randomUUID(),
      rival: randomUUID(),
      idle: randomUUID(),
      fixtures: [randomUUID(), randomUUID(), randomUUID()],
    };
    const get = (team: string, season?: string) =>
      app.inject({
        method: 'GET',
        url: `/teams/${team}/season-stats${season === undefined ? '' : `?season=${season}`}`,
      });

    async function store(teamId: string, seasonId: string, row: Partial<TeamSeasonStatRow>) {
      const r = { ...ROW, ...row };
      await pool.query(
        `INSERT INTO team_season_stat
           (source, team_id, season_id, played_home, played_away, wins_home, wins_away,
            draws_home, draws_away, losses_home, losses_away, goals_for_home, goals_for_away,
            goals_against_home, goals_against_away, clean_sheets_home, clean_sheets_away,
            failed_to_score_home, failed_to_score_away, form, goals_for_by_minute,
            goals_against_by_minute, bands_withheld, penalties_scored, penalties_missed,
            biggest, formations, fetched_at)
         VALUES ('api_football', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
                 $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27)`,
        [
          teamId,
          seasonId,
          r.played_home,
          r.played_away,
          r.wins_home,
          r.wins_away,
          r.draws_home,
          r.draws_away,
          r.losses_home,
          r.losses_away,
          r.goals_for_home,
          r.goals_for_away,
          r.goals_against_home,
          r.goals_against_away,
          r.clean_sheets_home,
          r.clean_sheets_away,
          r.failed_to_score_home,
          r.failed_to_score_away,
          r.form,
          r.goals_for_by_minute === null ? null : JSON.stringify(r.goals_for_by_minute),
          r.goals_against_by_minute === null ? null : JSON.stringify(r.goals_against_by_minute),
          r.bands_withheld,
          r.penalties_scored,
          r.penalties_missed,
          JSON.stringify(r.biggest),
          JSON.stringify(r.formations),
          r.fetched_at,
        ],
      );
      await answered(teamId, seasonId, true);
    }
    async function answered(teamId: string, seasonId: string, supplied: boolean) {
      await pool.query(
        `INSERT INTO team_season_fetch (provider, team_id, season_id, failures, answered_at, supplied)
         VALUES ('api_football', $1, $2, 0, '2026-10-21T10:00:00Z', $3)`,
        [teamId, seasonId, supplied],
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
        `INSERT INTO competition (id, name, short_name, kind, scope, gender) VALUES
           ($1, 'T-1437 League', 'TL', 'league', 'international', 'men'),
           ($2, 'T-1437 Cup', NULL, 'cup', 'international', 'men')`,
        [id.league, id.cup],
      );
      await pool.query(
        `INSERT INTO season (id, competition_id, label, start_date, end_date, is_current) VALUES
           ($1, $4, '2026/27', '2026-08-01', '2027-05-31', true),
           ($2, $4, '2024/25', '2024-08-01', '2025-05-31', false),
           ($3, $5, '2026/27', '2026-08-01', '2027-05-31', true)`,
        [id.current, id.past, id.cupSeason, id.league, id.cup],
      );
      await pool.query(
        `INSERT INTO team (id, name, kind, gender) VALUES
           ($1, 'T-1437 Team', 'club', 'men'), ($2, 'T-1437 Rival', 'club', 'men'),
           ($3, 'T-1437 Idle', 'club', 'men')`,
        [id.team, id.rival, id.idle],
      );
      const [f1, f2, f3] = id.fixtures;
      await pool.query(
        `INSERT INTO fixture (id, season_id, kickoff_at, status) VALUES
           ($1, $4, '2026-09-01T15:00:00Z', 'finished'),
           ($2, $5, '2025-03-01T15:00:00Z', 'finished'),
           ($3, $6, '2026-09-20T15:00:00Z', 'finished')`,
        [f1, f2, f3, id.current, id.past, id.cupSeason],
      );
      await pool.query(
        `INSERT INTO fixture_participant (fixture_id, team_id, side) VALUES
           ($1, $4, 'home'), ($1, $5, 'away'), ($2, $4, 'home'), ($2, $5, 'away'),
           ($3, $4, 'home'), ($3, $5, 'away')`,
        [f1, f2, f3, id.team, id.rival],
      );
    });

    afterAll(async () => {
      if (pool === undefined) return;
      await pool.query(`DELETE FROM fixture WHERE id = ANY($1::uuid[])`, [id.fixtures]);
      await pool.query(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [
        [id.team, id.rival, id.idle],
      ]);
      await pool.query(`DELETE FROM season WHERE id = ANY($1::uuid[])`, [
        [id.current, id.past, id.cupSeason],
      ]);
      await pool.query(`DELETE FROM competition WHERE id = ANY($1::uuid[])`, [[id.league, id.cup]]);
      await pool.end();
      await app?.close();
    });

    it('is a 404 for no such team', async () => {
      expect((await get(randomUUID())).statusCode).toBe(404);
      expect((await get('not-a-uuid')).statusCode).toBe(404);
    });

    it('says nothing was asked yet, on the latest season the team played', async () => {
      const body = (await get(id.team)).json<TeamSeasonStats>();
      expect(body.source_name).toBe('API-Football');
      expect(body.seasons).toEqual([]);
      expect(body.selected?.is_current).toBe(true);
      expect(body.asked).toBe(false);
      expect(body.stats).toEqual({ coverage: 'not_supplied', last_updated_at: null, data: null });
      // A team that played nowhere has no season at all.
      const idle = (await get(id.idle)).json<TeamSeasonStats>();
      expect(idle.selected).toBeNull();
    });

    it('serves the stored season whole, current first, and another on asking', async () => {
      await store(id.team, id.current, {});
      await store(id.team, id.past, {
        bands_withheld: true,
        goals_for_by_minute: null,
        goals_against_by_minute: null,
        penalties_scored: null,
        penalties_missed: null,
      });
      await answered(id.team, id.cupSeason, false);

      const body = (await get(id.team)).json<TeamSeasonStats>();
      expect(body.seasons.map((s) => [s.season_id, s.label, s.competition.short_name])).toEqual([
        [id.current, '2026/27', 'TL'],
        [id.past, '2024/25', 'TL'],
      ]);
      expect(body.selected?.season_id).toBe(id.current);
      expect(body.asked).toBe(true);
      expect(body.stats.coverage).toBe('available');
      expect(body.stats.last_updated_at).toBe('2026-10-21T10:00:00.000Z');
      expect(body.stats.data?.goals_for).toEqual({ home: 39, away: 30, total: 69 });
      expect(body.stats.data?.biggest_defeat).toEqual({ home: null, away: { for: 0, against: 3 } });
      expect(body.stats.data?.formations).toEqual([{ formation: '4-2-3-1', played: 20 }]);

      const past = (await get(id.team, id.past)).json<TeamSeasonStats>();
      expect(past.selected?.season_id).toBe(id.past);
      expect(past.stats.coverage).toBe('limited');
      expect(past.stats.data?.bands_withheld).toBe(true);
      expect(past.stats.data?.penalties).toEqual({ scored: null, missed: null });
    });

    it('says the provider has nothing for a season it answered empty', async () => {
      const cup = (await get(id.team, id.cupSeason)).json<TeamSeasonStats>();
      expect(cup.selected?.competition.name).toBe('T-1437 Cup');
      expect(cup.asked).toBe(true);
      expect(cup.stats).toEqual({
        coverage: 'not_supplied',
        last_updated_at: '2026-10-21T10:00:00.000Z',
        data: null,
      });
    });

    it('falls back to the first season for one the team did not play in', async () => {
      const body = (await get(id.team, randomUUID())).json<TeamSeasonStats>();
      expect(body.selected?.season_id).toBe(id.current);
      const rival = (await get(id.rival, id.past)).json<TeamSeasonStats>();
      expect(rival.selected?.season_id).toBe(id.past);
      expect(rival.asked).toBe(false);
    });
  },
);
