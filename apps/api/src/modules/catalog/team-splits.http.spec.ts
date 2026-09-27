import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { TeamPage } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { CatalogModule } from './catalog.module';

// T-632 against the real schema: a league and a cup, each with a current
// season. Alpha wins at home and draws away in the league, and goes through
// a cup tie on penalties after extra time. Statistics are stored for some
// matches only, so one average is complete and one is not.
const DATABASE_URL = process.env.DATABASE_URL;

const ENGLAND = '00000000-0000-4000-8000-000000000101';
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const LEAGUE = randomUUID();
const CUP = randomUUID();
const LEAGUE_SEASON = randomUUID();
const CUP_SEASON = randomUUID();
const TEAMS = { alpha: randomUUID(), beta: randomUUID(), gamma: randomUUID() };

type Scores = [kind: string, home: number, away: number][];

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('team page splits', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  const fixtures: string[] = [];

  async function fixture(
    season: string,
    home: string,
    away: string,
    kickoff: string,
    scores: Scores | null,
    stats: { home?: Record<string, number>; away?: Record<string, number> } = {},
  ): Promise<string> {
    const id = randomUUID();
    fixtures.push(id);
    await pool.query(
      `INSERT INTO fixture (id, season_id, kickoff_at, status) VALUES ($1, $2, $3::timestamptz, $4)`,
      [id, season, kickoff, scores === null ? 'scheduled' : 'finished'],
    );
    const { rows } = await pool.query<{ id: string; side: 'home' | 'away' }>(
      `INSERT INTO fixture_participant (fixture_id, team_id, side)
       VALUES ($1, $2, 'home'), ($1, $3, 'away') RETURNING id, side`,
      [id, home, away],
    );
    for (const [kind, h, a] of scores ?? []) {
      await pool.query(
        `INSERT INTO fixture_score (fixture_id, kind, home, away) VALUES ($1, $2, $3, $4)`,
        [id, kind, h, a],
      );
    }
    for (const row of rows) {
      for (const [metric, value] of Object.entries(stats[row.side] ?? {})) {
        await pool.query(
          `INSERT INTO fixture_stat (participant_id, metric, value) VALUES ($1, $2, $3)`,
          [row.id, metric, value],
        );
      }
    }
    return id;
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
      `INSERT INTO competition (id, country_id, name, kind, scope, gender) VALUES
         ($1, $3, $4, 'league', 'domestic', 'men'),
         ($2, $3, $5, 'cup', 'domestic', 'men')`,
      [LEAGUE, CUP, ENGLAND, `Splits League ${RUN}`, `Splits Cup ${RUN}`],
    );
    await pool.query(
      `INSERT INTO season (id, competition_id, label, start_date, end_date, is_current) VALUES
         ($1, $2, '2025/26', DATE '2025-08-01', DATE '2026-05-31', true),
         ($3, $4, '2025/26', DATE '2025-08-01', DATE '2026-05-31', true)`,
      [LEAGUE_SEASON, LEAGUE, CUP_SEASON, CUP],
    );
    await pool.query(
      `INSERT INTO team (id, name, kind, gender, country_id) VALUES
         ($1, $4, 'club', 'men', $7), ($2, $5, 'club', 'men', $7), ($3, $6, 'club', 'men', $7)`,
      [
        TEAMS.alpha,
        TEAMS.beta,
        TEAMS.gamma,
        `Splits Alpha ${RUN}`,
        `Splits Beta ${RUN}`,
        `Splits Gamma ${RUN}`,
        ENGLAND,
      ],
    );

    // League: alpha beat beta 2-0 at home (shots and possession stored),
    // drew 1-1 at gamma (possession only), and play beta again later.
    await fixture(
      LEAGUE_SEASON,
      TEAMS.alpha,
      TEAMS.beta,
      '2025-09-01T15:00:00Z',
      [['full_time', 2, 0]],
      { home: { shots: 14, possession_pct: 58 }, away: { shots: 3, possession_pct: 42 } },
    );
    await fixture(
      LEAGUE_SEASON,
      TEAMS.gamma,
      TEAMS.alpha,
      '2025-09-08T15:00:00Z',
      [['full_time', 1, 1]],
      { home: { shots: 11, possession_pct: 50 }, away: { possession_pct: 50 } },
    );
    await fixture(LEAGUE_SEASON, TEAMS.beta, TEAMS.alpha, '2099-01-01T15:00:00Z', null);
    // Cup: 1-1 after ninety minutes, 2-2 after extra time, alpha through 4-3 on penalties.
    await fixture(CUP_SEASON, TEAMS.gamma, TEAMS.alpha, '2025-10-01T19:00:00Z', [
      ['full_time', 1, 1],
      ['extra_time', 1, 1],
      ['current', 2, 2],
      ['penalties', 3, 4],
    ]);
    // Cup: 1-1 after ninety minutes, alpha win 2-1 after extra time at home.
    await fixture(CUP_SEASON, TEAMS.alpha, TEAMS.beta, '2025-10-20T19:00:00Z', [
      ['full_time', 1, 1],
      ['extra_time', 1, 0],
      ['current', 2, 1],
    ]);
    // A cup match alpha is not in.
    await fixture(CUP_SEASON, TEAMS.beta, TEAMS.gamma, '2025-10-02T19:00:00Z', [
      ['full_time', 5, 0],
    ]);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM fixture WHERE id = ANY($1::uuid[])`, [fixtures]);
    await pool.query(`DELETE FROM season WHERE id = ANY($1::uuid[])`, [
      [LEAGUE_SEASON, CUP_SEASON],
    ]);
    await pool.query(`DELETE FROM competition WHERE id = ANY($1::uuid[])`, [[LEAGUE, CUP]]);
    await pool.query(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [Object.values(TEAMS)]);
    await pool.end();
    await app.close();
  });

  async function page(): Promise<TeamPage> {
    const response = await app.inject({ method: 'GET', url: `/teams/${TEAMS.alpha}` });
    expect(response.statusCode).toBe(200);
    return response.json() as TeamPage;
  }

  it('gives one entry per competition, in the order of the competitions', async () => {
    const p = await page();
    expect(p.splits.map((s) => s.competition.id)).toEqual(
      p.competitions.map((c) => c.competition.id),
    );
    expect(new Set(p.splits.map((s) => s.competition.id))).toEqual(new Set([LEAGUE, CUP]));
  });

  it('splits the league home and away from finished matches only', async () => {
    const league = (await page()).splits.find((s) => s.competition.id === LEAGUE)!;
    expect(league.home).toEqual({
      played: 1,
      won: 1,
      drawn: 0,
      lost: 0,
      goals_for: 2,
      goals_against: 0,
      clean_sheets: 1,
    });
    expect(league.away).toEqual({
      played: 1,
      won: 0,
      drawn: 1,
      lost: 0,
      goals_for: 1,
      goals_against: 1,
      clean_sheets: 0,
    });
    expect(league.total).toMatchObject({ played: 2, won: 1, drawn: 1, goals_for: 3 });
    expect(league.finished_without_score).toBe(0);
    expect(league.last_updated_at).not.toBeNull();

    // Possession is stored for alpha in both matches; shots only at home.
    const possession = league.averages.find((a) => a.metric === 'possession_pct')!;
    expect(possession).toMatchObject({ coverage: 'available', home: 58, away: 50, total: 54 });
    const shots = league.averages.find((a) => a.metric === 'shots')!;
    expect(shots).toMatchObject({ coverage: 'limited', home: 14, away: null, total: null });
    const xg = league.averages.find((a) => a.metric === 'expected_goals')!;
    expect(xg.coverage).toBe('not_supplied');
  });

  it('counts a cup tie won on penalties as a draw, with extra-time goals and no shoot-out goals', async () => {
    const cup = (await page()).splits.find((s) => s.competition.id === CUP)!;
    expect(cup.away).toMatchObject({
      played: 1,
      won: 0,
      drawn: 1,
      lost: 0,
      goals_for: 2,
      goals_against: 2,
    });
    expect(cup.home).toMatchObject({ played: 1, won: 1, goals_for: 2, goals_against: 1 });
    expect(cup.penalty_shootouts).toBe(1);
    expect(cup.averages.every((a) => a.coverage === 'not_supplied')).toBe(true);
  });

  it('lists results with the score after extra time, so the list agrees with the figures', async () => {
    const p = await page();
    const cupResults = p.results.filter((f) => f.competition.id === CUP);
    // Newest first: the extra-time win, then the tie won on penalties.
    expect(cupResults.map((f) => [f.score, f.after_extra_time, f.penalties])).toEqual([
      [{ home: 2, away: 1 }, true, null],
      [{ home: 2, away: 2 }, true, { home: 3, away: 4 }],
    ]);
    const league = p.results.find((f) => f.competition.id === LEAGUE)!;
    expect(league).toMatchObject({ after_extra_time: false, penalties: null });
  });
});
