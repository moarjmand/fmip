import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { AchievementsResponse, RatingHistoryResponse, RatingResponse } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Kick-offs are made to pass for real (3 s), so the suite needs more than the default 5 s.
vi.setConfig({ testTimeout: 40_000, hookTimeout: 40_000 });
import { DatabaseModule } from '../../database/database.module';
import { MODEL_CLIENT, ModelClient } from '../forecast/forecast.service';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../identity/identity.service';
import { ReputationModule } from './reputation.module';
import { ReputationService } from './reputation.service';
import { deleteRatedAccounts, withTriggersOff } from '../../testing/cleanup';

// The acceptance criterion is "rating recomputable from stored records
// alone": settlements and forecast versions are written, the rating is
// computed from them, and a recomputation from the same rows yields the same
// number and no new snapshot. Needs the real schema (CI has it).
const DATABASE_URL = process.env.DATABASE_URL;

const ENGLAND = '00000000-0000-4000-8000-000000000101';
const PL_2025 = '00000000-0000-4000-8000-000000000302';
// Two clubs that exist only for this run: nothing else can add results to them.
const HOME_TEAM = randomUUID();
const AWAY_TEAM = randomUUID();
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const ROUND = `Rating test round ${RUN}`;

function cookieValue(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const match = /^fmip_session=([^;]*)/.exec(header ?? '');
  return match?.[1] ?? '';
}

/** A model that always favours the home side heavily (80 / 12 / 8). */
const scripted = new ModelClient({
  baseUrl: 'http://model.test',
  fetchImpl: async (input) => {
    const url = String(input);
    const fixtureId = /fixture_id"?:?"?([0-9a-f-]{36})/.exec(url)?.[1];
    void fixtureId;
    return new Response(
      JSON.stringify({
        fixture_id: '00000000-0000-4000-8000-000000000000',
        status: 'available',
        computed_at: new Date().toISOString(),
        probabilities: { home: 0.8, draw: 0.12, away: 0.08 },
        expected_goals: { home: 2.2, away: 0.6 },
        most_likely_scorelines: [{ home: 2, away: 0, probability: 0.15 }],
        leading_factors: [],
        inputs: {
          model_version: 'dixon-coles-elo@0.1.0',
          fit_date: '2026-01-01',
          matches_used: 200,
          elo_used: false,
          history_from: '2025-08-01',
          data_completeness: 'limited',
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  },
});

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('Performance Rating', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let service: ReputationService;
  const users: { id: string; cookie: string; username: string }[] = [];
  let admin = '';
  const fixtures: string[] = [];

  const inject = (
    method: 'GET' | 'POST' | 'PUT' | 'PATCH',
    url: string,
    cookie?: string,
    payload?: unknown,
  ) =>
    app.inject({
      method,
      url,
      payload: payload as Record<string, unknown> | undefined,
      headers: cookie === undefined ? {} : { cookie: `fmip_session=${cookie}` },
    });

  async function fixtureOpen(): Promise<string> {
    const id = randomUUID();
    fixtures.push(id);
    await pool.query(
      // One round of this run's own (T-643): no other fixture is in it, so
      // predicting all four is a full matchday.
      `INSERT INTO fixture (id, season_id, round, kickoff_at, status)
       VALUES ($1, $2, $3, now() + interval '10 seconds', 'scheduled')`,
      [id, PL_2025, ROUND],
    );
    await pool.query(
      `INSERT INTO fixture_participant (fixture_id, team_id, side) VALUES ($1, $2, 'home'), ($1, $3, 'away')`,
      [id, HOME_TEAM, AWAY_TEAM],
    );
    return id;
  }

  async function finish(id: string, home: number, away: number): Promise<void> {
    await pool.query(
      // Kick-off is not moved: the forecast and the predictions must really predate it.
      `UPDATE fixture SET status = 'finished' WHERE id = $1`,
      [id],
    );
    await pool.query(
      `INSERT INTO fixture_score (fixture_id, kind, home, away) VALUES ($1, 'full_time', $2, $3)`,
      [id, home, away],
    );
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, ReputationModule],
    })
      .overrideProvider(IDENTITY_OPTIONS)
      .useValue({
        ...DEFAULT_IDENTITY_OPTIONS,
        sessionSecret: 'test-secret-'.repeat(4),
        webBaseUrl: 'http://web.test',
        cookieSecure: false,
      })
      .overrideProvider(MODEL_CLIENT)
      .useValue(scripted)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    service = moduleRef.get(ReputationService);
    pool = new Pool({ connectionString: DATABASE_URL });
    await pool.query(
      `INSERT INTO team (id, name, kind, gender) VALUES ($1, $3, 'club', 'men'), ($2, $4, 'club', 'men')`,
      [HOME_TEAM, AWAY_TEAM, `Test Home ${RUN}`, `Test Away ${RUN}`],
    );

    for (const suffix of ['fav', 'ups', 'adm']) {
      const username = `rt_${RUN}${suffix}`;
      const registered = await inject('POST', '/auth/register', undefined, {
        username,
        display_name: 'Rating Tester',
        email: `${username}@example.test`,
        password: 'correct horse battery staple',
        country_id: ENGLAND,
        preferred_language: 'en',
        timezone: 'Europe/London',
        accept_rules: true,
      });
      const id = (registered.json() as { user: { id: string } }).user.id;
      users.push({ id, cookie: cookieValue(registered.headers['set-cookie']), username });
      await pool.query(`UPDATE user_account SET email_verified_at = now() WHERE id = $1`, [id]);
    }
    admin = users[2]!.cookie;
    await pool.query(
      `INSERT INTO user_role (user_id, role, granted_by, reason) VALUES ($1, 'admin', $1, 'rating test')`,
      [users[2]!.id],
    );
  });

  afterAll(async () => {
    // Seven tables named twice each: fourteen statements that existed only
    // because the setting was per table rather than per session.
    await withTriggersOff(pool, async (client) => {
      // Settlements first, so no recompute running in another suite picks
      // these members up again; `deleteRatedAccounts` then clears what one
      // already under way writes (points, snapshots) before the accounts go.
      await client.query(`DELETE FROM settlement WHERE fixture_id = ANY($1::uuid[])`, [fixtures]);
      await client.query(`DELETE FROM settlement_run WHERE fixture_id = ANY($1::uuid[])`, [
        fixtures,
      ]);
      await client.query(
        `DELETE FROM prediction_version WHERE prediction_id IN
           (SELECT id FROM user_prediction WHERE fixture_id = ANY($1::uuid[]))`,
        [fixtures],
      );
      await client.query(`DELETE FROM forecast WHERE fixture_id = ANY($1::uuid[])`, [fixtures]);
      await client.query(`DELETE FROM input_snapshot WHERE fixture_id = ANY($1::uuid[])`, [
        fixtures,
      ]);
    });
    const accounts = await pool.query<{ id: string }>(
      `SELECT id FROM user_account WHERE username LIKE $1`,
      [`rt_${RUN}%`],
    );
    await deleteRatedAccounts(
      pool,
      accounts.rows.map((r) => r.id),
    );
    await pool.query(`DELETE FROM fixture WHERE id = ANY($1::uuid[])`, [fixtures]);
    await pool.query(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [[HOME_TEAM, AWAY_TEAM]]);
    await pool.end();
    await app.close();
  });

  it('has no rating before anything is settled, and needs a session', async () => {
    expect((await inject('GET', '/me/rating')).statusCode).toBe(401);
    const mine = (await inject('GET', '/me/rating', users[0]!.cookie)).json() as RatingResponse;
    expect(mine).toEqual({ username: users[0]!.username, rating: null });
    const recomputed = (
      await inject('POST', '/me/rating/recompute', users[0]!.cookie)
    ).json() as RatingResponse;
    expect(recomputed.rating).toBeNull();
    expect((await inject('GET', `/users/nobody_${RUN}/rating`)).statusCode).toBe(404);
  });

  it('rates from settlements and stored forecasts: the favourite-picker below the upset-picker', async () => {
    const [fav, ups] = users;
    // Four matches. The model (stored as a forecast version before kick-off)
    // gives the home side 80%. fav always picks home; ups always picks away.
    // Results: home wins 3, away wins 1 → fav is right 3 times at difficulty
    // 0.8, ups is right once at difficulty 0.08.
    const results: [number, number][] = [
      [2, 0],
      [1, 0],
      [3, 1],
      [0, 1],
    ];
    const ids: string[] = [];
    for (const _ of results) {
      const id = await fixtureOpen();
      ids.push(id);
      const forecast = await inject('POST', `/fixtures/${id}/forecasts`, admin, { kind: 'early' });
      expect(forecast.statusCode).toBe(201);
      expect(
        (
          await inject('PUT', `/fixtures/${id}/prediction`, fav!.cookie, {
            outcome: 'home',
            confidence: 4,
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await inject('PUT', `/fixtures/${id}/prediction`, ups!.cookie, {
            outcome: 'away',
            confidence: 2,
          })
        ).statusCode,
      ).toBe(200);
    }
    // Let every kick-off pass by the database clock, then play the matches.
    // Ten seconds of room: under the full suite's load, six submissions took most of six.
    await new Promise((resolve) => setTimeout(resolve, 11_000));
    for (const [index, [home, away]] of results.entries()) {
      const id = ids[index]!;
      await finish(id, home, away);
      expect((await inject('POST', `/fixtures/${id}/settle`, admin)).statusCode).toBe(200);
    }

    const favRating = (
      await inject('POST', '/me/rating/recompute', fav!.cookie)
    ).json() as RatingResponse;
    const upsRating = (
      await inject('POST', '/me/rating/recompute', ups!.cookie)
    ).json() as RatingResponse;
    expect(favRating.rating).not.toBeNull();
    expect(upsRating.rating).not.toBeNull();
    // fav: 3 × (1 − 0.8) = 0.6 credit over 4 × 2/3 → 0.225. ups: 1 × 0.92 / 2.667 → 0.345.
    expect(favRating.rating?.components.result).toBe(0.225);
    expect(upsRating.rating?.components.result).toBe(0.345);
    expect(favRating.rating?.settled_count).toBe(4);
    expect(favRating.rating?.provisional).toBe(true);
    expect(favRating.rating?.formula_version).toBe('performance-rating@1.0.0');
    // Three right out of four at 80% earns less than one upset right out of four.
    expect(favRating.rating!.components.result).toBeLessThan(upsRating.rating!.components.result);

    const publicView = (
      await inject('GET', `/users/${fav!.username}/rating`)
    ).json() as RatingResponse;
    expect(publicView.rating).toEqual(favRating.rating);
  });

  it('is recomputable from stored records alone: the same rows give the same number and no new snapshot', async () => {
    const [fav] = users;
    const before = (await inject('GET', '/me/rating', fav!.cookie)).json() as RatingResponse;
    const first = await service.recompute(fav!.id);
    const second = await service.recompute(fav!.id);
    expect(first.kind).toBe('unchanged');
    expect(second.kind).toBe('unchanged');
    if (first.kind === 'unchanged' && second.kind === 'unchanged') {
      expect(first.rating).toEqual(second.rating);
      expect(first.rating).toEqual(before.rating);
    }
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM rating_snapshot WHERE user_id = $1`,
      [fav!.id],
    );
    expect(rows[0]?.n).toBe('1');
  });

  it('the history ends on the stored rating and its competitions add up (T-640)', async () => {
    const [fav] = users;
    const stored = (await inject('GET', '/me/rating', fav!.cookie)).json() as RatingResponse;
    const response = await inject('GET', `/users/${fav!.username}/rating/history`);
    expect(response.statusCode).toBe(200);
    const body = response.json() as RatingHistoryResponse;
    expect(body.kind).toBe('visible');
    if (body.kind !== 'visible' || body.history === null) throw new Error('no history');
    expect(body.history.points.at(-1)?.rating).toBe(stored.rating?.rating);
    expect(body.history.settled_total).toBe(4);
    expect(body.history.by_competition.reduce((n, c) => n + c.settled_count, 0)).toBe(4);
    expect(body.history.highest.rating).toBeGreaterThanOrEqual(stored.rating!.rating);
    // Reading the history writes nothing.
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM rating_snapshot WHERE user_id = $1`,
      [fav!.id],
    );
    expect(rows[0]?.n).toBe('1');
    const mine = (
      await inject('GET', '/me/rating/history', fav!.cookie)
    ).json() as RatingHistoryResponse;
    expect(mine.kind === 'visible' && mine.is_self).toBe(true);
    expect((await inject('GET', `/users/nobody_${RUN}/rating/history`)).statusCode).toBe(404);
    expect((await inject('GET', '/me/rating/history')).statusCode).toBe(401);
  });

  it('a new formula version is a new snapshot over the same records, and the old one stays', async () => {
    const [fav] = users;
    service.formula = { ...service.formula, version: 'performance-rating@1.0.1' };
    try {
      const outcome = await service.recompute(fav!.id);
      expect(outcome.kind).toBe('snapshot');
      if (outcome.kind === 'snapshot')
        expect(outcome.rating.formula_version).toBe('performance-rating@1.0.1');
    } finally {
      service.formula = { ...service.formula, version: 'performance-rating@1.0.0' };
    }
    const { rows } = await pool.query<{ formula_version: string }>(
      `SELECT formula_version FROM rating_snapshot WHERE user_id = $1 ORDER BY computed_at`,
      [fav!.id],
    );
    expect(rows.map((r) => r.formula_version)).toEqual([
      'performance-rating@1.0.0',
      'performance-rating@1.0.1',
    ]);
    await expect(
      pool.query(`UPDATE rating_snapshot SET rating = 99 WHERE user_id = $1`, [fav!.id]),
    ).rejects.toMatchObject({ code: '23001' });
  });

  it('the operator pass recomputes recently settled members and writes only real changes', async () => {
    expect((await inject('POST', '/ratings/recompute', users[0]!.cookie)).statusCode).toBe(403);
    const run = await inject('POST', '/ratings/recompute', admin);
    expect(run.statusCode).toBe(200);
    const body = run.json() as { users: number; snapshots: number };
    expect(body.users).toBeGreaterThanOrEqual(2);
    // fav is back on 1.0.0 (a change), ups is unchanged.
    expect(body.snapshots).toBeGreaterThanOrEqual(1);
  });

  it('derives achievements from the stored rows and follows the history visibility (T-643)', async () => {
    const [fav, ups] = users;
    const { rows } = await pool.query<{ first: Date; last: Date }>(
      `SELECT min(s.settled_at) AS first, max(s.settled_at) AS last
         FROM settlement s JOIN user_prediction p ON p.id = s.prediction_id
        WHERE p.user_id = $1::uuid AND s.status = 'settled'`,
      [fav!.id],
    );
    const response = await inject('GET', `/users/${fav!.username}/achievements`);
    expect(response.statusCode).toBe(200);
    const body = response.json() as AchievementsResponse;
    if (body.kind !== 'visible') throw new Error('restricted');
    expect(body.is_self).toBe(false);
    expect(body.achievements.rules_version).toBe('achievements@1.0.0');
    // Four settled, three right in a row at most, no exact score, one competition.
    expect(body.achievements.earned).toEqual([
      { kind: 'first_settled', earned_at: rows[0]!.first.toISOString(), round: null },
      {
        kind: 'full_matchday',
        earned_at: rows[0]!.last.toISOString(),
        round: {
          competition: expect.objectContaining({ id: expect.any(String) }),
          season_label: expect.any(String),
          round: ROUND,
        },
      },
    ]);
    // Derived on read: asking again gives the same list.
    const again = (
      await inject('GET', `/users/${fav!.username}/achievements`)
    ).json() as AchievementsResponse;
    expect(again.kind === 'visible' && again.achievements.earned).toEqual(body.achievements.earned);

    expect((await inject('GET', '/me/achievements')).statusCode).toBe(401);
    expect((await inject('GET', `/users/nobody_${RUN}/achievements`)).statusCode).toBe(404);

    expect(
      (
        await inject('PATCH', '/me/privacy', ups!.cookie, {
          prediction_history_visibility: 'private',
        })
      ).statusCode,
    ).toBe(200);
    expect((await inject('GET', `/users/${ups!.username}/achievements`)).json()).toEqual({
      kind: 'restricted',
      username: ups!.username,
      visibility: 'private',
    });
    const own = (
      await inject('GET', '/me/achievements', ups!.cookie)
    ).json() as AchievementsResponse;
    expect(own.kind === 'visible' && own.is_self).toBe(true);
    expect(own.kind === 'visible' && own.achievements.earned.map((a) => a.kind)).toEqual([
      'first_settled',
      'full_matchday',
    ]);
  });
});
