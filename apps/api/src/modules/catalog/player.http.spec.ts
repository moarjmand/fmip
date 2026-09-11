import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { PlayerPage } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { CatalogModule } from './catalog.module';

// The player page against the real schema: a player with a closed spell and
// an open one, named in two line-ups (a start and a bench appearance that
// became a substitution), with a goal, an assist received and a yellow card.
const DATABASE_URL = process.env.DATABASE_URL;

const ENGLAND = '00000000-0000-4000-8000-000000000101';
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const COMPETITION = randomUUID();
const SEASON = randomUUID();
const STAGE = randomUUID();
const TEAMS = { alpha: randomUUID(), beta: randomUUID() };
const PLAYER = randomUUID();
const PROVIDER = randomUUID();
const BYSTANDER = randomUUID();

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('player page', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  const fixtures: string[] = [];

  async function fixture(
    kickoff: string,
    score: [number, number],
  ): Promise<{ id: string; alpha: string; beta: string }> {
    const id = randomUUID();
    fixtures.push(id);
    await pool.query(
      `INSERT INTO fixture (id, season_id, stage_id, kickoff_at, status)
       VALUES ($1, $2, $3, $4::timestamptz, 'finished')`,
      [id, SEASON, STAGE, kickoff],
    );
    const participants = await pool.query<{ id: string; side: 'home' | 'away' }>(
      `INSERT INTO fixture_participant (fixture_id, team_id, side)
       VALUES ($1, $2, 'home'), ($1, $3, 'away') RETURNING id, side`,
      [id, TEAMS.alpha, TEAMS.beta],
    );
    await pool.query(
      `INSERT INTO fixture_score (fixture_id, kind, home, away) VALUES ($1, 'full_time', $2, $3)`,
      [id, score[0], score[1]],
    );
    return {
      id,
      alpha: participants.rows.find((p) => p.side === 'home')!.id,
      beta: participants.rows.find((p) => p.side === 'away')!.id,
    };
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
      `INSERT INTO season (id, competition_id, label, start_date, end_date, is_current)
       VALUES ($1, $2, '2025/26', DATE '2025-08-01', DATE '2026-05-31', true)`,
      [SEASON, COMPETITION],
    );
    await pool.query(
      `INSERT INTO stage (id, season_id, name, kind, sort_order) VALUES ($1, $2, 'Regular season', 'league', 1)`,
      [STAGE, SEASON],
    );
    await pool.query(
      `INSERT INTO team (id, name, short_name, kind, gender) VALUES
         ($1, $3, 'ALP', 'club', 'men'), ($2, $4, 'BET', 'club', 'men')`,
      [TEAMS.alpha, TEAMS.beta, `Test Alpha ${RUN}`, `Test Beta ${RUN}`],
    );
    await pool.query(
      `INSERT INTO person (id, full_name, known_as, date_of_birth, nationality_id, height_cm, preferred_foot) VALUES
         ($1, 'Test Player ${RUN}', 'Player', DATE '2000-02-29', $4, 181, 'left'),
         ($2, 'Test Provider ${RUN}', NULL, NULL, NULL, NULL, NULL),
         ($3, 'Test Bystander ${RUN}', NULL, NULL, NULL, NULL, NULL)`,
      [PLAYER, PROVIDER, BYSTANDER, ENGLAND],
    );
    await pool.query(
      `INSERT INTO player_spell (person_id, team_id, start_date, end_date, shirt_number, position, on_loan) VALUES
         ($1, $2, DATE '2022-07-01', DATE '2025-06-30', 14, 'midfielder', false),
         ($1, $3, DATE '2025-07-01', NULL, 8, 'midfielder', false),
         ($4, $3, DATE '2024-07-01', NULL, 7, 'forward', false)`,
      [PLAYER, TEAMS.beta, TEAMS.alpha, PROVIDER],
    );

    // Match one: the player starts for alpha, scores from the provider's assist, is booked.
    const one = await fixture('2025-09-01T15:00:00Z', [1, 0]);
    await pool.query(
      `INSERT INTO lineup (participant_id, person_id, role, shirt_number, position) VALUES
         ($1, $2, 'starter', 8, 'midfielder'), ($1, $3, 'starter', 7, 'forward')`,
      [one.alpha, PLAYER, PROVIDER],
    );
    await pool.query(
      `INSERT INTO incident (fixture_id, participant_id, person_id, related_person_id, kind, minute, sequence) VALUES
         ($1, $2, $3, $4, 'goal', 30, 1),
         ($1, $2, $3, NULL, 'yellow_card', 70, 2)`,
      [one.id, one.alpha, PLAYER, PROVIDER],
    );
    // Match two: on the bench, brought on for the provider; no goals.
    const two = await fixture('2025-09-08T15:00:00Z', [0, 0]);
    await pool.query(
      `INSERT INTO lineup (participant_id, person_id, role, shirt_number, position) VALUES
         ($1, $2, 'bench', 8, 'midfielder'), ($1, $3, 'starter', 7, 'forward')`,
      [two.alpha, PLAYER, PROVIDER],
    );
    await pool.query(
      `INSERT INTO incident (fixture_id, participant_id, person_id, related_person_id, kind, minute, sequence) VALUES
         ($1, $2, $3, $4, 'substitution', 60, 1)`,
      [two.id, two.alpha, PROVIDER, PLAYER],
    );
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM fixture WHERE id = ANY($1::uuid[])`, [fixtures]);
    await pool.query(`DELETE FROM player_spell WHERE person_id = ANY($1::uuid[])`, [
      [PLAYER, PROVIDER],
    ]);
    await pool.query(`DELETE FROM person WHERE id = ANY($1::uuid[])`, [
      [PLAYER, PROVIDER, BYSTANDER],
    ]);
    await pool.query(`DELETE FROM stage WHERE id = $1`, [STAGE]);
    await pool.query(`DELETE FROM season WHERE id = $1`, [SEASON]);
    await pool.query(`DELETE FROM competition WHERE id = $1`, [COMPETITION]);
    await pool.query(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [Object.values(TEAMS)]);
    await pool.end();
    await app.close();
  });

  it('shows identity, the current spell and the career, newest first', async () => {
    const response = await app.inject({ method: 'GET', url: `/players/${PLAYER}` });
    expect(response.statusCode).toBe(200);
    const page = response.json() as PlayerPage;
    expect(page.person).toEqual({
      id: PLAYER,
      full_name: `Test Player ${RUN}`,
      known_as: 'Player',
      date_of_birth: '2000-02-29',
      nationality: { id: ENGLAND, name: 'England', code: 'ENG' },
      height_cm: 181,
      preferred_foot: 'left',
    });
    expect(page.current_spell).toMatchObject({
      team: { id: TEAMS.alpha, short_name: 'ALP' },
      shirt_number: 8,
      position: 'midfielder',
      end_date: null,
    });
    expect(page.spells.map((s) => [s.team.id, s.start_date, s.end_date])).toEqual([
      [TEAMS.alpha, '2025-07-01', null],
      [TEAMS.beta, '2022-07-01', '2025-06-30'],
    ]);
  });

  it('builds the record and the match log from line-ups and incidents', async () => {
    const page = (
      await app.inject({ method: 'GET', url: `/players/${PLAYER}` })
    ).json() as PlayerPage;
    expect(page.record.coverage).toBe('available');
    expect(page.record.data).toEqual([
      {
        season: { id: SEASON, label: '2025/26' },
        competition: { id: COMPETITION, name: `Test League ${RUN}`, short_name: 'TL' },
        team: { id: TEAMS.alpha, name: `Test Alpha ${RUN}` },
        starts: 1,
        sub_appearances: 1,
        goals: 1,
        assists: 0,
        yellow_cards: 1,
        red_cards: 0,
      },
    ]);
    expect(page.recent_matches.coverage).toBe('available');
    const matches = page.recent_matches.data!;
    expect(matches.map((m) => [m.role, m.came_on, m.goals, m.yellow_cards])).toEqual([
      ['bench', true, 0, 0],
      ['starter', false, 1, 1],
    ]);
    expect(matches[1]!.fixture).toMatchObject({
      score: { home: 1, away: 0 },
      competition: { id: COMPETITION },
      season: { label: '2025/26' },
    });
    expect(matches[0]!.team).toEqual({ id: TEAMS.alpha, name: `Test Alpha ${RUN}` });
    expect(page.last_updated_at).not.toBeNull();

    // The assist provider: two starts, one assist, no goals.
    const provider = (
      await app.inject({ method: 'GET', url: `/players/${PROVIDER}` })
    ).json() as PlayerPage;
    expect(provider.record.data![0]).toMatchObject({ starts: 2, goals: 0, assists: 1 });
  });

  it('is honest about a person with no line-ups, and answers 404 for an unknown id', async () => {
    const page = (
      await app.inject({ method: 'GET', url: `/players/${BYSTANDER}` })
    ).json() as PlayerPage;
    expect(page.current_spell).toBeNull();
    expect(page.spells).toEqual([]);
    expect(page.record).toEqual({ coverage: 'not_supplied', last_updated_at: null, data: null });
    expect(page.recent_matches.coverage).toBe('not_supplied');
    expect(page.last_updated_at).toBeNull();

    expect((await app.inject({ method: 'GET', url: `/players/${randomUUID()}` })).statusCode).toBe(
      404,
    );
    expect((await app.inject({ method: 'GET', url: `/players/nobody` })).statusCode).toBe(404);
  });
});
