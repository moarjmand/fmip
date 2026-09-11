import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { ScoresResponse } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../identity/identity.service';
import { FixturesModule } from './fixtures.module';

// The date arithmetic is Postgres's (`AT TIME ZONE`), the grouping needs the
// catalog joins, and pinning needs a real session: all of it runs against the
// real schema. Skipped, visibly, without DATABASE_URL (CI has it).
const DATABASE_URL = process.env.DATABASE_URL;

// Seeded catalog (packages/db/seed/001_catalog.sql).
const ENGLAND = '00000000-0000-4000-8000-000000000101';
const PREMIER_LEAGUE = '00000000-0000-4000-8000-000000000201';
const PL_2024 = '00000000-0000-4000-8000-000000000301';
const CONTINENTAL_2025 = '00000000-0000-4000-8000-000000000303';
const CONTINENTAL_COMPETITION = '00000000-0000-4000-8000-000000000205';
const MAN_UNITED = '00000000-0000-4000-8000-000000000601';
const LIVERPOOL = '00000000-0000-4000-8000-000000000602';
const REAL_MADRID = '00000000-0000-4000-8000-000000000603';
const PERSEPOLIS = '00000000-0000-4000-8000-000000000604';
const SALAH = '00000000-0000-4000-8000-000000000701';
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);

// A window in early 2087 that no seed or other suite touches.
const LATE_NIGHT = randomUUID(); // 2087-01-05 23:30 UTC = 2087-01-06 03:00 Tehran
const LIVE_NOW = randomUUID(); // 2087-01-06 12:00 UTC, live, one red card
const CONTINENTAL = randomUUID(); // 2087-01-07 18:00 UTC, another competition, no country

function cookieValue(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const match = /^fmip_session=([^;]*)/.exec(header ?? '');
  return match?.[1] ?? '';
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('GET /scores', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let cookie = '';
  let userId = '';

  const get = (query: string, withCookie = false) =>
    app.inject({
      method: 'GET',
      url: `/scores?${query}`,
      headers: withCookie ? { cookie: `fmip_session=${cookie}` } : {},
    });
  const ids = (body: ScoresResponse): string[] => [
    ...body.pinned.map((c) => c.id),
    ...body.groups.flatMap((g) => g.fixtures.map((c) => c.id)),
  ];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [DatabaseModule, FixturesModule] })
      .overrideProvider(IDENTITY_OPTIONS)
      .useValue({
        ...DEFAULT_IDENTITY_OPTIONS,
        sessionSecret: 'test-secret-'.repeat(4),
        webBaseUrl: 'http://web.test',
        cookieSecure: false,
      })
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    pool = new Pool({ connectionString: DATABASE_URL });

    await pool.query(
      `INSERT INTO fixture (id, season_id, round, kickoff_at, status, minute) VALUES
         ($1, $4, 'Matchweek 20', TIMESTAMPTZ '2087-01-05 23:30:00+00', 'finished', NULL),
         ($2, $4, 'Matchweek 20', TIMESTAMPTZ '2087-01-06 12:00:00+00', 'live', 55),
         ($3, $5, NULL,           TIMESTAMPTZ '2087-01-07 18:00:00+00', 'scheduled', NULL)`,
      [LATE_NIGHT, LIVE_NOW, CONTINENTAL, PL_2024, CONTINENTAL_2025],
    );
    await pool.query(
      `INSERT INTO fixture_participant (fixture_id, team_id, side) VALUES
         ($1, $4, 'home'), ($1, $5, 'away'),
         ($2, $5, 'home'), ($2, $4, 'away'),
         ($3, $6, 'home'), ($3, $7, 'away')`,
      [LATE_NIGHT, LIVE_NOW, CONTINENTAL, LIVERPOOL, MAN_UNITED, REAL_MADRID, PERSEPOLIS],
    );
    await pool.query(
      `INSERT INTO fixture_score (fixture_id, kind, home, away) VALUES
         ($1, 'half_time', 1, 0), ($1, 'full_time', 2, 2), ($1, 'current', 2, 2),
         ($2, 'current', 0, 1)`,
      [LATE_NIGHT, LIVE_NOW],
    );
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM fixture_participant WHERE fixture_id = $1 AND side = 'home'`,
      [LIVE_NOW],
    );
    await pool.query(
      `INSERT INTO incident (fixture_id, participant_id, person_id, kind, minute, added_time, sequence, detail) VALUES
         ($1, $2, $3, 'red_card', 41, NULL, 1, 'Second bookable offence'),
         ($1, NULL, NULL, 'var', 45, 2, 2, 'Goal cancelled'),
         ($1, $2, $3, 'yellow_card', 50, NULL, 3, NULL)`,
      [LIVE_NOW, rows[0]?.id, SALAH],
    );

    const registered = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        username: `sc_${RUN}`,
        display_name: 'Scores Tester',
        email: `sc_${RUN}@example.test`,
        password: 'correct horse battery staple',
        country_id: ENGLAND,
        preferred_language: 'en',
        timezone: 'Asia/Tehran',
        accept_rules: true,
      },
    });
    expect(registered.statusCode).toBe(201);
    cookie = cookieValue(registered.headers['set-cookie']);
    userId = (registered.json() as { user: { id: string } }).user.id;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM fixture WHERE id = ANY($1::uuid[])`, [
      [LATE_NIGHT, LIVE_NOW, CONTINENTAL],
    ]);
    await pool.query(`DELETE FROM user_account WHERE username = $1`, [`sc_${RUN}`]);
    await pool.end();
    await app.close();
  });

  it('puts a 23:30 UTC kick-off on the 5th for London and on the 6th for Tehran', async () => {
    const london = (await get('from=2087-01-05&tz=Europe/London')).json() as ScoresResponse;
    expect(ids(london)).toEqual([LATE_NIGHT]);
    expect(london.filters).toMatchObject({
      from: '2087-01-05',
      to: '2087-01-05',
      timezone: 'Europe/London',
    });

    const tehran5 = (await get('from=2087-01-05&tz=Asia/Tehran')).json() as ScoresResponse;
    expect(ids(tehran5)).toEqual([]);
    const tehran6 = (await get('from=2087-01-06&tz=Asia/Tehran')).json() as ScoresResponse;
    expect(ids(tehran6)).toEqual([LATE_NIGHT, LIVE_NOW]);
  });

  it('serves a week: yesterday, today and the next five days, grouped by country and competition', async () => {
    const response = await get('from=2087-01-04&to=2087-01-10&tz=UTC');
    expect(response.statusCode).toBe(200);
    const body = response.json() as ScoresResponse;
    expect(body.total).toBe(3);
    expect(body.pinned).toEqual([]);
    // No-country competitions first, then England.
    expect(body.groups.map((g) => [g.country?.code ?? null, g.competition.id])).toEqual([
      [null, CONTINENTAL_COMPETITION],
      ['ENG', PREMIER_LEAGUE],
    ]);
    expect(body.groups[1]?.fixtures.map((f) => f.id)).toEqual([LATE_NIGHT, LIVE_NOW]);
  });

  it('shows the card fields of blueprint 4.1 honestly', async () => {
    const body = (await get('from=2087-01-05&to=2087-01-06&tz=UTC')).json() as ScoresResponse;
    const finished = body.groups[0]?.fixtures.find((f) => f.id === LATE_NIGHT);
    const live = body.groups[0]?.fixtures.find((f) => f.id === LIVE_NOW);

    expect(finished).toMatchObject({
      status: 'finished',
      minute: null,
      home: { id: LIVERPOOL, name: 'Liverpool', code: 'LIV' },
      away: { id: MAN_UNITED, short_name: 'Man United' },
      scores: {
        current: { home: 2, away: 2 },
        half_time: { home: 1, away: 0 },
        full_time: { home: 2, away: 2 },
        extra_time: null,
        penalties: null,
        aggregate: null,
      },
      red_cards: { home: 0, away: 0 },
      incidents: [],
      round: 'Matchweek 20',
      season: { id: PL_2024, label: '2024/25' },
      coverage: 'limited', // the seeded profile says so for this season
      venue: null,
    });
    expect(live).toMatchObject({
      status: 'live',
      minute: 55,
      scores: { current: { home: 0, away: 1 }, full_time: null },
      red_cards: { home: 1, away: 0 },
    });
    // Goals, red cards and VAR only: the yellow card stays off the list card.
    expect(live?.incidents.map((i) => [i.kind, i.minute, i.added_time, i.side, i.player])).toEqual([
      ['red_card', 41, null, 'home', 'Mohamed Salah'],
      ['var', 45, 2, null, null],
    ]);
    expect(Date.parse(live?.last_updated_at ?? '')).toBeGreaterThan(0);
  });

  it('filters by live, country and competition', async () => {
    const live = (await get('from=2087-01-04&to=2087-01-10&live=1')).json() as ScoresResponse;
    expect(ids(live)).toEqual([LIVE_NOW]);
    const england = (
      await get(`from=2087-01-04&to=2087-01-10&country=${ENGLAND}`)
    ).json() as ScoresResponse;
    expect(ids(england)).toEqual([LATE_NIGHT, LIVE_NOW]);
    const continental = (
      await get(`from=2087-01-04&to=2087-01-10&competition=${CONTINENTAL_COMPETITION}`)
    ).json() as ScoresResponse;
    expect(ids(continental)).toEqual([CONTINENTAL]);
  });

  it('pins a favourite team above the list and filters to follows on request', async () => {
    await pool.query(
      `INSERT INTO followed_entity (user_id, entity_type, entity_id, favourite) VALUES ($1, 'team', $2, true)`,
      [userId, REAL_MADRID],
    );
    const body = (await get('from=2087-01-04&to=2087-01-10', true)).json() as ScoresResponse;
    expect(body.pinned.map((c) => [c.id, c.pinned])).toEqual([[CONTINENTAL, true]]);
    expect(body.groups.map((g) => g.competition.id)).toEqual([PREMIER_LEAGUE]);
    expect(body.total).toBe(3);

    const only = (
      await get('from=2087-01-04&to=2087-01-10&favourites=1', true)
    ).json() as ScoresResponse;
    expect(ids(only)).toEqual([CONTINENTAL]);
    expect(only.total).toBe(1);
  });

  it('refuses favourites without a session and names bad parameters', async () => {
    expect((await get('favourites=1')).statusCode).toBe(401);
    const bad = await get('from=2087-01-10&to=2087-01-04&tz=Mars/Olympus');
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({
      error: 'validation',
      fields: { to: expect.any(String), tz: expect.any(String) },
    });
  });
});
