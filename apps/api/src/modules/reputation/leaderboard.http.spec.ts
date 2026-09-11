import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { ApiError, LeaderboardResponse } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { MODEL_CLIENT, ModelClient } from '../forecast/forecast.service';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../identity/identity.service';
import { LEADERBOARD_RULES_V1 } from './internal/leaderboard';
import { ReputationModule } from './reputation.module';

// The board is a function of the stored rating snapshots, so the suite
// writes snapshots (the insert-only path the engine uses) and checks what the
// board makes of them. The acceptance criterion: a one-prediction account
// cannot top the board, however high its rating. Needs the real schema.
const DATABASE_URL = process.env.DATABASE_URL;
vi.setConfig({ testTimeout: 20_000 });

const ENGLAND = '00000000-0000-4000-8000-000000000101';
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const FLOOR = LEADERBOARD_RULES_V1.floor;

const COMPONENTS = { result: 0.7, exact_score: 0.2, consistency: 0.6, confidence: 0.5 };

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('Leaderboard', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  const users: Record<'lucky' | 'steady' | 'newly' | 'former', { id: string; username: string }> = {
    lucky: { id: '', username: `lb_${RUN}l` },
    steady: { id: '', username: `lb_${RUN}s` },
    newly: { id: '', username: `lb_${RUN}n` },
    former: { id: '', username: `lb_${RUN}f` },
  };

  const get = (url: string) => app.inject({ method: 'GET', url });

  async function register(username: string): Promise<string> {
    const registered = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        username,
        display_name: 'Board Tester',
        email: `${username}@example.test`,
        password: 'correct horse battery staple',
        country_id: ENGLAND,
        preferred_language: 'en',
        timezone: 'Europe/London',
        accept_rules: true,
      },
    });
    return (registered.json() as { user: { id: string } }).user.id;
  }

  async function snapshot(
    userId: string,
    settled: number,
    rating: number,
    computedAgo = '0 seconds',
  ) {
    await pool.query(
      `INSERT INTO rating_snapshot
         (user_id, formula_version, settled_count, rating, components, provisional, established,
          inputs_hash, computed_at)
       VALUES ($1, 'performance-rating@1.0.0', $2, $3, $4::jsonb, $5, $6, $7,
               now() - $8::interval)`,
      [
        userId,
        settled,
        rating,
        JSON.stringify(COMPONENTS),
        settled < 30,
        settled >= 50,
        `test-${RUN}-${settled}-${rating}`,
        computedAgo,
      ],
    );
  }

  const ours = (board: LeaderboardResponse) =>
    board.entries.filter((e) => e.username.startsWith(`lb_${RUN}`));

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
      .useValue(new ModelClient({ baseUrl: 'http://model.test' }))
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    pool = new Pool({ connectionString: DATABASE_URL });
    for (const key of Object.keys(users) as (keyof typeof users)[])
      users[key].id = await register(users[key].username);

    // One settled prediction, a perfect result: the highest rating on the board.
    await snapshot(users.lucky.id, 1, 99.5);
    // An established member whose rating rose: the newest snapshot is the one that counts.
    await snapshot(users.steady.id, 40, 50, '1 hour');
    await snapshot(users.steady.id, 60, 72.4);
    // Just past the floor.
    await snapshot(users.newly.id, FLOOR, 60);
    // A high rating on a suspended account: not shown.
    await snapshot(users.former.id, 80, 90);
    await pool.query(`UPDATE user_account SET status = 'suspended' WHERE id = $1`, [
      users.former.id,
    ]);
  });

  afterAll(async () => {
    const ids = Object.values(users).map((u) => u.id);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('ALTER TABLE rating_snapshot DISABLE TRIGGER rating_snapshot_immutable');
      await client.query(`DELETE FROM rating_snapshot WHERE user_id = ANY($1::uuid[])`, [ids]);
      await client.query('ALTER TABLE rating_snapshot ENABLE TRIGGER rating_snapshot_immutable');
      await client.query(`DELETE FROM user_account WHERE id = ANY($1::uuid[])`, [ids]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    await pool.end();
    await app.close();
  });

  it('ranks by current rating and never shows a sample under the floor', async () => {
    const response = await get('/leaderboard');
    expect(response.statusCode).toBe(200);
    const board = response.json() as LeaderboardResponse;
    expect(board.rules_version).toBe(LEADERBOARD_RULES_V1.version);
    expect(board.min_settled).toBe(FLOOR);
    expect(board.floor).toBe(FLOOR);
    expect(board.presets).toEqual(LEADERBOARD_RULES_V1.presets);

    // The acceptance criterion: the highest rating in the database belongs to
    // the one-prediction account, and it is nowhere on the board.
    for (const entry of board.entries) expect(entry.settled_count).toBeGreaterThanOrEqual(FLOOR);
    expect(board.entries.some((e) => e.username === users.lucky.username)).toBe(false);
    expect(board.entries.some((e) => e.username === users.former.username)).toBe(false);

    const mine = ours(board);
    expect(mine.map((e) => e.username)).toEqual([users.steady.username, users.newly.username]);
    const steady = mine[0]!;
    expect(steady.rating).toBe(72.4);
    expect(steady.settled_count).toBe(60);
    expect(steady.established).toBe(true);
    expect(steady.tier).toBe('platinum');
    expect(mine[1]!.rank).toBeGreaterThan(steady.rank);
    // Ranks are dense from 1 and ordered the way the entries are.
    expect(board.entries[0]!.rank).toBe(1);
    for (let i = 1; i < board.entries.length; i += 1)
      expect(board.entries[i]!.rank).toBeGreaterThan(board.entries[i - 1]!.rank);
    expect(board.total).toBeGreaterThanOrEqual(2);
  });

  it('raises the bar on request, but never lowers it under the floor', async () => {
    const strict = (await get('/leaderboard?min_settled=50')).json() as LeaderboardResponse;
    expect(strict.min_settled).toBe(50);
    expect(ours(strict).map((e) => e.username)).toEqual([users.steady.username]);

    const response = await get('/leaderboard?min_settled=1');
    expect(response.statusCode).toBe(400);
    const error = response.json() as ApiError;
    expect(error.error).toBe('validation');
    expect(error.fields?.min_settled).toBe(`Must be at least ${FLOOR}.`);
  });

  it('pages with ranks that continue across pages', async () => {
    const first = (await get('/leaderboard?limit=1')).json() as LeaderboardResponse;
    const second = (await get('/leaderboard?limit=1&offset=1')).json() as LeaderboardResponse;
    expect(first.entries).toHaveLength(1);
    expect(first.entries[0]!.rank).toBe(1);
    expect(second.entries).toHaveLength(1);
    expect(second.entries[0]!.rank).toBe(2);
    expect(second.total).toBe(first.total);

    const beyond = (
      await get(`/leaderboard?offset=${first.total + 5}`)
    ).json() as LeaderboardResponse;
    expect(beyond.entries).toEqual([]);
    expect(beyond.total).toBe(first.total);

    expect((await get('/leaderboard?limit=0')).statusCode).toBe(400);
  });
});
