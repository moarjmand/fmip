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
// old one, and a follower; a continental cup whose season has a qualifying
// round before its league stage. Acceptance: the teams come from the season
// the competition page would show and play its main phase, ranked by
// followers and then by table position, and nothing is invented for a
// competition with no season.
const DATABASE_URL = process.env.DATABASE_URL;

const ENGLAND = '00000000-0000-4000-8000-000000000101';
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const LEAGUE = randomUUID();
const EMPTY = randomUUID();
const CUP = randomUUID();
const OLD_SEASON = randomUUID();
const CURRENT_SEASON = randomUUID();
const CUP_SEASON = randomUUID();
const QUALIFYING = randomUUID();
const LEAGUE_STAGE = randomUUID();
const TEAMS = {
  alpha: randomUUID(),
  beta: randomUUID(),
  gamma: randomUUID(),
  old: randomUUID(),
  qualifier: randomUUID(),
  entrant: randomUUID(),
};
const FAN = randomUUID();

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('follow suggestions', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  const fixtures: string[] = [];

  async function fixture(
    season: string,
    home: string,
    away: string,
    { stage = null, score = null }: { stage?: string | null; score?: [number, number] | null } = {},
  ): Promise<void> {
    const id = randomUUID();
    fixtures.push(id);
    await pool.query(
      `INSERT INTO fixture (id, season_id, stage_id, kickoff_at, status)
       VALUES ($1, $2, $3, '2099-01-01T15:00:00Z', $4)`,
      [id, season, stage, score === null ? 'scheduled' : 'finished'],
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
       VALUES ($1, $3, $4, 'league', 'domestic', 'men'), ($2, $3, $5, 'league', 'domestic', 'men'),
              ($6, NULL, $7, 'cup', 'continental', 'men')`,
      [
        LEAGUE,
        EMPTY,
        ENGLAND,
        `Suggest League ${RUN}`,
        `Suggest Empty ${RUN}`,
        CUP,
        `Suggest Cup ${RUN}`,
      ],
    );
    await pool.query(
      `INSERT INTO season (id, competition_id, label, start_date, end_date, is_current) VALUES
         ($1, $3, '2024/25', DATE '2024-08-01', DATE '2025-05-31', false),
         ($2, $3, '2025/26', DATE '2025-08-01', DATE '2026-05-31', true),
         ($4, $5, '2025/26', DATE '2025-07-01', DATE '2026-05-31', true)`,
      [OLD_SEASON, CURRENT_SEASON, LEAGUE, CUP_SEASON, CUP],
    );
    await pool.query(
      `INSERT INTO stage (id, season_id, name, kind, sort_order) VALUES
         ($1, $3, '2nd Qualifying Round', 'qualifying', 1),
         ($2, $3, 'League Stage', 'league', 2)`,
      [QUALIFYING, LEAGUE_STAGE, CUP_SEASON],
    );
    await pool.query(
      `INSERT INTO team (id, name, kind, gender, country_id) VALUES
         ($1, $7, 'club', 'men', $13), ($2, $8, 'club', 'men', $13),
         ($3, $9, 'club', 'men', $13), ($4, $10, 'club', 'men', $13),
         ($5, $11, 'club', 'men', $13), ($6, $12, 'club', 'men', $13)`,
      [
        TEAMS.alpha,
        TEAMS.beta,
        TEAMS.gamma,
        TEAMS.old,
        TEAMS.qualifier,
        TEAMS.entrant,
        `Suggest Alpha ${RUN}`,
        `Suggest Beta ${RUN}`,
        `Suggest Gamma ${RUN}`,
        `Suggest Old ${RUN}`,
        `Suggest Qualifier ${RUN}`,
        `Suggest Entrant ${RUN}`,
        ENGLAND,
      ],
    );
    await pool.query(
      `INSERT INTO user_account (id, username, display_name, email, country_id, preferred_language, timezone, accepted_rules_at)
       VALUES ($1, $2, 'Suggest Fan', $3, $4, 'en', 'Europe/London', now())`,
      [FAN, `fs_${RUN}f`, `fs_${RUN}f@example.test`, ENGLAND],
    );
    await pool.query(
      `INSERT INTO followed_entity (user_id, entity_type, entity_id)
       VALUES ($1, 'team', $2), ($1, 'team', $3), ($1, 'team', $4)`,
      [FAN, TEAMS.gamma, TEAMS.old, TEAMS.qualifier],
    );

    // Beta beat Alpha: level on followers, Beta ranks above Alpha by the table.
    await fixture(CURRENT_SEASON, TEAMS.alpha, TEAMS.beta, { score: [0, 1] });
    await fixture(CURRENT_SEASON, TEAMS.gamma, TEAMS.alpha);
    // Only in last season: not suggested for this one, however followed.
    await fixture(OLD_SEASON, TEAMS.old, TEAMS.alpha);
    // The qualifier went out in the qualifying round: not suggested, however followed.
    await fixture(CUP_SEASON, TEAMS.qualifier, TEAMS.entrant, { stage: QUALIFYING });
    await fixture(CUP_SEASON, TEAMS.entrant, TEAMS.alpha, { stage: LEAGUE_STAGE });
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM fixture WHERE id = ANY($1::uuid[])`, [fixtures]);
    await pool.query(`DELETE FROM followed_entity WHERE user_id = $1`, [FAN]);
    await pool.query(`DELETE FROM user_account WHERE id = $1`, [FAN]);
    await pool.query(`DELETE FROM stage WHERE season_id = $1`, [CUP_SEASON]);
    await pool.query(`DELETE FROM season WHERE competition_id = ANY($1::uuid[])`, [[LEAGUE, CUP]]);
    await pool.query(`DELETE FROM competition WHERE id = ANY($1::uuid[])`, [[LEAGUE, EMPTY, CUP]]);
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

  it('suggests the current season’s teams, most followed first, then by table position', async () => {
    const body = await suggestions();
    expect(body.ranked_by).toBe('followers');
    const league = body.competitions.find((c) => c.competition.id === LEAGUE);
    expect(league?.season).toEqual({ id: CURRENT_SEASON, label: '2025/26' });
    expect(league?.teams.map((t) => [t.id, t.followers])).toEqual([
      [TEAMS.gamma, 1],
      [TEAMS.beta, 0],
      [TEAMS.alpha, 0],
    ]);
  });

  it('suggests only the teams of the main phase, never a club out in the qualifiers', async () => {
    const cup = (await suggestions()).competitions.find((c) => c.competition.id === CUP);
    expect(cup?.season).toEqual({ id: CUP_SEASON, label: '2025/26' });
    expect(cup?.teams.map((t) => t.id)).toEqual([TEAMS.alpha, TEAMS.entrant]);
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
