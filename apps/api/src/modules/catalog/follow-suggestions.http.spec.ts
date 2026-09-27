import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FollowSuggestionsResponse } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { CatalogModule } from './catalog.module';

// `GET /follow-suggestions` (T-622) against the real schema: a temporary
// league with an old season and a current one, clubs that play only in the
// old one, and a follower. Acceptance: the teams come from the season the
// competition page would show, ranked by followers, and nothing is invented
// for a competition with no season.
const DATABASE_URL = process.env.DATABASE_URL;

const ENGLAND = '00000000-0000-4000-8000-000000000101';
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const LEAGUE = randomUUID();
const EMPTY = randomUUID();
const OLD_SEASON = randomUUID();
const CURRENT_SEASON = randomUUID();
const TEAMS = { alpha: randomUUID(), beta: randomUUID(), gamma: randomUUID(), old: randomUUID() };
const FAN = randomUUID();

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('follow suggestions', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  const fixtures: string[] = [];

  async function fixture(season: string, home: string, away: string): Promise<void> {
    const id = randomUUID();
    fixtures.push(id);
    await pool.query(
      `INSERT INTO fixture (id, season_id, kickoff_at, status)
       VALUES ($1, $2, '2099-01-01T15:00:00Z', 'scheduled')`,
      [id, season],
    );
    await pool.query(
      `INSERT INTO fixture_participant (fixture_id, team_id, side) VALUES ($1, $2, 'home'), ($1, $3, 'away')`,
      [id, home, away],
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
      `INSERT INTO competition (id, country_id, name, kind, scope, gender)
       VALUES ($1, $3, $4, 'league', 'domestic', 'men'), ($2, $3, $5, 'league', 'domestic', 'men')`,
      [LEAGUE, EMPTY, ENGLAND, `Suggest League ${RUN}`, `Suggest Empty ${RUN}`],
    );
    await pool.query(
      `INSERT INTO season (id, competition_id, label, start_date, end_date, is_current) VALUES
         ($1, $3, '2024/25', DATE '2024-08-01', DATE '2025-05-31', false),
         ($2, $3, '2025/26', DATE '2025-08-01', DATE '2026-05-31', true)`,
      [OLD_SEASON, CURRENT_SEASON, LEAGUE],
    );
    await pool.query(
      `INSERT INTO team (id, name, kind, gender, country_id) VALUES
         ($1, $5, 'club', 'men', $9), ($2, $6, 'club', 'men', $9),
         ($3, $7, 'club', 'men', $9), ($4, $8, 'club', 'men', $9)`,
      [
        TEAMS.alpha,
        TEAMS.beta,
        TEAMS.gamma,
        TEAMS.old,
        `Suggest Alpha ${RUN}`,
        `Suggest Beta ${RUN}`,
        `Suggest Gamma ${RUN}`,
        `Suggest Old ${RUN}`,
        ENGLAND,
      ],
    );
    await pool.query(
      `INSERT INTO user_account (id, username, display_name, email, country_id, preferred_language, timezone, accepted_rules_at)
       VALUES ($1, $2, 'Suggest Fan', $3, $4, 'en', 'Europe/London', now())`,
      [FAN, `fs_${RUN}f`, `fs_${RUN}f@example.test`, ENGLAND],
    );
    await pool.query(
      `INSERT INTO followed_entity (user_id, entity_type, entity_id) VALUES ($1, 'team', $2), ($1, 'team', $3)`,
      [FAN, TEAMS.gamma, TEAMS.old],
    );

    await fixture(CURRENT_SEASON, TEAMS.alpha, TEAMS.beta);
    await fixture(CURRENT_SEASON, TEAMS.gamma, TEAMS.alpha);
    // Only in last season: not suggested for this one, however followed.
    await fixture(OLD_SEASON, TEAMS.old, TEAMS.alpha);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM fixture WHERE id = ANY($1::uuid[])`, [fixtures]);
    await pool.query(`DELETE FROM followed_entity WHERE user_id = $1`, [FAN]);
    await pool.query(`DELETE FROM user_account WHERE id = $1`, [FAN]);
    await pool.query(`DELETE FROM season WHERE competition_id = $1`, [LEAGUE]);
    await pool.query(`DELETE FROM competition WHERE id = ANY($1::uuid[])`, [[LEAGUE, EMPTY]]);
    await pool.query(`DELETE FROM entity_alias WHERE entity_id = ANY($1::uuid[])`, [
      Object.values(TEAMS),
    ]);
    await pool.query(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [Object.values(TEAMS)]);
    await pool.end();
    await app.close();
  });

  async function suggestions(): Promise<FollowSuggestionsResponse> {
    const response = await app.inject({ method: 'GET', url: '/follow-suggestions' });
    expect(response.statusCode).toBe(200);
    return response.json() as FollowSuggestionsResponse;
  }

  it('suggests the current season’s teams, most followed first, then by name', async () => {
    const body = await suggestions();
    expect(body.ranked_by).toBe('followers');
    const league = body.competitions.find((c) => c.competition.id === LEAGUE);
    expect(league?.season).toEqual({ id: CURRENT_SEASON, label: '2025/26' });
    expect(league?.teams.map((t) => [t.id, t.followers])).toEqual([
      [TEAMS.gamma, 1],
      [TEAMS.alpha, 0],
      [TEAMS.beta, 0],
    ]);
  });

  it('lists a competition with no season with no teams, rather than borrowing any', async () => {
    const empty = (await suggestions()).competitions.find((c) => c.competition.id === EMPTY);
    expect(empty).toMatchObject({ season: null, teams: [] });
  });

  it('carries our identifiers only', async () => {
    const league = (await suggestions()).competitions.find((c) => c.competition.id === LEAGUE);
    expect(Object.keys(league?.teams[0] ?? {}).sort()).toEqual([
      'code',
      'country_id',
      'followers',
      'id',
      'kind',
      'name',
      'short_name',
    ]);
  });
});
