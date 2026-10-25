import { randomUUID } from 'node:crypto';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { ModelUpsetResponse } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { withTriggersOff } from '../../testing/cleanup';
import { ModelUpsetModule } from './model-upset.module';

/**
 * T-1507 against the real schema: the day's finished match whose result the
 * model's last published pre-kick-off version rated least likely, among
 * seasons whose scores are fully covered, ties broken by kick-off; a version
 * written after kick-off never counts; a day with nothing that qualifies is
 * an explicit `not_supplied`. The days are far in the future and picked per
 * run, so other files' rows never fall on them.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const ENGLAND = '00000000-0000-4000-8000-000000000101';
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const SEED = Number.parseInt(RUN, 36);
const pad = (n: number) => String(n).padStart(2, '0');
const YEAR = 2041 + (SEED % 50);
const MONTH = pad((SEED % 12) + 1);
const DAY_OF_MONTH = (SEED % 27) + 1;
const DAY = `${YEAR}-${MONTH}-${pad(DAY_OF_MONTH)}`;
// The day after: a finished match whose only version came after kick-off.
const NEXT_DAY = `${YEAR}-${MONTH}-${pad(DAY_OF_MONTH + 1)}`;
const MODEL = `upset-${RUN}@0.1.0`;

type P = { home: number; draw: number; away: number };

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('the model upset', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  const covered = { competition: randomUUID(), season: randomUUID() };
  const limited = { competition: randomUUID(), season: randomUUID() };
  const teams = [randomUUID(), randomUUID()];
  const fixtures = {
    // Away win, last pre-kick-off version 0.20 on it; an earlier 0.10 and a
    // post-kick-off 0.05 are both ignored.
    upset: randomUUID(),
    // A draw rated 0.20 too, kicking off later: the tie goes to `upset`.
    tied: randomUUID(),
    // The favourite won.
    expected: randomUUID(),
    // Rated 0.02, but its last pre-kick-off version was on limited data.
    limitedData: randomUUID(),
    // Rated 0.01, but its season's scores are only `limited`.
    limitedSeason: randomUUID(),
    // Rated 0.01, abandoned with a score on record.
    abandoned: randomUUID(),
    // Still to play that evening.
    scheduled: randomUUID(),
    // The next day: finished, its only version made after kick-off.
    lateOnly: randomUUID(),
  };
  let modelVersionId = '';

  const get = async (query: string) => {
    const response = await app.inject({ method: 'GET', url: `/model/upset${query}` });
    return { status: response.statusCode, body: response.json<ModelUpsetResponse>() };
  };

  async function fixture(
    id: string,
    season: string,
    kickoff: string,
    status: string,
    score: [number, number] | null,
  ): Promise<void> {
    await pool.query(
      `INSERT INTO fixture (id, season_id, round, kickoff_at, status)
       VALUES ($1, $2, 'Upset test', $3, $4)`,
      [id, season, kickoff, status],
    );
    await pool.query(
      `INSERT INTO fixture_participant (fixture_id, team_id, side)
       VALUES ($1, $2, 'home'), ($1, $3, 'away')`,
      [id, teams[0], teams[1]],
    );
    if (score !== null) {
      await pool.query(
        `INSERT INTO fixture_score (fixture_id, kind, home, away) VALUES ($1, 'full_time', $2, $3)`,
        [id, score[0], score[1]],
      );
    }
  }

  async function forecast(
    fixtureId: string,
    version: number,
    computedAt: string,
    p: P,
    completeness: 'available' | 'limited' = 'available',
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
       ) VALUES ($1, $2, $3, $4, $5, 'available', $6, $7, $8, 1.2, 1.1, '[]', '[]', $9, 'published')`,
      [
        fixtureId,
        rows[0]!.id,
        modelVersionId,
        version,
        computedAt,
        p.home,
        p.draw,
        p.away,
        completeness,
      ],
    );
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, ModelUpsetModule],
    }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    pool = new Pool({ connectionString: DATABASE_URL });

    for (const [index, id] of teams.entries()) {
      await pool.query(
        `INSERT INTO team (id, country_id, name, short_name, kind, gender)
         VALUES ($1, $2, $3, $4, 'club', 'men')`,
        [id, ENGLAND, `Upset ${index} ${RUN}`, `UP${index}`],
      );
    }
    for (const [{ competition, season }, state] of [
      [covered, 'available'],
      [limited, 'limited'],
    ] as const) {
      await pool.query(
        `INSERT INTO competition (id, country_id, name, short_name, kind, scope, gender)
         VALUES ($1, $2, $3, 'UPS', 'league', 'domestic', 'men')`,
        [competition, ENGLAND, `Upset League ${state} ${RUN}`],
      );
      await pool.query(
        `INSERT INTO season (id, competition_id, label, start_date, end_date, is_current)
         VALUES ($1, $2, $3, DATE '2041-01-01', DATE '2091-12-31', false)`,
        [season, competition, `U${RUN}`],
      );
      await pool.query(
        `INSERT INTO coverage_profile (season_id, module, state, provider)
         VALUES ($1, 'scores', $2, 'api_football')`,
        [season, state],
      );
    }
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO model_version (model_id) VALUES ($1) RETURNING id`,
      [MODEL],
    );
    modelVersionId = rows[0]!.id;

    const at = (day: string, time: string) => `${day}T${time}:00Z`;
    await fixture(fixtures.upset, covered.season, at(DAY, '12:00'), 'finished', [0, 2]);
    await forecast(fixtures.upset, 1, at(DAY, '08:00'), { home: 0.7, draw: 0.2, away: 0.1 });
    await forecast(fixtures.upset, 2, at(DAY, '11:00'), { home: 0.6, draw: 0.2, away: 0.2 });
    await forecast(fixtures.upset, 3, at(DAY, '12:30'), { home: 0.9, draw: 0.05, away: 0.05 });

    await fixture(fixtures.tied, covered.season, at(DAY, '15:00'), 'finished', [1, 1]);
    await forecast(fixtures.tied, 1, at(DAY, '14:00'), { home: 0.6, draw: 0.2, away: 0.2 });

    await fixture(fixtures.expected, covered.season, at(DAY, '17:00'), 'finished', [3, 0]);
    await forecast(fixtures.expected, 1, at(DAY, '16:00'), { home: 0.55, draw: 0.25, away: 0.2 });

    await fixture(fixtures.limitedData, covered.season, at(DAY, '13:00'), 'finished', [0, 1]);
    await forecast(fixtures.limitedData, 1, at(DAY, '09:00'), { home: 0.5, draw: 0.3, away: 0.2 });
    await forecast(
      fixtures.limitedData,
      2,
      at(DAY, '12:00'),
      { home: 0.9, draw: 0.08, away: 0.02 },
      'limited',
    );

    await fixture(fixtures.limitedSeason, limited.season, at(DAY, '12:00'), 'finished', [0, 1]);
    await forecast(fixtures.limitedSeason, 1, at(DAY, '10:00'), {
      home: 0.9,
      draw: 0.09,
      away: 0.01,
    });

    await fixture(fixtures.abandoned, covered.season, at(DAY, '12:00'), 'abandoned', [0, 1]);
    await forecast(fixtures.abandoned, 1, at(DAY, '10:00'), { home: 0.9, draw: 0.09, away: 0.01 });

    await fixture(fixtures.scheduled, covered.season, at(DAY, '20:00'), 'scheduled', null);

    await fixture(fixtures.lateOnly, covered.season, at(NEXT_DAY, '12:00'), 'finished', [0, 1]);
    await forecast(fixtures.lateOnly, 1, at(NEXT_DAY, '13:00'), {
      home: 0.9,
      draw: 0.09,
      away: 0.01,
    });
  }, 60_000);

  afterAll(async () => {
    await withTriggersOff(pool, async (client) => {
      for (const id of Object.values(fixtures)) {
        await client.query(`DELETE FROM forecast WHERE fixture_id = $1`, [id]);
        await client.query(`DELETE FROM input_snapshot WHERE fixture_id = $1`, [id]);
        await client.query(`DELETE FROM fixture_score WHERE fixture_id = $1`, [id]);
        await client.query(`DELETE FROM fixture_participant WHERE fixture_id = $1`, [id]);
        await client.query(`DELETE FROM fixture WHERE id = $1`, [id]);
      }
      await client.query(`DELETE FROM model_version WHERE id = $1`, [modelVersionId]);
      for (const { competition, season } of [covered, limited]) {
        await client.query(`DELETE FROM coverage_profile WHERE season_id = $1`, [season]);
        await client.query(`DELETE FROM season WHERE id = $1`, [season]);
        await client.query(`DELETE FROM competition WHERE id = $1`, [competition]);
      }
      await client.query(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [teams]);
    });
    await pool.end();
    await app.close();
  }, 60_000);

  it("names the finished match the model's last pre-kick-off version rated least likely", async () => {
    const { status, body } = await get(`?date=${DAY}`);
    expect(status).toBe(200);
    expect(body).toMatchObject({
      date: DAY,
      time_zone: 'UTC',
      coverage: 'available',
      reason: null,
      // upset, tied, expected and limitedData: not the limited season, not the abandoned match.
      finished_matches: 4,
      still_to_play: 1,
      upset: {
        fixture_id: fixtures.upset,
        kickoff_at: new Date(`${DAY}T12:00:00Z`).toISOString(),
        competition: { id: covered.competition, short_name: 'UPS' },
        season_id: covered.season,
        home_team: { id: teams[0], name: `Upset 0 ${RUN}`, short_name: 'UP0' },
        away_team: { id: teams[1], name: `Upset 1 ${RUN}`, short_name: 'UP1' },
        score: { home: 0, away: 2 },
        outcome: 'away',
        // Version 2, the last before kick-off: not version 1's 0.10, nor version 3's 0.05.
        probability: 0.2,
        probabilities: { home: 0.6, draw: 0.2, away: 0.2 },
        forecast: {
          version_number: 2,
          kind: 'early',
          model_version: MODEL,
          computed_at: new Date(`${DAY}T11:00:00Z`).toISOString(),
        },
      },
    });
    expect(body.last_updated_at).not.toBeNull();
  });

  it("reads the day in the reader's zone", async () => {
    // At UTC+14, DAY's afternoon is already the next day, and DAY itself ended
    // at 10:00 UTC, before any of its matches.
    const { body } = await get(`?date=${NEXT_DAY}&tz=Pacific/Kiritimati`);
    expect(body).toMatchObject({ time_zone: 'Pacific/Kiritimati', coverage: 'available' });
    expect(body.upset?.fixture_id).toBe(fixtures.upset);
    const before = await get(`?date=${DAY}&tz=Pacific/Kiritimati`);
    expect(before.body).toMatchObject({ coverage: 'not_supplied', reason: 'no_finished_match' });
  });

  it('ignores a version written after kick-off: a day with only one is not supplied', async () => {
    const { body } = await get(`?date=${NEXT_DAY}`);
    expect(body).toEqual({
      date: NEXT_DAY,
      time_zone: 'UTC',
      finished_matches: 1,
      still_to_play: 0,
      last_updated_at: expect.any(String),
      coverage: 'not_supplied',
      reason: 'no_covered_forecast',
      upset: null,
    });
  });

  it('says so when the day has no finished match at all', async () => {
    const { body } = await get(`?date=${YEAR + 60}-01-01`);
    expect(body).toEqual({
      date: `${YEAR + 60}-01-01`,
      time_zone: 'UTC',
      finished_matches: 0,
      still_to_play: 0,
      last_updated_at: null,
      coverage: 'not_supplied',
      reason: 'no_finished_match',
      upset: null,
    });
  });

  it('refuses a malformed day or zone', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/model/upset?date=tomorrow&tz=Nowhere',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: 'validation',
      fields: { date: expect.any(String), tz: expect.any(String) },
    });
  });
});
