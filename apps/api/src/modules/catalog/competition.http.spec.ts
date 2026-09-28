import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { ApiError, CompetitionPage } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { CatalogModule } from './catalog.module';

// The competition page against the real schema: a temporary competition with
// two seasons, three clubs, finished and scheduled matches and recorded
// goals. Acceptance: the season selector works and the modules are honest
// about coverage.
const DATABASE_URL = process.env.DATABASE_URL;

const ENGLAND = '00000000-0000-4000-8000-000000000101';
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const COMPETITION = randomUUID();
const OLD_SEASON = randomUUID();
const NEW_SEASON = randomUUID();
const OLD_STAGE = randomUUID();
const NEW_STAGE = randomUUID();
const TEAMS = { alpha: randomUUID(), beta: randomUUID(), gamma: randomUUID() };
const SCORER = randomUUID();
const OTHER_SCORER = randomUUID();
const CUP = randomUUID();
const CUP_SEASON = randomUUID();

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('competition page', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  const fixtures: string[] = [];

  async function fixture(
    seasonId: string,
    stageId: string,
    home: string,
    away: string,
    kickoff: string,
    score: [number, number] | null,
    goals: { person: string; side: 'home' | 'away'; count: number }[] = [],
  ): Promise<string> {
    const id = randomUUID();
    fixtures.push(id);
    await pool.query(
      `INSERT INTO fixture (id, season_id, stage_id, round, kickoff_at, status)
       VALUES ($1, $2, $3, 'Matchday', $4::timestamptz, $5)`,
      [id, seasonId, stageId, kickoff, score === null ? 'scheduled' : 'finished'],
    );
    const participants = await pool.query<{ id: string; side: 'home' | 'away' }>(
      `INSERT INTO fixture_participant (fixture_id, team_id, side)
       VALUES ($1, $2, 'home'), ($1, $3, 'away') RETURNING id, side`,
      [id, home, away],
    );
    if (score !== null) {
      await pool.query(
        `INSERT INTO fixture_score (fixture_id, kind, home, away) VALUES ($1, 'full_time', $2, $3)`,
        [id, score[0], score[1]],
      );
    }
    for (const goal of goals) {
      const participant = participants.rows.find((p) => p.side === goal.side)!.id;
      for (let i = 0; i < goal.count; i += 1) {
        await pool.query(
          `INSERT INTO incident (fixture_id, participant_id, person_id, kind, minute, sequence)
           VALUES ($1, $2, $3, 'goal', $4, $5)`,
          [id, participant, goal.person, 10 + i, goals.indexOf(goal) * 10 + i + 1],
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
      `INSERT INTO competition (id, country_id, name, short_name, kind, scope, gender)
       VALUES ($1, $2, $3, 'TL', 'league', 'domestic', 'men')`,
      [COMPETITION, ENGLAND, `Test League ${RUN}`],
    );
    await pool.query(
      `INSERT INTO season (id, competition_id, label, start_date, end_date, is_current) VALUES
         ($1, $3, '2024/25', DATE '2024-08-01', DATE '2025-05-31', false),
         ($2, $3, '2025/26', DATE '2025-08-01', DATE '2026-05-31', true)`,
      [OLD_SEASON, NEW_SEASON, COMPETITION],
    );
    await pool.query(
      `INSERT INTO stage (id, season_id, name, kind, sort_order) VALUES
         ($1, $3, 'Regular season', 'league', 1), ($2, $4, 'Regular season', 'league', 1)`,
      [OLD_STAGE, NEW_STAGE, OLD_SEASON, NEW_SEASON],
    );
    await pool.query(
      `INSERT INTO team (id, name, short_name, kind, gender) VALUES
         ($1, $4, 'ALP', 'club', 'men'), ($2, $5, 'BET', 'club', 'men'), ($3, $6, NULL, 'club', 'men')`,
      [
        TEAMS.alpha,
        TEAMS.beta,
        TEAMS.gamma,
        `Test Alpha ${RUN}`,
        `Test Beta ${RUN}`,
        `Test Gamma ${RUN}`,
      ],
    );
    await pool.query(
      `INSERT INTO person (id, full_name, known_as) VALUES ($1, 'Test Scorer ${RUN}', 'Scorer'), ($2, 'Test Other ${RUN}', NULL)`,
      [SCORER, OTHER_SCORER],
    );
    // The new season declares what it covers; the old one declares nothing.
    await pool.query(
      `INSERT INTO coverage_profile (season_id, module, state, provider) VALUES
         ($1, 'scores', 'available', 'api_football'), ($1, 'standings', 'available', 'api_football'),
         ($1, 'incidents', 'available', 'api_football')`,
      [NEW_SEASON],
    );

    // New season: alpha beat beta 3-1 (scorer ×2, other ×1 for alpha; other... beta's goal by other),
    // gamma drew with alpha 0-0, beta v gamma next week.
    const opener = await fixture(
      NEW_SEASON,
      NEW_STAGE,
      TEAMS.alpha,
      TEAMS.beta,
      '2025-09-01T15:00:00Z',
      [3, 1],
      [
        { person: SCORER, side: 'home', count: 2 },
        { person: OTHER_SCORER, side: 'home', count: 1 },
      ],
    );
    const draw = await fixture(
      NEW_SEASON,
      NEW_STAGE,
      TEAMS.gamma,
      TEAMS.alpha,
      '2025-09-08T15:00:00Z',
      [0, 0],
    );
    // T-824: the scorer started both and the feed sent 90 minutes each time;
    // the other scorer started the opener and the feed sent no minutes.
    const alphaSide = await pool.query<{ id: string; fixture_id: string }>(
      `SELECT id, fixture_id FROM fixture_participant WHERE fixture_id = ANY($1::uuid[]) AND team_id = $2`,
      [[opener, draw], TEAMS.alpha],
    );
    for (const side of alphaSide.rows) {
      await pool.query(
        `INSERT INTO lineup (participant_id, person_id, role, shirt_number, position) VALUES ($1, $2, 'starter', 9, 'forward')`,
        [side.id, SCORER],
      );
      await pool.query(
        `INSERT INTO fixture_player_stat (participant_id, person_id, metric, value) VALUES ($1, $2, 'minutes', 90)`,
        [side.id, SCORER],
      );
      if (side.fixture_id === opener) {
        await pool.query(
          `INSERT INTO lineup (participant_id, person_id, role, shirt_number, position) VALUES ($1, $2, 'starter', 10, 'forward')`,
          [side.id, OTHER_SCORER],
        );
      }
    }
    await fixture(NEW_SEASON, NEW_STAGE, TEAMS.beta, TEAMS.gamma, '2099-01-01T15:00:00Z', null);
    // Old season: one result, no declared coverage.
    await fixture(OLD_SEASON, OLD_STAGE, TEAMS.beta, TEAMS.alpha, '2024-09-01T15:00:00Z', [2, 0]);

    // T-630: a continental cup, league stage then a round of 16 settled on
    // penalties after extra time in the second leg.
    await pool.query(
      `INSERT INTO competition (id, name, kind, scope, gender)
       VALUES ($1, $2, 'cup', 'continental', 'men')`,
      [CUP, `Test Cup ${RUN}`],
    );
    await pool.query(
      `INSERT INTO season (id, competition_id, label, start_date, end_date, is_current)
       VALUES ($1, $2, '2025/26', DATE '2025-07-01', DATE '2026-06-30', true)`,
      [CUP_SEASON, CUP],
    );
    const cupFixture = async (
      round: string,
      home: string,
      away: string,
      kickoff: string,
      scores: [string, number, number][],
    ) => {
      const id = randomUUID();
      fixtures.push(id);
      await pool.query(
        `INSERT INTO fixture (id, season_id, round, kickoff_at, status)
         VALUES ($1, $2, $3, $4::timestamptz, 'finished')`,
        [id, CUP_SEASON, round, kickoff],
      );
      await pool.query(
        `INSERT INTO fixture_participant (fixture_id, team_id, side)
         VALUES ($1, $2, 'home'), ($1, $3, 'away')`,
        [id, home, away],
      );
      for (const [kind, h, a] of scores) {
        await pool.query(
          `INSERT INTO fixture_score (fixture_id, kind, home, away) VALUES ($1, $2, $3, $4)`,
          [id, kind, h, a],
        );
      }
    };
    await cupFixture('League Stage - 1', TEAMS.alpha, TEAMS.gamma, '2025-09-16T19:00:00Z', [
      ['full_time', 1, 0],
    ]);
    await cupFixture('Round of 16', TEAMS.alpha, TEAMS.beta, '2026-03-10T20:00:00Z', [
      ['full_time', 2, 0],
      ['current', 2, 0],
    ]);
    // 90 minutes 2-0, 2-0 after extra time: level on aggregate, beta win the shoot-out.
    await cupFixture('Round of 16', TEAMS.beta, TEAMS.alpha, '2026-03-17T20:00:00Z', [
      ['full_time', 2, 0],
      ['extra_time', 0, 0],
      ['current', 2, 0],
      ['penalties', 4, 3],
    ]);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM incident WHERE fixture_id = ANY($1::uuid[])`, [fixtures]);
    await pool.query(`DELETE FROM fixture WHERE id = ANY($1::uuid[])`, [fixtures]);
    await pool.query(`DELETE FROM stage WHERE id = ANY($1::uuid[])`, [[OLD_STAGE, NEW_STAGE]]);
    await pool.query(`DELETE FROM season WHERE id = ANY($1::uuid[])`, [
      [OLD_SEASON, NEW_SEASON, CUP_SEASON],
    ]);
    await pool.query(`DELETE FROM competition WHERE id = ANY($1::uuid[])`, [[COMPETITION, CUP]]);
    await pool.query(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [Object.values(TEAMS)]);
    await pool.query(`DELETE FROM person WHERE id = ANY($1::uuid[])`, [[SCORER, OTHER_SCORER]]);
    await pool.end();
    await app.close();
  });

  it('selects the current season by default and lists every season newest first', async () => {
    const response = await app.inject({ method: 'GET', url: `/competitions/${COMPETITION}` });
    expect(response.statusCode).toBe(200);
    const page = response.json() as CompetitionPage;
    expect(page.competition).toMatchObject({
      name: `Test League ${RUN}`,
      short_name: 'TL',
      kind: 'league',
      country: { code: 'ENG', name: 'England' },
    });
    expect(page.seasons.map((s) => s.label)).toEqual(['2025/26', '2024/25']);
    expect(page.season).toMatchObject({ id: NEW_SEASON, label: '2025/26', is_current: true });
    expect(page.season.stages).toEqual([
      expect.objectContaining({ id: NEW_STAGE, kind: 'league', sort_order: 1 }),
    ]);
    expect(page.coverage).toEqual({
      incidents: 'available',
      scores: 'available',
      standings: 'available',
    });
    expect(page.last_updated_at).not.toBeNull();
    // A domestic league plays no knockout rounds.
    expect(page.bracket).toBeNull();
  });

  it('computes the table from stored results, with the unplayed club on it too', async () => {
    const page = (
      await app.inject({ method: 'GET', url: `/competitions/${COMPETITION}` })
    ).json() as CompetitionPage;
    expect(page.table.coverage).toBe('available');
    expect(page.table.last_updated_at).not.toBeNull();
    const rows = page.table.data!;
    expect(
      rows.map((r) => [r.position, r.team.name, r.played, r.points, r.goal_difference]),
    ).toEqual([
      [1, `Test Alpha ${RUN}`, 2, 4, 2],
      [2, `Test Gamma ${RUN}`, 1, 1, 0],
      [3, `Test Beta ${RUN}`, 1, 0, -2],
    ]);
    expect(rows[0]!.form).toEqual(['D', 'W']);
    expect(rows[0]!.team.short_name).toBe('ALP');

    expect(page.results.map((f) => f.score)).toEqual([
      { home: 0, away: 0 },
      { home: 3, away: 1 },
    ]);
    expect(page.fixtures).toHaveLength(1);
    expect(page.fixtures[0]).toMatchObject({ status: 'scheduled', score: null, round: 'Matchday' });

    expect(page.leaders.coverage).toBe('available');
    expect(page.leaders.data).toEqual([
      {
        person: { id: SCORER, name: 'Scorer' },
        team: { id: TEAMS.alpha, name: `Test Alpha ${RUN}` },
        goals: 2,
        minutes: {
          coverage: 'available',
          total: 180,
          matches: 2,
          matches_with_minutes: 2,
          supplied_minutes: 180,
        },
      },
      {
        person: { id: OTHER_SCORER, name: `Test Other ${RUN}` },
        team: { id: TEAMS.alpha, name: `Test Alpha ${RUN}` },
        goals: 1,
        minutes: {
          coverage: 'not_supplied',
          total: null,
          matches: 1,
          matches_with_minutes: 0,
          supplied_minutes: 0,
        },
      },
    ]);
    expect(page.leaders_filter).toEqual({
      min_minutes: null,
      unproven: 0,
      presets: [450, 900, 1800],
    });
  });

  it('filters the leaders by minutes, counting the ones the record cannot judge (T-824)', async () => {
    const get = async (floor: string) =>
      app.inject({ method: 'GET', url: `/competitions/${COMPETITION}?min_minutes=${floor}` });

    const reached = (await get('180')).json() as CompetitionPage;
    expect(reached.leaders.data!.map((l) => l.person.id)).toEqual([SCORER]);
    // The other scorer's minutes were never supplied: left out, counted, and
    // the list is limited because it may be missing someone.
    expect(reached.leaders_filter).toMatchObject({ min_minutes: 180, unproven: 1 });
    expect(reached.leaders.coverage).toBe('limited');

    const nobody = (await get('181')).json() as CompetitionPage;
    expect(nobody.leaders.data).toEqual([]);
    expect(nobody.leaders_filter.unproven).toBe(1);

    const none = (await get('0')).json() as CompetitionPage;
    expect(none.leaders_filter.min_minutes).toBeNull();
    expect(none.leaders.data).toHaveLength(2);

    const bad = await get('lots');
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({
      error: 'validation',
      fields: { min_minutes: expect.any(String) },
    });
  });

  it('switches season on request and never dresses undeclared data as covered', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/competitions/${COMPETITION}?season=${OLD_SEASON}`,
    });
    expect(response.statusCode).toBe(200);
    const page = response.json() as CompetitionPage;
    expect(page.season).toMatchObject({ id: OLD_SEASON, label: '2024/25', is_current: false });
    expect(page.seasons).toHaveLength(2);
    // A result exists but the season declares no standings coverage: limited, not available.
    expect(page.table.coverage).toBe('limited');
    expect(page.table.data!.map((r) => [r.team.name, r.points])).toEqual([
      [`Test Beta ${RUN}`, 3],
      [`Test Alpha ${RUN}`, 0],
    ]);
    // No goals recorded: not_supplied, with no invented list.
    expect(page.leaders).toEqual({ coverage: 'not_supplied', last_updated_at: null, data: null });
    expect(page.coverage).toEqual({});
    expect(page.fixtures).toEqual([]);
    expect(page.results).toHaveLength(1);
  });

  it('answers 404 for an unknown competition or a season that is not its own', async () => {
    expect(
      (await app.inject({ method: 'GET', url: `/competitions/${randomUUID()}` })).statusCode,
    ).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/competitions/not-an-id` })).statusCode).toBe(
      404,
    );
    const other = await app.inject({
      method: 'GET',
      url: `/competitions/${COMPETITION}?season=${randomUUID()}`,
    });
    expect(other.statusCode).toBe(404);
    expect((other.json() as ApiError).message).toMatch(/season/);
  });

  it('draws the knockout rounds of a cup from stored fixtures and states the undrawn ones', async () => {
    const response = await app.inject({ method: 'GET', url: `/competitions/${CUP}` });
    expect(response.statusCode).toBe(200);
    const page = response.json() as CompetitionPage;
    expect(page.bracket!.rounds.map((r) => [r.key, r.state, r.ties.length])).toEqual([
      ['round_of_16', 'drawn', 1],
      ['quarter_final', 'not_drawn', 0],
      ['semi_final', 'not_drawn', 0],
      ['final', 'not_drawn', 0],
    ]);
    const tie = page.bracket!.rounds[0]!.ties[0]!;
    expect(tie.teams.map((t) => t.id)).toEqual([TEAMS.alpha, TEAMS.beta]);
    expect(tie.legs.map((l) => [l.leg, l.score, l.after_extra_time])).toEqual([
      [1, { home: 2, away: 0 }, false],
      [2, { home: 2, away: 0 }, true],
    ]);
    expect(tie.legs[1]!.penalties).toEqual({ home: 4, away: 3 });
    expect(tie.aggregate).toEqual([2, 2]);
    expect(tie.winner?.id).toBe(TEAMS.beta);
    expect(tie.decided_by).toBe('penalties');
  });
});
