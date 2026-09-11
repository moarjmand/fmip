import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { TeamPage } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { CatalogModule } from './catalog.module';

// The team page against the real schema: a temporary league, three clubs,
// a home ground, two open spells, a follower, finished and scheduled
// matches. Acceptance: squad, fixtures, form and competition context.
const DATABASE_URL = process.env.DATABASE_URL;

const ENGLAND = '00000000-0000-4000-8000-000000000101';
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const COMPETITION = randomUUID();
const SEASON = randomUUID();
const STAGE = randomUUID();
const VENUE = randomUUID();
const TEAMS = { alpha: randomUUID(), beta: randomUUID(), gamma: randomUUID() };
const KEEPER = randomUUID();
const STRIKER = randomUUID();
const FAN = randomUUID();

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('team page', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  const fixtures: string[] = [];

  async function fixture(
    home: string,
    away: string,
    kickoff: string,
    score: [number, number] | null,
  ): Promise<string> {
    const id = randomUUID();
    fixtures.push(id);
    await pool.query(
      `INSERT INTO fixture (id, season_id, stage_id, kickoff_at, status)
       VALUES ($1, $2, $3, $4::timestamptz, $5)`,
      [id, SEASON, STAGE, kickoff, score === null ? 'scheduled' : 'finished'],
    );
    await pool.query(
      `INSERT INTO fixture_participant (fixture_id, team_id, side) VALUES ($1, $2, 'home'), ($1, $3, 'away')`,
      [id, home, away],
    );
    if (score !== null) {
      await pool.query(
        `INSERT INTO fixture_score (fixture_id, kind, home, away) VALUES ($1, 'full_time', $2, $3)`,
        [id, score[0], score[1]],
      );
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
      `INSERT INTO competition (id, country_id, name, kind, scope, gender)
       VALUES ($1, $2, $3, 'league', 'domestic', 'men')`,
      [COMPETITION, ENGLAND, `Test League ${RUN}`],
    );
    await pool.query(
      `INSERT INTO season (id, competition_id, label, start_date, end_date, is_current)
       VALUES ($1, $2, '2025/26', DATE '2025-08-01', DATE '2026-05-31', true)`,
      [SEASON, COMPETITION],
    );
    await pool.query(
      `INSERT INTO stage (id, season_id, name, kind, sort_order) VALUES ($1, $2, 'Regular season', 'league', 1)`,
      [STAGE, SEASON],
    );
    await pool.query(
      `INSERT INTO venue (id, name, city, country_id, capacity) VALUES ($1, $2, 'Testville', $3, 12345)`,
      [VENUE, `Test Ground ${RUN}`, ENGLAND],
    );
    await pool.query(
      `INSERT INTO team (id, name, short_name, kind, gender, country_id, home_venue_id, founded_year) VALUES
         ($1, $4, 'ALP', 'club', 'men', $7, $8, 1901),
         ($2, $5, 'BET', 'club', 'men', $7, NULL, NULL),
         ($3, $6, NULL, 'club', 'men', $7, NULL, NULL)`,
      [
        TEAMS.alpha,
        TEAMS.beta,
        TEAMS.gamma,
        `Test Alpha ${RUN}`,
        `Test Beta ${RUN}`,
        `Test Gamma ${RUN}`,
        ENGLAND,
        VENUE,
      ],
    );
    await pool.query(
      `INSERT INTO person (id, full_name, known_as) VALUES ($1, 'Test Keeper ${RUN}', 'Keeper'), ($2, 'Test Striker ${RUN}', NULL)`,
      [KEEPER, STRIKER],
    );
    await pool.query(
      `INSERT INTO player_spell (person_id, team_id, start_date, end_date, shirt_number, position, on_loan) VALUES
         ($1, $3, DATE '2024-07-01', NULL, 1, 'goalkeeper', false),
         ($2, $3, DATE '2025-01-15', NULL, 9, 'forward', true),
         ($2, $4, DATE '2023-07-01', DATE '2025-01-14', 10, 'forward', false)`,
      [KEEPER, STRIKER, TEAMS.alpha, TEAMS.beta],
    );
    await pool.query(
      `INSERT INTO user_account (id, username, display_name, email, country_id, preferred_language, timezone, accepted_rules_at)
       VALUES ($1, $2, 'Team Fan', $3, $4, 'en', 'Europe/London', now())`,
      [FAN, `tp_${RUN}f`, `tp_${RUN}f@example.test`, ENGLAND],
    );
    await pool.query(
      `INSERT INTO followed_entity (user_id, entity_type, entity_id, favourite) VALUES ($1, 'team', $2, true)`,
      [FAN, TEAMS.alpha],
    );

    // alpha: beat beta 2-0, drew with gamma 1-1, plays beta again next year.
    await fixture(TEAMS.alpha, TEAMS.beta, '2025-09-01T15:00:00Z', [2, 0]);
    await fixture(TEAMS.gamma, TEAMS.alpha, '2025-09-08T15:00:00Z', [1, 1]);
    await fixture(TEAMS.beta, TEAMS.alpha, '2099-01-01T15:00:00Z', null);
    // A match alpha is not in.
    await fixture(TEAMS.beta, TEAMS.gamma, '2025-09-15T15:00:00Z', [3, 0]);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM fixture WHERE id = ANY($1::uuid[])`, [fixtures]);
    await pool.query(`DELETE FROM followed_entity WHERE user_id = $1`, [FAN]);
    await pool.query(`DELETE FROM user_account WHERE id = $1`, [FAN]);
    await pool.query(`DELETE FROM player_spell WHERE person_id = ANY($1::uuid[])`, [
      [KEEPER, STRIKER],
    ]);
    await pool.query(`DELETE FROM person WHERE id = ANY($1::uuid[])`, [[KEEPER, STRIKER]]);
    await pool.query(`DELETE FROM stage WHERE id = $1`, [STAGE]);
    await pool.query(`DELETE FROM season WHERE id = $1`, [SEASON]);
    await pool.query(`DELETE FROM competition WHERE id = $1`, [COMPETITION]);
    await pool.query(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [Object.values(TEAMS)]);
    await pool.query(`DELETE FROM venue WHERE id = $1`, [VENUE]);
    await pool.end();
    await app.close();
  });

  it('shows the team, its ground, its followers and where it stands', async () => {
    const response = await app.inject({ method: 'GET', url: `/teams/${TEAMS.alpha}` });
    expect(response.statusCode).toBe(200);
    const page = response.json() as TeamPage;
    expect(page.team).toMatchObject({
      name: `Test Alpha ${RUN}`,
      short_name: 'ALP',
      kind: 'club',
      founded_year: 1901,
      country: { code: 'ENG' },
      venue: { name: `Test Ground ${RUN}`, city: 'Testville', capacity: 12345 },
    });
    expect(page.followers).toBe(1);
    expect(page.competitions).toHaveLength(1);
    const [entry] = page.competitions;
    expect(entry).toMatchObject({
      competition: { id: COMPETITION, name: `Test League ${RUN}` },
      season: { id: SEASON, label: '2025/26', is_current: true },
    });
    // beta 3 pts (+3), alpha 4 pts (+2)... alpha: W, D = 4 points; beta: L, W = 3 points; gamma: D, L = 1.
    expect(entry!.context.coverage).toBe('limited');
    expect(entry!.context.data).toMatchObject({ position: 1, total: 3, points: 4 });
    expect(entry!.context.data!.rows.map((r) => r.team.id)).toEqual([
      TEAMS.alpha,
      TEAMS.beta,
      TEAMS.gamma,
    ]);
    expect(entry!.context.data!.rows[0]!.form).toEqual(['D', 'W']);
  });

  it('lists the matches, next and previous, and the squad by position', async () => {
    const page = (
      await app.inject({ method: 'GET', url: `/teams/${TEAMS.alpha}` })
    ).json() as TeamPage;
    expect(page.results.map((f) => f.score)).toEqual([
      { home: 1, away: 1 },
      { home: 2, away: 0 },
    ]);
    expect(page.fixtures).toHaveLength(1);
    expect(page.next_match).toMatchObject({
      status: 'scheduled',
      home: { id: TEAMS.beta },
      competition: { id: COMPETITION },
      season: { label: '2025/26' },
    });
    expect(page.previous_match).toMatchObject({ score: { home: 1, away: 1 } });
    expect(page.last_updated_at).not.toBeNull();

    expect(page.squad.coverage).toBe('available');
    expect(page.squad.data).toEqual([
      {
        person: { id: KEEPER, name: 'Keeper' },
        shirt_number: 1,
        position: 'goalkeeper',
        on_loan: false,
        since: '2024-07-01',
      },
      {
        person: { id: STRIKER, name: `Test Striker ${RUN}` },
        shirt_number: 9,
        position: 'forward',
        on_loan: true,
        since: '2025-01-15',
      },
    ]);
  });

  it('is honest about a squad it does not hold, and answers 404 for an unknown team', async () => {
    const page = (
      await app.inject({ method: 'GET', url: `/teams/${TEAMS.gamma}` })
    ).json() as TeamPage;
    expect(page.squad).toEqual({ coverage: 'not_supplied', last_updated_at: null, data: null });
    expect(page.followers).toBe(0);
    expect(page.team.venue).toBeNull();
    expect(page.competitions[0]!.context.data).toMatchObject({ position: 3, total: 3 });

    expect((await app.inject({ method: 'GET', url: `/teams/${randomUUID()}` })).statusCode).toBe(
      404,
    );
    expect((await app.inject({ method: 'GET', url: `/teams/not-an-id` })).statusCode).toBe(404);
  });
});
