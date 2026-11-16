import { randomUUID } from 'node:crypto';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { SocialCardResponse, SocialResultPayload } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { withTriggersOff } from '../../testing/cleanup';
import { SocialCardModule } from './social-card.module';

/**
 * T-1835 against the real schema: `GET /social-posts/:id/card` answers a live
 * post's frozen payload, and the same 404 for an id that is not a UUID, an
 * unknown one, and a `rejected`, `expired` or `superseded` post. The posts are
 * written with the triggers off (a post is otherwise never deleted, and its
 * states only reachable through the store), and removed the same way.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const PL_2025 = '00000000-0000-4000-8000-000000000302';
const REGULAR_SEASON = '00000000-0000-4000-8000-000000000401';
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
// A published post's slot, on a London day of its own per run (noon UTC is the same day in London).
const CLAIMED_AT = `${2041 + (Number.parseInt(RUN, 36) % 50)}-0${(Number.parseInt(RUN, 36) % 9) + 1}-1${Number.parseInt(RUN, 36) % 10}T12:00:00.000Z`;

const PAYLOAD: SocialResultPayload = {
  kind: 'result',
  fixture_id: '',
  competition: { id: randomUUID(), name: 'UEFA Nations League A' },
  kick_off: '2026-11-14T17:00:00.000Z',
  home: { id: randomUUID(), name: 'Norway', short_name: null, code: 'NOR' },
  away: { id: randomUUID(), name: 'Wales', short_name: null, code: 'WAL' },
  score: { home: 3, away: 1 },
  after_extra_time: false,
  penalties: null,
};

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('the social card read', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  const fixture = randomUUID();
  const posts = {
    pending_approval: randomUUID(),
    published: randomUUID(),
    rejected: randomUUID(),
    expired: randomUUID(),
    superseded: randomUUID(),
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    await withTriggersOff(pool, async (db) => {
      await db.query(
        `INSERT INTO fixture (id, season_id, stage_id, round, kickoff_at, status)
         VALUES ($1, $2, $3, 'Matchday', now() - interval '3 hours', 'finished')`,
        [fixture, PL_2025, REGULAR_SEASON],
      );
      // What each state's CHECKs ask of the row besides (the foreign keys
      // are off with the triggers, so the deciding person need not exist).
      const extra: Record<keyof typeof posts, Record<string, string | null>> = {
        pending_approval: {},
        published: {
          approved_by_name: 'automation',
          approved_at: CLAIMED_AT,
          post_day: CLAIMED_AT.slice(0, 10),
          slot: '5',
          claimed_at: CLAIMED_AT,
          provider_ref: `t1835-${fixture}`,
          published_at: CLAIMED_AT,
        },
        rejected: {
          decided_by: randomUUID(),
          decided_by_name: 'Teammate',
          decided_at: CLAIMED_AT,
          decided_reason: 'test',
        },
        expired: {},
        superseded: {},
      };
      // One network each, so the one-live-row index never meets two live rows.
      for (const [state, id] of Object.entries(posts) as [keyof typeof posts, string][]) {
        const columns = Object.keys(extra[state]);
        const values = Object.values(extra[state]);
        await db.query(
          `INSERT INTO social_post (id, fixture_id, kind, network, state, template_version, body, payload, inputs, gates, expires_at${columns.map((c) => `, ${c}`).join('')})
           VALUES ($1, $2, 'result', $3, $4, 'result@1', 'Full time', $5, '{}', '{}', now() + interval '1 day'${values.map((_, i) => `, $${i + 6}`).join('')})`,
          [
            id,
            fixture,
            state === 'published' ? 'instagram' : 'x',
            state,
            JSON.stringify({ ...PAYLOAD, fixture_id: fixture, drafting_note: 'internal' }),
            ...values,
          ],
        );
      }
    });
    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, SocialCardModule],
    }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app?.close();
    if (pool !== undefined) {
      await withTriggersOff(pool, async (db) => {
        await db.query(`DELETE FROM social_post WHERE fixture_id = $1`, [fixture]);
        await db.query(`DELETE FROM fixture WHERE id = $1`, [fixture]);
      });
      await pool.end();
    }
  });

  const get = (id: string) => app.inject({ method: 'GET', url: `/social-posts/${id}/card` });

  it("answers a live or published post's card fields alone, never indexed or kept", async () => {
    for (const id of [posts.pending_approval, posts.published]) {
      const response = await get(id);
      expect(response.statusCode).toBe(200);
      expect(response.headers['x-robots-tag']).toBe('noindex');
      expect(response.headers['cache-control']).toBe('no-store');
      const body = response.json<SocialCardResponse>();
      // Only what a card draws: a key the drafting kept beside it stays private.
      expect(body).toEqual({
        id,
        published: id === posts.published,
        payload: { ...PAYLOAD, fixture_id: fixture, round: null, half_time: null, goals: null },
      });
    }
    // The id in capitals is the same post.
    expect((await get(posts.published.toUpperCase())).statusCode).toBe(200);
  });

  it('answers the same 404 for a malformed, unknown, rejected, expired or superseded post', async () => {
    const ids = ['not-a-uuid', randomUUID(), posts.rejected, posts.expired, posts.superseded];
    for (const id of ids) {
      const response = await get(id);
      expect(response.statusCode, id).toBe(404);
      expect(response.json()).toMatchObject({ error: 'not_found', message: 'No such card.' });
    }
  });
});
