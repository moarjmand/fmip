import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { CompetitionPage } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { CatalogModule } from './catalog.module';

// T-943: the competition page's boards beyond goals against the real schema.
// One season with assists, line-ups naming keepers and cards (one match
// without line-ups), and one whose feed sent goals with no assist and nothing
// else. Acceptance: each board is its own module, and the season without
// assists is `not_supplied` for them, never a board of zeros.
const DATABASE_URL = process.env.DATABASE_URL;

const ENGLAND = '00000000-0000-4000-8000-000000000101';
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const COMPETITION = randomUUID();
const SEASON = randomUUID();
const BARE_SEASON = randomUUID();
const TEAMS = { alpha: randomUUID(), beta: randomUUID(), gamma: randomUUID() };
const P = {
  scorer: randomUUID(),
  maker: randomUUID(),
  keeperOne: randomUUID(),
  keeperTwo: randomUUID(),
  keeperThree: randomUUID(),
  keeperFour: randomUUID(),
  defender: randomUUID(),
  hothead: randomUUID(),
};

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('leader boards (T-943)', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  const fixtures: string[] = [];

  /** A finished match; returns the home and away participant ids. */
  async function match(
    seasonId: string,
    home: string,
    away: string,
    kickoff: string,
    score: [number, number],
  ): Promise<{ id: string; home: string; away: string }> {
    const id = randomUUID();
    fixtures.push(id);
    await pool.query(
      `INSERT INTO fixture (id, season_id, round, kickoff_at, status)
       VALUES ($1, $2, 'Matchday', $3::timestamptz, 'finished')`,
      [id, seasonId, kickoff],
    );
    const sides = await pool.query<{ id: string; side: 'home' | 'away' }>(
      `INSERT INTO fixture_participant (fixture_id, team_id, side)
       VALUES ($1, $2, 'home'), ($1, $3, 'away') RETURNING id, side`,
      [id, home, away],
    );
    await pool.query(
      `INSERT INTO fixture_score (fixture_id, kind, home, away) VALUES ($1, 'full_time', $2, $3)`,
      [id, score[0], score[1]],
    );
    return {
      id,
      home: sides.rows.find((s) => s.side === 'home')!.id,
      away: sides.rows.find((s) => s.side === 'away')!.id,
    };
  }

  let sequence = 0;
  async function incident(
    fixtureId: string,
    participantId: string,
    kind: string,
    person: string,
    related: string | null = null,
  ): Promise<void> {
    sequence += 1;
    await pool.query(
      `INSERT INTO incident (fixture_id, participant_id, person_id, related_person_id, kind, minute, sequence)
       VALUES ($1, $2, $3, $4, $5, 50, $6)`,
      [fixtureId, participantId, person, related, kind, sequence],
    );
  }

  async function keeper(
    participantId: string,
    person: string,
    minutes: number | null,
    role: 'starter' | 'bench' = 'starter',
  ): Promise<void> {
    await pool.query(
      `INSERT INTO lineup (participant_id, person_id, role, shirt_number, position)
       VALUES ($1, $2, $3, $4, 'goalkeeper')`,
      [participantId, person, role, role === 'starter' ? 1 : 12],
    );
    if (minutes !== null) {
      await pool.query(
        `INSERT INTO fixture_player_stat (participant_id, person_id, metric, value)
         VALUES ($1, $2, 'minutes', $3)`,
        [participantId, person, minutes],
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
       VALUES ($1, $2, $3, 'league', 'domestic', 'men')`,
      [COMPETITION, ENGLAND, `Boards League ${RUN}`],
    );
    await pool.query(
      `INSERT INTO season (id, competition_id, label, start_date, end_date, is_current) VALUES
         ($1, $3, '2025/26', DATE '2025-08-01', DATE '2026-05-31', true),
         ($2, $3, '2024/25', DATE '2024-08-01', DATE '2025-05-31', false)`,
      [SEASON, BARE_SEASON, COMPETITION],
    );
    await pool.query(
      `INSERT INTO team (id, name, kind, gender) VALUES
         ($1, $4, 'club', 'men'), ($2, $5, 'club', 'men'), ($3, $6, 'club', 'men')`,
      [
        TEAMS.alpha,
        TEAMS.beta,
        TEAMS.gamma,
        `Boards Alpha ${RUN}`,
        `Boards Beta ${RUN}`,
        `Boards Gamma ${RUN}`,
      ],
    );
    const names: [string, string][] = [
      [P.scorer, 'Scorer'],
      [P.maker, 'Maker'],
      [P.keeperOne, 'Keeper One'],
      [P.keeperTwo, 'Keeper Two'],
      [P.keeperThree, 'Keeper Three'],
      [P.keeperFour, 'Keeper Four'],
      [P.defender, 'Defender'],
      [P.hothead, 'Hothead'],
    ];
    for (const [id, name] of names) {
      await pool.query(`INSERT INTO person (id, full_name, known_as) VALUES ($1, $2, $3)`, [
        id,
        `${name} ${RUN}`,
        `${name} ${RUN}`,
      ]);
    }
    await pool.query(
      `INSERT INTO coverage_profile (season_id, module, state, provider) VALUES
         ($1, 'incidents', 'available', 'api_football'), ($1, 'lineups', 'available', 'api_football')`,
      [SEASON],
    );

    // Alpha 2-0 beta: one assisted goal, one penalty; keeper one keeps a clean
    // sheet, keeper two concedes; a yellow each for the maker and the defender.
    const one = await match(SEASON, TEAMS.alpha, TEAMS.beta, '2025-09-01T15:00:00Z', [2, 0]);
    await incident(one.id, one.home, 'goal', P.scorer, P.maker);
    await incident(one.id, one.home, 'penalty_goal', P.scorer);
    await incident(one.id, one.home, 'yellow_card', P.maker);
    await incident(one.id, one.away, 'yellow_card', P.defender);
    await keeper(one.home, P.keeperOne, 90);
    await keeper(one.away, P.keeperTwo, 90);

    // Gamma 0-0 alpha: keeper one is substituted, so the clean sheet is not
    // his, nor the substitute's (he did not start); keeper four keeps one.
    // Gamma's hothead is sent off.
    const two = await match(SEASON, TEAMS.gamma, TEAMS.alpha, '2025-09-08T15:00:00Z', [0, 0]);
    await keeper(two.away, P.keeperOne, 60);
    await keeper(two.away, P.keeperThree, 30, 'bench');
    await incident(two.id, two.away, 'substitution', P.keeperOne, P.keeperThree);
    await keeper(two.home, P.keeperFour, null);
    await incident(two.id, two.home, 'red_card', P.hothead);

    // Beta 1-1 gamma with no line-ups: two sides nobody can judge.
    const three = await match(SEASON, TEAMS.beta, TEAMS.gamma, '2025-09-15T15:00:00Z', [1, 1]);
    await incident(three.id, three.home, 'goal', P.defender);

    // The bare season: a goal without an assist, and nothing else.
    const bare = await match(BARE_SEASON, TEAMS.alpha, TEAMS.beta, '2024-09-01T15:00:00Z', [1, 0]);
    await incident(bare.id, bare.home, 'goal', P.scorer);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM incident WHERE fixture_id = ANY($1::uuid[])`, [fixtures]);
    await pool.query(`DELETE FROM fixture WHERE id = ANY($1::uuid[])`, [fixtures]);
    await pool.query(`DELETE FROM season WHERE id = ANY($1::uuid[])`, [[SEASON, BARE_SEASON]]);
    await pool.query(`DELETE FROM competition WHERE id = $1`, [COMPETITION]);
    await pool.query(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [Object.values(TEAMS)]);
    await pool.query(`DELETE FROM person WHERE id = ANY($1::uuid[])`, [Object.values(P)]);
    await pool.end();
    await app.close();
  });

  const get = async (query = ''): Promise<CompetitionPage> => {
    const response = await app.inject({
      method: 'GET',
      url: `/competitions/${COMPETITION}${query}`,
    });
    expect(response.statusCode).toBe(200);
    return response.json() as CompetitionPage;
  };

  it('counts assists from the goals that name one', async () => {
    const { boards } = await get();
    expect(boards.assists.coverage).toBe('available');
    expect(
      boards.assists.data!.map((r) => [r.person.id, r.team?.id, r.assists, r.minutes.coverage]),
    ).toEqual([[P.maker, TEAMS.alpha, 1, 'not_supplied']]);
  });

  it('credits a clean sheet only to a keeper who started and finished without conceding', async () => {
    const { boards } = await get();
    // Two of six sides have no line-up: the board may be missing someone.
    expect(boards.clean_sheets.coverage).toBe('limited');
    expect(
      boards.clean_sheets.data!.map((r) => [
        r.person.id,
        r.team?.id,
        r.clean_sheets,
        r.starts_in_goal,
      ]),
    ).toEqual([
      [P.keeperFour, TEAMS.gamma, 1, 1],
      [P.keeperOne, TEAMS.alpha, 1, 2],
    ]);
    expect(boards.clean_sheets.data![1]!.minutes).toMatchObject({
      coverage: 'available',
      total: 150,
    });
  });

  it('ranks cards by reds, then yellows, then name', async () => {
    const { boards } = await get();
    expect(boards.cards.coverage).toBe('available');
    expect(boards.cards.data!.map((r) => [r.person.id, r.red_cards, r.yellow_cards])).toEqual([
      [P.hothead, 1, 0],
      [P.defender, 0, 1],
      [P.maker, 0, 1],
    ]);
  });

  it('applies the minutes floor to every board and counts the unproven per board', async () => {
    const page = await get('?min_minutes=90');
    expect(page.boards.clean_sheets.data!.map((r) => r.person.id)).toEqual([P.keeperOne]);
    expect(page.boards.clean_sheets.coverage).toBe('limited');
    expect(page.boards.assists.data).toEqual([]);
    expect(page.boards.unproven).toEqual({ assists: 1, clean_sheets: 1, cards: 3 });
    expect(page.boards.cards.coverage).toBe('limited');
  });

  it('says a season without assists, line-ups or cards is not supplied, never a board of zeros', async () => {
    const { boards } = await get(`?season=${BARE_SEASON}`);
    expect(boards.assists).toEqual({
      coverage: 'not_supplied',
      last_updated_at: expect.any(String),
      data: null,
    });
    expect(boards.clean_sheets.data).toBeNull();
    expect(boards.clean_sheets.coverage).toBe('not_supplied');
    expect(boards.cards).toEqual({ coverage: 'not_supplied', last_updated_at: null, data: null });
    expect(boards.unproven).toEqual({ assists: 0, clean_sheets: 0, cards: 0 });
  });
});
