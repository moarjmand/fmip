import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { LeaderboardResponse } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { IdentityModule } from '../identity/identity.module';
import {
  DEFAULT_IDENTITY_OPTIONS,
  IDENTITY_OPTIONS,
  type IdentityOptions,
} from '../identity/identity.service';
import { CaptureMailer, MAILER } from '../identity/internal/mailer';
import { ReputationModule } from './reputation.module';
import { LEADERBOARD_RULES_V1 } from './reputation.service';

/**
 * The group leaderboard (T-243), against the real schema.
 *
 * The acceptance criterion is **the same rating rules as the global board,
 * scoped — never a second formula**, and the way to test that is not to check
 * that two numbers happen to agree. It is to check that the *rules* the group
 * board reports are the ones `/leaderboard` reports, that the floor holds even
 * when holding it leaves a group with an empty board, and that what differs
 * between the two boards is exactly one thing: who is in the population.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const ENGLAND = '00000000-0000-4000-8000-000000000101';
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const FLOOR = LEADERBOARD_RULES_V1.floor;

const options: IdentityOptions = {
  ...DEFAULT_IDENTITY_OPTIONS,
  sessionSecret: 'test-secret-'.repeat(4),
  webBaseUrl: 'http://web.test',
  cookieSecure: false,
};

function cookieValue(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return /^fmip_session=([^;]*)/.exec(header ?? '')?.[1] ?? '';
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  'the group leaderboard over HTTP',
  () => {
    let app: NestFastifyApplication;
    let pool: Pool;

    const ada = `gl_${RUN}a`;
    const bo = `gl_${RUN}b`;
    const cass = `gl_${RUN}c`;
    const outsider = `gl_${RUN}o`;
    const cookies = new Map<string, string>();
    const ids = new Map<string, string>();
    let made = 0;

    const as = (who?: string) =>
      who === undefined ? {} : { cookie: `fmip_session=${cookies.get(who) ?? ''}` };
    const get = (url: string, who?: string) => app.inject({ method: 'GET', url, headers: as(who) });
    const post = (url: string, payload: unknown, who?: string) =>
      app.inject({
        method: 'POST',
        url,
        payload: payload as Record<string, unknown>,
        headers: as(who),
      });

    const register = async (username: string) => {
      const response = await post('/auth/register', {
        username,
        display_name: `Member ${username}`,
        email: `${username}@example.test`,
        password: 'a perfectly fine passphrase',
        country_id: ENGLAND,
        preferred_language: 'en',
        timezone: 'Europe/London',
        accept_rules: true,
      });
      expect(response.statusCode).toBe(201);
      cookies.set(username, cookieValue(response.headers['set-cookie']));
      const { rows } = await pool.query<{ id: string }>(
        `UPDATE user_account SET email_verified_at = now() WHERE username = $1 RETURNING id`,
        [username],
      );
      ids.set(username, rows[0]?.id ?? '');
    };

    /** A rating, written the way a settlement would leave one. */
    const rate = async (who: string, rating: number, settled: number) => {
      await pool.query(
        `INSERT INTO rating_snapshot
           (user_id, formula_version, settled_count, rating, components,
            provisional, established, inputs_hash)
         VALUES ($1, 'rating@1.0.0', $2, $3, '{}'::jsonb, $4, $5, $6)`,
        [
          ids.get(who) ?? '',
          settled,
          rating,
          settled < FLOOR,
          settled >= FLOOR,
          `${RUN}-${who}-${settled}`,
        ],
      );
    };

    const group = async (who: string, visibility: string): Promise<string> => {
      await pool.query(`DELETE FROM rate_window WHERE user_id = $1 AND action = 'group_create'`, [
        ids.get(who) ?? '',
      ]);
      made += 1;
      const slug = `gl-${RUN}-${made}`.toLowerCase();
      const response = await post(
        '/groups',
        { slug, name: `Group ${made}`, visibility, description: 'a test group' },
        who,
      );
      expect(response.statusCode).toBe(201);
      return slug;
    };

    const board = async (url: string, who: string): Promise<LeaderboardResponse> => {
      const response = await get(url, who);
      expect(response.statusCode).toBe(200);
      return response.json() as LeaderboardResponse;
    };

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [DatabaseModule, IdentityModule, ReputationModule],
      })
        .overrideProvider(MAILER)
        .useValue(new CaptureMailer())
        .overrideProvider(IDENTITY_OPTIONS)
        .useValue(options)
        .compile();

      app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      pool = new Pool({ connectionString: DATABASE_URL });

      for (const username of [ada, bo, cass, outsider]) await register(username);

      // Ada and Bo are ranked; Cass is one settlement short of the floor and so
      // is nobody's rank. The outsider rates higher than any of them and is in
      // no group, which is what makes "scoped" visible.
      await rate(ada, 88, FLOOR + 5);
      await rate(bo, 74, FLOOR);
      await rate(cass, 99, FLOOR - 1);
      await rate(outsider, 97, FLOOR + 20);
    });

    afterAll(async () => {
      const everyone = [...ids.values()];
      const client = await pool.connect();
      try {
        await client.query(`SET session_replication_role = 'replica'`);
        await client.query(
          `DELETE FROM group_member WHERE user_id = ANY($1::uuid[])
              OR group_id IN (SELECT id FROM user_group WHERE created_by = ANY($1::uuid[]))`,
          [everyone],
        );
        await client.query(`DELETE FROM user_group WHERE created_by = ANY($1::uuid[])`, [everyone]);
        await client.query(`DELETE FROM rating_snapshot WHERE user_id = ANY($1::uuid[])`, [
          everyone,
        ]);
        await client.query(`DELETE FROM rate_window WHERE user_id = ANY($1::uuid[])`, [everyone]);
      } finally {
        await client.query(`SET session_replication_role = 'origin'`);
        client.release();
      }
      await pool.query(`DELETE FROM user_account WHERE username LIKE $1`, [`gl_${RUN}%`]);
      await pool.end();
      await app.close();
    });

    it('reports the same rules as the global board, not a second set', async () => {
      const slug = await group(ada, 'public');
      const [scoped, global] = await Promise.all([
        board(`/groups/${slug}/leaderboard`, ada),
        board('/leaderboard', ada),
      ]);

      // If these ever diverge, a second leaderboard has been born somewhere.
      expect(scoped.rules_version).toBe(global.rules_version);
      expect(scoped.floor).toBe(global.floor);
      expect(scoped.presets).toEqual(global.presets);
      expect(scoped.min_settled).toBe(global.min_settled);
    });

    it('ranks inside the group and leaves everybody else out', async () => {
      const slug = await group(ada, 'public');
      expect((await post(`/groups/${slug}/members`, {}, bo)).statusCode).toBe(204);
      expect((await post(`/groups/${slug}/members`, {}, cass)).statusCode).toBe(204);

      const scoped = await board(`/groups/${slug}/leaderboard`, ada);
      const names = scoped.entries.map((entry) => entry.username);

      // The outsider rates higher than anybody here, and is not here.
      expect(names).not.toContain(outsider);
      // Cass is a member and is not ranked: one settlement under the floor.
      expect(names).not.toContain(cass);
      expect(names).toEqual([ada, bo]);
      expect(scoped.total).toBe(2);
      // Rank is the position in this population, starting at one — a board
      // showing rank 4,891 of 12,300 would not be a board.
      expect(scoped.entries.map((entry) => entry.rank)).toEqual([1, 2]);
    });

    it('is the same rating, only a different population', async () => {
      const slug = await group(ada, 'public');
      const [scoped, global] = await Promise.all([
        board(`/groups/${slug}/leaderboard`, ada),
        board('/leaderboard?limit=100', ada),
      ]);
      const here = scoped.entries.find((entry) => entry.username === ada);
      const there = global.entries.find((entry) => entry.username === ada);

      expect(here?.rating).toBe(88);
      expect(there).toBeDefined();
      expect(here?.rating).toBe(there?.rating);
      expect(here?.tier).toBe(there?.tier);
      expect(here?.settled_count).toBe(there?.settled_count);
      expect(here?.formula_version).toBe(there?.formula_version);
    });

    it('says the board is empty rather than lowering the floor for a small group', async () => {
      // The whole temptation of this task in one case: a group whose only
      // member is ranked nowhere. The floor is D-037's and does not bend.
      const slug = await group(cass, 'public');
      const scoped = await board(`/groups/${slug}/leaderboard`, cass);

      expect(scoped.entries).toEqual([]);
      expect(scoped.total).toBe(0);
      // And it still says which filter produced that, so nobody reads the
      // emptiness as "this group has no members".
      expect(scoped.min_settled).toBe(FLOOR);
      expect(scoped.rules_version).toBe(LEADERBOARD_RULES_V1.version);
    });

    it('refuses a discoverable group to somebody outside it, in the membership sentence', async () => {
      const slug = await group(ada, 'discoverable');
      const response = await get(`/groups/${slug}/leaderboard`, outsider);

      expect(response.statusCode).toBe(403);
      // Not "that is for the people who run this group": this is for the people
      // who are in it, which is a different refusal.
      expect(response.json().message).toMatch(/shown to its members/);
    });

    it('does not admit an invite-only group exists', async () => {
      const slug = await group(ada, 'invite_only');
      const response = await get(`/groups/${slug}/leaderboard`, outsider);
      expect(response.statusCode).toBe(404);
    });

    it('refuses a filter under the floor the way the global board does', async () => {
      const slug = await group(ada, 'public');
      const [scoped, global] = await Promise.all([
        get(`/groups/${slug}/leaderboard?min_settled=0`, ada),
        get('/leaderboard?min_settled=0', ada),
      ]);

      expect(scoped.statusCode).toBe(400);
      expect(global.statusCode).toBe(400);
      expect(scoped.json().fields).toEqual(global.json().fields);
    });
  },
);
