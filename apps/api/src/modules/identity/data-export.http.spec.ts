import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { ApiError, DataExport } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { deleteRatedAccounts, withTriggersOff } from '../../testing/cleanup';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from './identity.service';
import { IdentityModule } from './identity.module';
import { DATA_EXPORT_ACTION } from './internal/data-export-store';

// T-846, D-158: a member's copy of their own data, against the real schema.
// The acceptance test is a two-person conversation: the member's file holds
// what the member wrote and nothing the other member wrote, nor their name,
// nor their prediction.
const DATABASE_URL = process.env.DATABASE_URL;
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

const ENGLAND = '00000000-0000-4000-8000-000000000101';
const PL_2025 = '00000000-0000-4000-8000-000000000302';
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const PASSWORD = 'correct horse battery staple';

function cookieValue(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const match = /^fmip_session=([^;]*)/.exec(header ?? '');
  return match?.[1] ?? '';
}

type Name = 'me' | 'friend';

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('A copy of my data', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  const members = {} as Record<Name, { id: string; username: string; cookie: string }>;
  const teams = [randomUUID(), randomUUID()];
  const fixtureId = randomUUID();
  const groupId = randomUUID();
  let direct: string = randomUUID();

  // Words only one side wrote, so a leak is a substring away.
  const MINE = `mine-${RUN}: see you Saturday`;
  const THEIRS = `theirs-${RUN}: bring the scarf`;
  const THEIR_REASONING = `their-explanation-${RUN}`;
  const MY_REASONING = `my-explanation-${RUN}`;

  const exportAs = (cookie: string | undefined, payload: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url: '/auth/account/export',
      payload,
      headers: cookie === undefined ? {} : { cookie: `fmip_session=${cookie}` },
    });

  async function register(name: Name): Promise<void> {
    const username = `dx_${RUN}${name.slice(0, 3)}`;
    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        username,
        display_name: `Export ${name} ${RUN}`,
        email: `${username}@example.test`,
        password: PASSWORD,
        country_id: ENGLAND,
        preferred_language: 'en',
        timezone: 'Europe/London',
        accept_rules: true,
      },
    });
    expect(response.statusCode).toBe(201);
    const id = (response.json() as { user: { id: string } }).user.id;
    members[name] = { id, username, cookie: cookieValue(response.headers['set-cookie']) };
  }

  async function predicted(name: Name, explanation: string): Promise<void> {
    await withTriggersOff(pool, async (client) => {
      const prediction = await client.query<{ id: string }>(
        `INSERT INTO user_prediction (user_id, fixture_id) VALUES ($1, $2) RETURNING id`,
        [members[name].id, fixtureId],
      );
      const id = prediction.rows[0]!.id;
      await client.query(
        `INSERT INTO prediction_version
           (prediction_id, version_number, outcome, confidence, explanation, submitted_at)
         VALUES ($1, 1, 'home', 3, NULL, now() - interval '4 days'),
                ($1, 2, 'away', 4, $2, now() - interval '3 days')`,
        [id, explanation],
      );
      const version = await client.query<{ id: string }>(
        `SELECT id FROM prediction_version WHERE prediction_id = $1 AND version_number = 2`,
        [id],
      );
      const run = await client.query<{ id: string }>(
        `INSERT INTO settlement_run (fixture_id, settled) VALUES ($1, 1) RETURNING id`,
        [fixtureId],
      );
      await client.query(
        `INSERT INTO settlement
           (run_id, prediction_id, version_id, fixture_id, status, actual_home, actual_away,
            outcome_correct, score_predicted, score_correct, confidence)
         VALUES ($1, $2, $3, $4, 'settled', 0, 1, true, false, NULL, 4)`,
        [run.rows[0]!.id, id, version.rows[0]!.id, fixtureId],
      );
    });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [DatabaseModule, IdentityModule] })
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

    await register('me');
    await register('friend');
    const id = (name: Name) => members[name].id;

    for (const [index, team] of teams.entries()) {
      await pool.query(
        `INSERT INTO team (id, country_id, name, short_name, kind, gender)
         VALUES ($1, $2, $3, $4, 'club', 'men')`,
        [team, ENGLAND, `Export ${index}${RUN}`, `DX${index}`],
      );
    }
    await pool.query(
      `INSERT INTO fixture (id, season_id, round, kickoff_at, status)
       VALUES ($1, $2, 'Export round', now() - interval '2 days', 'finished')`,
      [fixtureId, PL_2025],
    );
    await pool.query(
      `INSERT INTO fixture_participant (fixture_id, team_id, side)
       VALUES ($1, $2, 'home'), ($1, $3, 'away')`,
      [fixtureId, teams[0], teams[1]],
    );

    // Both predicted the same match; only mine may be in my file.
    await predicted('me', MY_REASONING);
    await predicted('friend', THEIR_REASONING);

    await pool.query(`INSERT INTO profile (user_id, bio) VALUES ($1, 'My own bio')`, [id('me')]);
    await pool.query(
      `INSERT INTO followed_entity (user_id, entity_type, entity_id) VALUES ($1, 'team', $2)`,
      [id('me'), teams[0]],
    );
    await pool.query(
      `INSERT INTO friendship (low_id, high_id) VALUES (LEAST($1::uuid, $2::uuid), GREATEST($1::uuid, $2::uuid))`,
      [id('me'), id('friend')],
    );
    // A group and its owner in one transaction: a group must have an owner (D-057).
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO user_group (id, slug, name, visibility, created_by)
         VALUES ($1, $2, 'Saturday club', 'public', $3)`,
        [groupId, `dx-${RUN}`, id('friend')],
      );
      await client.query(
        `INSERT INTO group_member (group_id, user_id, role)
         VALUES ($1, $2, 'owner'), ($1, $3, 'member')`,
        [groupId, id('friend'), id('me')],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    // The two-person conversation: one message each.
    const pair = await pool.query<{ id: string }>(
      `INSERT INTO conversation (kind, pair_low, pair_high)
       VALUES ('direct', LEAST($1::uuid, $2::uuid), GREATEST($1::uuid, $2::uuid)) RETURNING id`,
      [id('me'), id('friend')],
    );
    direct = pair.rows[0]!.id;
    await pool.query(
      `INSERT INTO conversation_participant (conversation_id, user_id) VALUES ($1, $2), ($1, $3)`,
      [direct, id('me'), id('friend')],
    );
    await pool.query(`INSERT INTO message (conversation_id, author_id, body) VALUES ($1, $2, $3)`, [
      direct,
      id('me'),
      MINE,
    ]);
    await pool.query(`INSERT INTO message (conversation_id, author_id, body) VALUES ($1, $2, $3)`, [
      direct,
      id('friend'),
      THEIRS,
    ]);

    // A notification the friend caused, and a report I filed about them.
    await pool.query(
      `INSERT INTO notification (user_id, kind, subject_type, subject_id, source_id)
       VALUES ($1, 'message_received', 'conversation', $2, $3)`,
      [id('me'), direct, id('friend')],
    );
    await pool.query(
      `INSERT INTO report (reporter_id, subject_type, subject_id, reason) VALUES ($1, 'member', $2, 'spam')`,
      [id('me'), id('friend')],
    );
  });

  afterAll(async () => {
    const ids = Object.values(members).map((m) => m.id);
    await withTriggersOff(pool, async (c) => {
      await c.query(`DELETE FROM report WHERE reporter_id = ANY($1::uuid[])`, [ids]);
      await c.query(`DELETE FROM notification WHERE user_id = ANY($1::uuid[])`, [ids]);
      await c.query(`DELETE FROM audit_log WHERE actor_id = ANY($1::uuid[])`, [ids]);
      await c.query(`DELETE FROM message WHERE conversation_id = $1`, [direct]);
      await c.query(`DELETE FROM conversation_participant WHERE conversation_id = $1`, [direct]);
      await c.query(`DELETE FROM conversation WHERE id = $1`, [direct]);
      await c.query(`DELETE FROM group_member WHERE group_id = $1`, [groupId]);
      await c.query(`DELETE FROM user_group WHERE id = $1`, [groupId]);
      await c.query(`DELETE FROM settlement WHERE fixture_id = $1`, [fixtureId]);
      await c.query(`DELETE FROM settlement_run WHERE fixture_id = $1`, [fixtureId]);
      await c.query(
        `DELETE FROM prediction_version WHERE prediction_id IN
           (SELECT id FROM user_prediction WHERE fixture_id = $1)`,
        [fixtureId],
      );
      await c.query(`DELETE FROM user_prediction WHERE fixture_id = $1`, [fixtureId]);
    });
    await deleteRatedAccounts(pool, ids);
    await pool.query(`DELETE FROM fixture_participant WHERE fixture_id = $1`, [fixtureId]);
    await pool.query(`DELETE FROM fixture WHERE id = $1`, [fixtureId]);
    await pool.query(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [teams]);
    await pool.end();
    await app.close();
  });

  describe('is refused', () => {
    it('to a guest', async () => {
      expect((await exportAs(undefined, { password: PASSWORD })).statusCode).toBe(401);
    });

    it('without the password, or with a wrong one, and makes no copy', async () => {
      expect((await exportAs(members.me.cookie, {})).statusCode).toBe(400);
      const wrong = await exportAs(members.me.cookie, { password: 'not the password' });
      expect(wrong.statusCode).toBe(400);
      expect((wrong.json() as ApiError).fields).toEqual({ password: 'is not right' });
      const { rows } = await pool.query(
        `SELECT 1 FROM audit_log WHERE action = $1 AND target_id = $2`,
        [DATA_EXPORT_ACTION, members.me.id],
      );
      expect(rows).toHaveLength(0);
    });

    it("to another member's session holding my password", async () => {
      // The session decides whose file it is; my password is not theirs.
      const response = await exportAs(members.friend.cookie, { password: 'wrong for friend' });
      expect(response.statusCode).toBe(400);
    });
  });

  describe('once allowed', () => {
    let file: DataExport;
    let raw = '';

    beforeAll(async () => {
      const response = await exportAs(members.me.cookie, { password: PASSWORD });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['content-disposition']).toMatch(
        new RegExp(
          `^attachment; filename="fmip-data-${members.me.username}-\\d{4}-\\d{2}-\\d{2}\\.json"$`,
        ),
      );
      raw = response.body;
      file = response.json() as DataExport;
    });

    it('is my account and my rows', () => {
      expect(file.format).toBe('fmip-data-export@1');
      expect(file.account.id).toBe(members.me.id);
      expect(file.account.username).toBe(members.me.username);
      expect(file.account.email).toBe(`${members.me.username}@example.test`);
      expect(file.profile).toEqual({ bio: 'My own bio', avatar_url: null });
      expect(file.follows.entities).toEqual([
        expect.objectContaining({ entity_type: 'team', entity_id: teams[0] }),
      ]);
      expect(file.friendships).toEqual([
        { member_id: members.friend.id, created_at: expect.any(String) },
      ]);
      expect(file.groups).toEqual([
        expect.objectContaining({ group_id: groupId, name: 'Saturday club', role: 'member' }),
      ]);
      expect(file.reports_filed).toEqual([
        expect.objectContaining({
          subject_type: 'member',
          subject_id: members.friend.id,
          reason: 'spam',
          decided: false,
        }),
      ]);
      expect(file.notifications).toEqual([
        expect.objectContaining({ kind: 'message_received', subject_id: direct }),
      ]);
    });

    it('holds my prediction with every version and its settlement', () => {
      expect(file.predictions).toHaveLength(1);
      const [prediction] = file.predictions;
      expect(prediction!.fixture_id).toBe(fixtureId);
      expect(prediction!.versions.map((v) => [v.version_number, v.outcome])).toEqual([
        [1, 'home'],
        [2, 'away'],
      ]);
      expect(prediction!.versions[1]!.explanation).toBe(MY_REASONING);
      expect(prediction!.settlements).toEqual([
        expect.objectContaining({
          version_number: 2,
          status: 'settled',
          actual_home: 0,
          actual_away: 1,
          outcome_correct: true,
        }),
      ]);
    });

    it('holds my side of the conversation and nothing of the other member', () => {
      expect(file.messages).toEqual([
        expect.objectContaining({
          conversation_id: direct,
          conversation_kind: 'direct',
          body: MINE,
        }),
      ]);
      // Not their words, not their name, not their prediction, anywhere in the file.
      expect(raw).not.toContain(THEIRS);
      expect(raw).not.toContain(members.friend.username);
      expect(raw).not.toContain(`Export friend ${RUN}`);
      expect(raw).not.toContain(THEIR_REASONING);
      expect(raw).not.toContain(`${members.friend.username}@example.test`);
    });

    it('is recorded in the audit trail without its content', async () => {
      const { rows } = await pool.query<{
        actor_id: string;
        reason: string;
        previous: unknown;
        next: unknown;
      }>(
        `SELECT actor_id, reason, previous, next FROM audit_log
          WHERE action = $1 AND target_type = 'user_account' AND target_id = $2`,
        [DATA_EXPORT_ACTION, members.me.id],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.actor_id).toBe(members.me.id);
      expect(rows[0]!.reason).toBe('self-service data export');
      expect(rows[0]!.previous).toBeNull();
      const next = JSON.stringify(rows[0]!.next);
      expect(next).toContain('"messages":1');
      expect(next).not.toContain(MINE);
      expect(next).not.toContain(MY_REASONING);
    });

    it('is one file per day: a second is 429 with Retry-After, and makes no second audit row', async () => {
      const again = await exportAs(members.me.cookie, { password: PASSWORD });
      expect(again.statusCode).toBe(429);
      const retryAfter = Number(again.headers['retry-after']);
      expect(retryAfter).toBeGreaterThan(23 * 3600);
      expect(retryAfter).toBeLessThanOrEqual(24 * 3600);
      expect(again.json() as ApiError).toMatchObject({
        error: 'rate_limited',
        fields: { export: 'one copy per day' },
      });
      const { rows } = await pool.query(
        `SELECT 1 FROM audit_log WHERE action = $1 AND target_id = $2`,
        [DATA_EXPORT_ACTION, members.me.id],
      );
      expect(rows).toHaveLength(1);
    });

    it('two requests at once make one file', async () => {
      const [a, b] = await Promise.all([
        exportAs(members.friend.cookie, { password: PASSWORD }),
        exportAs(members.friend.cookie, { password: PASSWORD }),
      ]);
      expect([a.statusCode, b.statusCode].sort()).toEqual([200, 429]);
      const { rows } = await pool.query(
        `SELECT 1 FROM audit_log WHERE action = $1 AND target_id = $2`,
        [DATA_EXPORT_ACTION, members.friend.id],
      );
      expect(rows).toHaveLength(1);
    });
  });
});
