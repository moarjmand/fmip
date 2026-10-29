import { randomUUID } from 'node:crypto';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { MomentsResponse } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DatabaseModule, PG_POOL } from '../../database/database.module';
import { withTriggersOff } from '../../testing/cleanup';
import { MODEL_CLIENT, ModelClient } from '../forecast/forecast.service';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../identity/identity.service';
import { MOMENTS_CLOCK } from './moments.service';
import { MomentsModule } from './moments.module';

/**
 * T-1641 against the real schema: the scores page's cards, the last
 * published version before kick-off (never a later one, never a shadow), a
 * featured match as the big one, the counts in the reader's zone, a member's
 * followed matches first, and the reads staying a handful however many
 * matches the fortnight holds. "Now" is 18:00 UTC on a far-off day picked per
 * run, so no other suite's rows fall in the window read.
 */
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

const DATABASE_URL = process.env.DATABASE_URL;
const ENGLAND = '00000000-0000-4000-8000-000000000101';
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const SEED = Number.parseInt(RUN, 36);
const pad = (n: number) => String(n).padStart(2, '0');
const DAY = `${2160 + (SEED % 40)}-${pad((SEED % 12) + 1)}-${pad((SEED % 14) + 8)}`;
const NOW = new Date(`${DAY}T18:00:00.000Z`);
const at = (minutes: number): string => new Date(NOW.getTime() + minutes * 60_000).toISOString();
const HOUR = 60;
const MODEL = `moments-${RUN}@0.1.0`;
/**
 * Matches to come in the fortnight, beyond every window and after today in
 * Tokyo too: about what production's competitions hold in two weeks.
 */
const BULK = 250;
const BULK_ROUND = `Bulk ${RUN}`;

function cookieValue(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const match = /^fmip_session=([^;]*)/.exec(header ?? '');
  return match?.[1] ?? '';
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('GET /moments', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let cookie = '';
  let userId = '';
  let modelVersionId = '';
  const username = `mo_${RUN}`;
  const competitions = {
    top: { id: randomUUID(), season: randomUUID(), order: 1 as number | null },
    second: { id: randomUUID(), season: randomUUID(), order: 2 as number | null },
    bulk: { id: randomUUID(), season: randomUUID(), order: 4 as number | null },
    unranked: { id: randomUUID(), season: randomUUID(), order: null as number | null },
  };
  const seasons = Object.values(competitions).map((c) => c.season);
  const [followedTeam, b, c, d] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const fixtures = {
    against: randomUUID(), // live 70', 0-1; the away side had 0.20 in the last version before kick-off
    level: randomUUID(), // live 80', 1-1, no forecast; the followed team at home
    big: randomUUID(), // featured, to come today
    soon: randomUUID(), // a ranked competition's match in 20 minutes
    unrankedSoon: randomUUID(), // in 10 minutes, but its competition has no place
    even: randomUUID(), // the most even forecast within 12 hours
    upset: randomUUID(), // finished five hours ago, the away side won on 0.25
    followedLater: randomUUID(), // the followed team away tonight
    far: randomUUID(), // five days on
  };

  const get = (query = '', withCookie = false) =>
    app.inject({
      method: 'GET',
      url: `/moments${query}`,
      headers: withCookie ? { cookie: `fmip_session=${cookie}` } : {},
    });

  async function fixture(
    id: string,
    season: string,
    kickoff: string,
    status: string,
    [home, away]: [string, string],
    minute: number | null = null,
  ): Promise<void> {
    await pool.query(
      `INSERT INTO fixture (id, season_id, round, kickoff_at, status, minute)
       VALUES ($1, $2, 'Moments test', $3, $4, $5)`,
      [id, season, kickoff, status, minute],
    );
    await pool.query(
      `INSERT INTO fixture_participant (fixture_id, team_id, side)
       VALUES ($1, $2, 'home'), ($1, $3, 'away')`,
      [id, home, away],
    );
  }

  async function score(id: string, kind: 'current' | 'full_time', home: number, away: number) {
    await pool.query(
      `INSERT INTO fixture_score (fixture_id, kind, home, away) VALUES ($1, $2, $3, $4)`,
      [id, kind, home, away],
    );
  }

  async function forecast(
    fixtureId: string,
    version: number,
    computedAt: string,
    [home, draw, away]: [number, number, number],
    role: 'published' | 'shadow' = 'published',
  ): Promise<void> {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO input_snapshot (fixture_id, model_version_id, kind, request, model_inputs)
       VALUES ($1, $2, 'early', '{}'::jsonb, '{}'::jsonb) RETURNING id`,
      [fixtureId, modelVersionId],
    );
    await pool.query(
      `INSERT INTO forecast (
         fixture_id, input_snapshot_id, model_version_id, version_number, computed_at, status,
         p_home, p_draw, p_away, expected_home_goals, expected_away_goals,
         most_likely, leading_factors, data_completeness, role
       ) VALUES ($1, $2, $3, $4, $5, 'available', $6, $7, $8, 1.2, 1.1, '[]', '[]', 'available', $9)`,
      [fixtureId, rows[0]!.id, modelVersionId, version, computedAt, home, draw, away, role],
    );
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [DatabaseModule, MomentsModule] })
      .overrideProvider(IDENTITY_OPTIONS)
      .useValue({
        ...DEFAULT_IDENTITY_OPTIONS,
        sessionSecret: 'test-secret-'.repeat(4),
        webBaseUrl: 'http://web.test',
        cookieSecure: false,
      })
      .overrideProvider(MODEL_CLIENT)
      .useValue(
        new ModelClient({
          baseUrl: 'http://model.test.invalid',
          fetchImpl: () => Promise.reject(new Error('the moments never ask the model')),
        }),
      )
      .overrideProvider(MOMENTS_CLOCK)
      .useValue(() => new Date(NOW))
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    pool = new Pool({ connectionString: DATABASE_URL });

    for (const [index, id] of [followedTeam, b, c, d].entries()) {
      await pool.query(
        `INSERT INTO team (id, country_id, name, short_name, kind, gender)
         VALUES ($1, $2, $3, $4, 'club', 'men')`,
        [id, ENGLAND, `Moments ${index} ${RUN}`, `MO${index}`],
      );
    }
    for (const [name, { id, season, order }] of Object.entries(competitions)) {
      await pool.query(
        `INSERT INTO competition (id, country_id, name, short_name, kind, scope, gender, display_order)
         VALUES ($1, $2, $3, 'MOM', 'league', 'domestic', 'men', $4)`,
        [id, ENGLAND, `Moments ${name} ${RUN}`, order],
      );
      await pool.query(
        `INSERT INTO season (id, competition_id, label, start_date, end_date, is_current)
         VALUES ($1, $2, $3, DATE '2150-01-01', DATE '2210-12-31', false)`,
        [season, id, `M${RUN}`],
      );
    }
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO model_version (model_id) VALUES ($1) RETURNING id`,
      [MODEL],
    );
    modelVersionId = rows[0]!.id;

    const { top, second, bulk, unranked } = competitions;
    await fixture(fixtures.against, top.season, at(-85), 'live', [c, d], 70);
    await score(fixtures.against, 'current', 0, 1);
    await forecast(fixtures.against, 1, at(-24 * HOUR), [0.5, 0.3, 0.2]);
    await forecast(fixtures.against, 2, at(-2 * HOUR), [0.55, 0.25, 0.2]);
    await forecast(fixtures.against, 3, at(-10), [0.1, 0.1, 0.8]); // after kick-off
    await forecast(fixtures.against, 1, at(-3 * HOUR), [0.05, 0.05, 0.9], 'shadow');

    await fixture(fixtures.level, second.season, at(-95), 'live', [followedTeam, b], 80);
    await score(fixtures.level, 'current', 1, 1);

    await fixture(fixtures.big, top.season, at(3 * HOUR), 'scheduled', [c, b]);
    await forecast(fixtures.big, 1, at(-HOUR), [0.6, 0.2, 0.2]);

    await fixture(fixtures.soon, second.season, at(20), 'scheduled', [d, c]);
    await fixture(fixtures.unrankedSoon, unranked.season, at(10), 'scheduled', [b, d]);

    await fixture(fixtures.even, unranked.season, at(5 * HOUR), 'scheduled', [d, b]);
    await forecast(fixtures.even, 1, at(-HOUR), [0.34, 0.33, 0.33]);

    await fixture(fixtures.upset, top.season, at(-5 * HOUR), 'finished', [b, c]);
    await score(fixtures.upset, 'full_time', 0, 2);
    await forecast(fixtures.upset, 1, at(-6 * HOUR), [0.55, 0.2, 0.25]);

    await fixture(fixtures.followedLater, second.season, at(4 * HOUR), 'scheduled', [
      c,
      followedTeam,
    ]);
    await fixture(fixtures.far, top.season, at(5 * 24 * HOUR), 'scheduled', [followedTeam, d]);

    // The fortnight's other matches: none in any window, each with a forecast.
    await pool.query(
      `WITH made AS (
         INSERT INTO fixture (id, season_id, round, kickoff_at, status)
         SELECT gen_random_uuid(), $1, $2, $3::timestamptz + n * interval '1 hour', 'scheduled'
           FROM generate_series(0, $4::int - 1) AS n
         RETURNING id
       )
       INSERT INTO fixture_participant (fixture_id, team_id, side)
       SELECT id, $5::uuid, 'home' FROM made
       UNION ALL
       SELECT id, $6::uuid, 'away' FROM made`,
      [bulk.season, BULK_ROUND, at(22 * HOUR), BULK, c, d],
    );
    await pool.query(
      `WITH bulk AS (
         SELECT id, kickoff_at FROM fixture WHERE season_id = $1 AND round = $2
       ),
       snap AS (
         INSERT INTO input_snapshot (fixture_id, model_version_id, kind, request, model_inputs)
         SELECT id, $3, 'early', '{}'::jsonb, '{}'::jsonb FROM bulk
         RETURNING id, fixture_id
       )
       INSERT INTO forecast (
         fixture_id, input_snapshot_id, model_version_id, version_number, computed_at, status,
         p_home, p_draw, p_away, expected_home_goals, expected_away_goals,
         most_likely, leading_factors, data_completeness, role
       )
       SELECT s.fixture_id, s.id, $3, 1, b.kickoff_at - interval '1 day', 'available',
              0.5, 0.3, 0.2, 1.2, 1.1, '[]', '[]', 'available', 'published'
         FROM snap s JOIN bulk b ON b.id = s.fixture_id`,
      [bulk.season, BULK_ROUND, modelVersionId],
    );

    const registered = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        username,
        display_name: 'Moments Tester',
        email: `${username}@example.test`,
        password: 'correct horse battery staple',
        country_id: ENGLAND,
        preferred_language: 'en',
        timezone: 'Europe/London',
        accept_rules: true,
      },
    });
    expect(registered.statusCode).toBe(201);
    cookie = cookieValue(registered.headers['set-cookie']);
    userId = (registered.json() as { user: { id: string } }).user.id;
    await pool.query(
      `INSERT INTO followed_entity (user_id, entity_type, entity_id) VALUES ($1, 'team', $2)`,
      [userId, followedTeam],
    );
    // In force by the database's own clock, as an editor's feature is (D-153).
    await pool.query(
      `INSERT INTO homepage_feature (fixture_id, featured_by, note, ends_at)
       VALUES ($1, $2, 'The match of the night', now() + interval '1 day')`,
      [fixtures.big, userId],
    );
  });

  afterAll(async () => {
    await withTriggersOff(pool, async (client) => {
      const mine = `SELECT id FROM fixture WHERE season_id = ANY($1::uuid[])`;
      await client.query(`DELETE FROM homepage_feature WHERE fixture_id IN (${mine})`, [seasons]);
      await client.query(`DELETE FROM forecast WHERE fixture_id IN (${mine})`, [seasons]);
      await client.query(`DELETE FROM input_snapshot WHERE fixture_id IN (${mine})`, [seasons]);
      await client.query(`DELETE FROM fixture_score WHERE fixture_id IN (${mine})`, [seasons]);
      await client.query(`DELETE FROM fixture_participant WHERE fixture_id IN (${mine})`, [
        seasons,
      ]);
      await client.query(`DELETE FROM fixture WHERE season_id = ANY($1::uuid[])`, [seasons]);
      await client.query(`DELETE FROM model_version WHERE id = $1`, [modelVersionId]);
      await client.query(`DELETE FROM season WHERE id = ANY($1::uuid[])`, [seasons]);
      await client.query(`DELETE FROM competition WHERE id = ANY($1::uuid[])`, [
        Object.values(competitions).map((competition) => competition.id),
      ]);
      await client.query(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [[followedTeam, b, c, d]]);
    });
    await pool.query(`DELETE FROM user_account WHERE username = $1`, [username]);
    await pool.end();
    await app.close();
  });

  it('picks each fixture once, ranked, from the stored scores and pre-kick-off versions', async () => {
    const response = await get();
    expect(response.statusCode).toBe(200);
    const body = response.json<MomentsResponse>();
    expect(body).toMatchObject({ generated_at: NOW.toISOString(), timezone: 'UTC', live_count: 2 });
    expect(body.today_count).toBe(8);
    expect(body.moments.map((m) => [m.kind, m.fixture.id, m.side, m.followed])).toEqual([
      ['against_forecast', fixtures.against, 'away', false],
      ['level_late', fixtures.level, null, false],
      ['big_one', fixtures.big, null, false],
      ['starting_soon', fixtures.soon, null, false],
      ['closest_call', fixtures.even, null, false],
      ['upset', fixtures.upset, 'away', false],
    ]);

    const [against, level] = body.moments;
    // The last published version before kick-off: not v3 (after it), not the shadow.
    expect(against?.forecast).toEqual({
      home: 0.55,
      draw: 0.25,
      away: 0.2,
      model_version: MODEL,
      computed_at: at(-2 * HOUR),
    });
    // The scores page's own card, freshness and all.
    expect(against?.fixture).toMatchObject({
      status: 'live',
      minute: 70,
      scores: { current: { home: 0, away: 1 } },
      competition: { id: competitions.top.id },
      pinned: false,
    });
    expect(against?.fixture.last_updated_at).toEqual(expect.any(String));
    expect(against?.fixture.freshness).not.toBeNull();
    // No forecast is invented for a match the model was not asked about.
    expect(level).toMatchObject({ forecast: null, minutes_left: 10 });
  });

  it('puts a member’s followed matches first and keeps the rest the same', async () => {
    const body = (await get('', true)).json<MomentsResponse>();
    expect(body.moments.map((m) => [m.kind, m.fixture.id, m.followed])).toEqual([
      ['level_late', fixtures.level, true],
      ['followed', fixtures.followedLater, true],
      ['against_forecast', fixtures.against, false],
      ['big_one', fixtures.big, false],
      ['starting_soon', fixtures.soon, false],
      ['closest_call', fixtures.even, false],
      ['upset', fixtures.upset, false],
    ]);
    // The cards stay a guest's: nothing is pinned for the member.
    expect(body.moments.every((m) => !m.fixture.pinned)).toBe(true);
  });

  it('counts today in the reader’s zone', async () => {
    // 03:00 the next day in Tokyo: the upset (13:00 UTC) was yesterday there.
    const body = (await get('?timezone=Asia/Tokyo')).json<MomentsResponse>();
    expect(body).toMatchObject({ timezone: 'Asia/Tokyo', live_count: 2, today_count: 7 });
    expect(body.moments.find((m) => m.kind === 'big_one')?.fixture.id).toBe(fixtures.big);
  });

  it('reads a handful of times however many matches the fortnight holds', async () => {
    const dbPool = app.get<Pool>(PG_POOL);
    const spy = vi.spyOn(dbPool, 'query');
    const started = performance.now();
    const response = await get();
    const elapsed = performance.now() - started;
    const reads = spy.mock.calls.length;
    spy.mockRestore();
    expect(response.statusCode).toBe(200);
    // The scores and their media, the features, one batch of forecasts: never one per match.
    expect(reads).toBeLessThanOrEqual(5);
    expect(elapsed).toBeLessThan(5_000);
  });

  it('refuses a zone that is not an IANA name', async () => {
    const response = await get('?timezone=Nowhere/Town');
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: 'validation',
      fields: { timezone: expect.any(String) },
    });
  });
});
