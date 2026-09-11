import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { MatchCentre } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../identity/identity.service';
import { FixturesModule } from './fixtures.module';

// The match centre is joins over eight tables and coverage decided against
// the seeded profile; it runs against the real schema or not at all.
const DATABASE_URL = process.env.DATABASE_URL;

// Seeded catalog (packages/db/seed/001_catalog.sql, 003_ingestion.sql).
const PL_2024 = '00000000-0000-4000-8000-000000000301'; // scores limited, everything else not_supplied
const PERSEPOLIS = '00000000-0000-4000-8000-000000000604';
const REAL_MADRID = '00000000-0000-4000-8000-000000000603';
const LIVERPOOL = '00000000-0000-4000-8000-000000000602';
const SALAH = '00000000-0000-4000-8000-000000000701';
const BRUNO = '00000000-0000-4000-8000-000000000702';
const BERNABEU = '00000000-0000-4000-8000-000000000503';

// A cluster in 2086 on two clubs no seed or other suite gives a finished
// match: Real Madrid v Persepolis, three earlier Real Madrid matches (two
// against Persepolis) and one earlier Persepolis match against Liverpool.
const MATCH = randomUUID();
const EARLIER = [randomUUID(), randomUUID(), randomUUID(), randomUUID()] as const;

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('GET /fixtures/:id', () => {
  let app: NestFastifyApplication;
  let pool: Pool;

  const get = (id: string) => app.inject({ method: 'GET', url: `/fixtures/${id}` });

  beforeAll(async () => {
    // The fixtures module imports identity for the scores route; the match
    // centre itself is public and never reads the session.
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
      `INSERT INTO fixture (id, season_id, round, kickoff_at, status, venue_id, attendance) VALUES
         ($1, $6, 'Matchweek 30', TIMESTAMPTZ '2086-03-15 16:30:00+00', 'finished', $7, 60000),
         ($2, $6, 'Matchweek 29', TIMESTAMPTZ '2086-03-08 15:00:00+00', 'finished', NULL, NULL),
         ($3, $6, 'Matchweek 28', TIMESTAMPTZ '2086-03-01 15:00:00+00', 'finished', NULL, NULL),
         ($4, $6, 'Matchweek 27', TIMESTAMPTZ '2086-02-22 15:00:00+00', 'finished', NULL, NULL),
         ($5, $6, 'Matchweek 26', TIMESTAMPTZ '2086-02-15 15:00:00+00', 'finished', NULL, NULL)`,
      [MATCH, ...EARLIER, PL_2024, BERNABEU],
    );
    // MATCH: Real Madrid v Persepolis. Earlier: RMA v PER (2-0), PER v RMA (1-1),
    // RMA v LIV (0-3), PER v LIV (2-1).
    await pool.query(
      `INSERT INTO fixture_participant (fixture_id, team_id, side, formation) VALUES
         ($1, $6, 'home', '4-3-3'), ($1, $7, 'away', '4-2-3-1'),
         ($2, $6, 'home', NULL), ($2, $7, 'away', NULL),
         ($3, $7, 'home', NULL), ($3, $6, 'away', NULL),
         ($4, $6, 'home', NULL), ($4, $8, 'away', NULL),
         ($5, $7, 'home', NULL), ($5, $8, 'away', NULL)`,
      [MATCH, ...EARLIER, REAL_MADRID, PERSEPOLIS, LIVERPOOL],
    );
    await pool.query(
      `INSERT INTO fixture_score (fixture_id, kind, home, away) VALUES
         ($1, 'half_time', 1, 0), ($1, 'full_time', 2, 1), ($1, 'current', 2, 1),
         ($2, 'full_time', 2, 0), ($3, 'full_time', 1, 1), ($4, 'full_time', 0, 3), ($5, 'full_time', 2, 1)`,
      [MATCH, ...EARLIER],
    );
    await pool.query(
      `INSERT INTO fixture_period (fixture_id, kind, sequence, started_at, ended_at, added_minutes) VALUES
         ($1, 'first_half', 1, TIMESTAMPTZ '2086-03-15 16:30:00+00', TIMESTAMPTZ '2086-03-15 17:17:00+00', 2),
         ($1, 'second_half', 2, TIMESTAMPTZ '2086-03-15 17:33:00+00', TIMESTAMPTZ '2086-03-15 18:22:00+00', 4)`,
      [MATCH],
    );
    const { rows } = await pool.query<{ id: string; side: string }>(
      `SELECT id, side FROM fixture_participant WHERE fixture_id = $1`,
      [MATCH],
    );
    const home = rows.find((r) => r.side === 'home')?.id;
    const away = rows.find((r) => r.side === 'away')?.id;
    await pool.query(
      `INSERT INTO incident (fixture_id, participant_id, person_id, related_person_id, kind, minute, added_time, sequence, detail) VALUES
         ($1, $2, $4, NULL, 'goal', 23, NULL, 1, NULL),
         ($1, $3, $5, NULL, 'yellow_card', 45, 1, 2, NULL),
         ($1, $3, $5, NULL, 'penalty_goal', 67, NULL, 3, NULL),
         ($1, $2, $4, $5, 'substitution', 80, NULL, 4, NULL),
         ($1, NULL, NULL, NULL, 'var', 88, NULL, 5, 'Goal cancelled')`,
      [MATCH, home, away, SALAH, BRUNO],
    );
    await pool.query(
      `INSERT INTO lineup (participant_id, person_id, role, shirt_number, position, is_captain) VALUES
         ($1, $3, 'starter', 11, 'forward', true),
         ($2, $4, 'starter', 8, 'midfielder', true)`,
      [home, away, SALAH, BRUNO],
    );
    await pool.query(
      `INSERT INTO fixture_stat (participant_id, metric, value) VALUES
         ($1, 'possession_pct', 58.5), ($2, 'possession_pct', 41.5),
         ($1, 'shots', 14), ($2, 'shots', 7),
         ($1, 'expected_goals', 2.13)`,
      [home, away],
    );
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM fixture WHERE id = ANY($1::uuid[])`, [[MATCH, ...EARLIER]]);
    await pool.end();
    await app.close();
  });

  it('answers 404 for an unknown or malformed id', async () => {
    expect((await get(randomUUID())).statusCode).toBe(404);
    expect((await get('nope')).statusCode).toBe(404);
  });

  it('serves the header: teams, score by kind, venue, periods, formations, last update', async () => {
    const response = await get(MATCH);
    expect(response.statusCode).toBe(200);
    const { fixture } = response.json() as MatchCentre;
    expect(fixture).toMatchObject({
      id: MATCH,
      status: 'finished',
      minute: null,
      round: 'Matchweek 30',
      home: { id: REAL_MADRID, name: 'Real Madrid', formation: '4-3-3', coach: null },
      away: { id: PERSEPOLIS, formation: '4-2-3-1' },
      scores: {
        half_time: { home: 1, away: 0 },
        full_time: { home: 2, away: 1 },
        current: { home: 2, away: 1 },
        extra_time: null,
        penalties: null,
        aggregate: null,
      },
      venue: { id: BERNABEU, name: 'Santiago Bernabéu', city: 'Madrid' },
      is_neutral_venue: false,
      referee: null,
      attendance: 60000,
      season: { id: PL_2024, label: '2024/25' },
    });
    expect(fixture.periods.map((p) => [p.kind, p.added_minutes, p.ended_at !== null])).toEqual([
      ['first_half', 2, true],
      ['second_half', 4, true],
    ]);
    expect(fixture.periods[0]?.started_at).toBe('2086-03-15T16:30:00.000Z');
    expect(Date.parse(fixture.last_updated_at)).toBeGreaterThan(0);
  });

  it('serves the timeline in order with sides by participant and both players of a substitution', async () => {
    const { timeline } = (await get(MATCH)).json() as MatchCentre;
    // The seeded profile says incidents are not supplied for this season, yet rows exist: limited.
    expect(timeline.coverage).toBe('limited');
    expect(
      timeline.data?.map((i) => [
        i.sequence,
        i.kind,
        i.side,
        i.player?.name ?? null,
        i.related_player?.name ?? null,
      ]),
    ).toEqual([
      [1, 'goal', 'home', 'Mohamed Salah', null],
      [2, 'yellow_card', 'away', 'Bruno Fernandes', null],
      [3, 'penalty_goal', 'away', 'Bruno Fernandes', null],
      [4, 'substitution', 'home', 'Mohamed Salah', 'Bruno Fernandes'],
      [5, 'var', null, null, null],
    ]);
    expect(timeline.data?.[1]?.added_time).toBe(1);
    expect(timeline.last_updated_at).not.toBeNull();
  });

  it('pairs statistics per metric and leaves an unsupplied side null, never zero', async () => {
    const { statistics } = (await get(MATCH)).json() as MatchCentre;
    expect(statistics.coverage).toBe('limited');
    expect(statistics.data).toEqual([
      { metric: 'expected_goals', home: 2.13, away: null },
      { metric: 'possession_pct', home: 58.5, away: 41.5 },
      { metric: 'shots', home: 14, away: 7 },
    ]);
  });

  it('serves both line-ups with captains, and the season coverage per module', async () => {
    const body = (await get(MATCH)).json() as MatchCentre;
    expect(body.lineups.coverage).toBe('limited');
    expect(body.lineups.data?.home).toEqual([
      {
        id: SALAH,
        name: 'Mohamed Salah',
        role: 'starter',
        shirt_number: 11,
        position: 'forward',
        is_captain: true,
      },
    ]);
    expect(body.lineups.data?.away[0]?.name).toBe('Bruno Fernandes');
    expect(body.coverage).toEqual({
      scores: 'limited',
      incidents: 'not_supplied',
      lineups: 'not_supplied',
      statistics: 'not_supplied',
      standings: 'not_supplied',
      availability: 'not_supplied',
      advanced_statistics: 'not_supplied',
    });
  });

  it('derives recent form and head-to-head from our own results, newest first', async () => {
    const { form, head_to_head } = (await get(MATCH)).json() as MatchCentre;
    // Real Madrid before this match: W 2-0 v PER (home), D 1-1 at PER, L 0-3 v LIV (home): three of five → limited.
    expect(form.home.coverage).toBe('limited');
    expect(
      form.home.data?.map((f) => [f.result, f.home, f.opponent.name, f.goals_for, f.goals_against]),
    ).toEqual([
      ['W', true, 'Persepolis', 2, 0],
      ['D', false, 'Persepolis', 1, 1],
      ['L', true, 'Liverpool', 0, 3],
    ]);
    expect(form.away.data?.map((f) => [f.result, f.opponent.name])).toEqual([
      ['L', 'Real Madrid'],
      ['D', 'Real Madrid'],
      ['W', 'Liverpool'],
    ]);
    expect(head_to_head.coverage).toBe('limited');
    expect(
      head_to_head.data?.map((m) => [m.home.name, m.full_time.home, m.full_time.away, m.away.name]),
    ).toEqual([
      ['Real Madrid', 2, 0, 'Persepolis'],
      ['Persepolis', 1, 1, 'Real Madrid'],
    ]);
    expect(head_to_head.last_updated_at).toBe('2086-03-08T15:00:00.000Z');
  });
});
