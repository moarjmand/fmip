import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { deleteRatedAccounts, withTriggersOff } from '../../testing/cleanup';
import { MODEL_CLIENT, ModelClient } from '../forecast/forecast.service';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../identity/identity.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ReputationModule } from './reputation.module';
import { ReputationService } from './reputation.service';

/**
 * An achievement unlock is a notification (T-946, D-117), through the real
 * reputation job, notifications and schema.
 *
 * A member whose first prediction settles is told once, deep-linked to their
 * profile. A recompute that finds nothing new tells nothing; an achievement a
 * correction removes and a later settlement restores is not told twice; one
 * earned long before it was first derived is recorded silently; a member who
 * switched the kind off is not told; a deleted member is never told. The
 * achievements themselves stay derived (D-091): the profile's list is read
 * exactly as before.
 */
const DATABASE_URL = process.env.DATABASE_URL;
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

const ENGLAND = '00000000-0000-4000-8000-000000000101';
const SEASON_2025 = '00000000-0000-4000-8000-000000000302';
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const PASSWORD = 'correct horse battery staple';

// Three letters: a username is at most fifteen characters.
type Name = 'ana' | 'old' | 'qui' | 'gon';
const NAMES: Name[] = ['ana', 'old', 'qui', 'gon'];

function cookieValue(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return /^fmip_session=([^;]*)/.exec(header ?? '')?.[1] ?? '';
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  'achievement notifications',
  () => {
    let app: NestFastifyApplication;
    let pool: Pool;
    let reputation: ReputationService;
    let notifications: NotificationsService;
    const users = {} as Record<Name, { id: string; username: string; cookie: string }>;
    const fixtures: string[] = [];

    /** One settled prediction for `who`, settled `hoursAgo`; returns its settlement id. */
    async function settle(who: Name, hoursAgo: number): Promise<string> {
      const fixtureId = randomUUID();
      fixtures.push(fixtureId);
      await pool.query(
        `INSERT INTO fixture (id, season_id, kickoff_at, status)
         VALUES ($1, $2, now() + interval '1 day', 'scheduled')`,
        [fixtureId, SEASON_2025],
      );
      const prediction = await pool.query<{ id: string }>(
        `INSERT INTO user_prediction (user_id, fixture_id) VALUES ($1, $2) RETURNING id`,
        [users[who].id, fixtureId],
      );
      const version = await pool.query<{ id: string }>(
        `INSERT INTO prediction_version
           (prediction_id, version_number, outcome, home_goals, away_goals, confidence)
         VALUES ($1, 1, 'home', 2, 1, 3) RETURNING id`,
        [prediction.rows[0]!.id],
      );
      const run = await pool.query<{ id: string }>(
        `INSERT INTO settlement_run (fixture_id, settled) VALUES ($1, 1) RETURNING id`,
        [fixtureId],
      );
      const settlement = await pool.query<{ id: string }>(
        `INSERT INTO settlement
           (run_id, prediction_id, version_id, fixture_id, settled_at, status, actual_home,
            actual_away, outcome_correct, score_predicted, score_correct, confidence)
         VALUES ($1, $2, $3, $4, now() - $5::interval, 'settled', 2, 0, true, true, false, 3)
         RETURNING id`,
        [
          run.rows[0]!.id,
          prediction.rows[0]!.id,
          version.rows[0]!.id,
          fixtureId,
          `${String(hoursAgo)} hours`,
        ],
      );
      return settlement.rows[0]!.id;
    }

    /** The member's achievement notifications, as their inbox holds them. */
    async function told(who: Name): Promise<{ kind: string; path: string | null }[]> {
      const { rows } = await pool.query<{ kind: string; dedupe_key: string }>(
        `SELECT kind, dedupe_key FROM notification
          WHERE user_id = $1 AND kind = 'achievement_unlocked' ORDER BY created_at`,
        [users[who].id],
      );
      return rows.map((r) => ({ kind: r.kind, path: r.dedupe_key }));
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
        .useValue(new ModelClient({ baseUrl: 'http://model.test' }))
        .compile();
      app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      pool = new Pool({ connectionString: DATABASE_URL });
      reputation = app.get(ReputationService);
      notifications = app.get(NotificationsService, { strict: false });

      for (const name of NAMES) {
        const username = `an_${RUN}${name}`;
        const registered = await app.inject({
          method: 'POST',
          url: '/auth/register',
          payload: {
            username,
            display_name: 'Achiever',
            email: `${username}@example.test`,
            password: PASSWORD,
            country_id: ENGLAND,
            preferred_language: 'en',
            timezone: 'Europe/London',
            accept_rules: true,
          },
        });
        expect(registered.statusCode, registered.body).toBe(201);
        users[name] = {
          id: (registered.json() as { user: { id: string } }).user.id,
          username,
          cookie: cookieValue(registered.headers['set-cookie']),
        };
      }
    });

    afterAll(async () => {
      const ids = NAMES.map((n) => users[n]?.id).filter((id): id is string => id !== undefined);
      await withTriggersOff(pool, async (client) => {
        await client.query(`DELETE FROM settlement WHERE fixture_id = ANY($1::uuid[])`, [fixtures]);
        await client.query(`DELETE FROM settlement_run WHERE fixture_id = ANY($1::uuid[])`, [
          fixtures,
        ]);
        await client.query(
          `DELETE FROM prediction_version WHERE prediction_id IN
             (SELECT id FROM user_prediction WHERE fixture_id = ANY($1::uuid[]))`,
          [fixtures],
        );
        await client.query(`DELETE FROM user_prediction WHERE fixture_id = ANY($1::uuid[])`, [
          fixtures,
        ]);
        // The deletion's own audit row names the account it deleted.
        await client.query(`DELETE FROM audit_log WHERE actor_id = ANY($1::uuid[])`, [ids]);
      });
      await pool.query(`DELETE FROM fixture WHERE id = ANY($1::uuid[])`, [fixtures]);
      await deleteRatedAccounts(pool, ids);
      await pool.end();
      await app.close();
    });

    it('tells a member once when their first prediction settles, opening their profile', async () => {
      await settle('ana', 1);
      await reputation.recompute(users.ana.id);
      expect(await told('ana')).toEqual([
        {
          kind: 'achievement_unlocked',
          path: `achievement_unlocked:${users.ana.id}:first_settled`,
        },
      ]);
      const inbox = await notifications.inbox(users.ana.id, 10);
      const unlock = inbox.find((n) => n.kind === 'achievement_unlocked');
      expect(unlock).toMatchObject({
        subject_type: 'member',
        subject_id: users.ana.id,
        subject_label: users.ana.username,
        source: null,
      });
      // A second recompute with nothing new tells nothing.
      await reputation.recompute(users.ana.id);
      expect(await told('ana')).toHaveLength(1);
    });

    it('an achievement a recomputation removes and restores is not told twice', async () => {
      const first = await pool.query<{ id: string }>(
        `SELECT s.id FROM settlement s JOIN user_prediction p ON p.id = s.prediction_id
          WHERE p.user_id = $1`,
        [users.ana.id],
      );
      // A correction takes the only settlement away: no achievement is derived.
      await withTriggersOff(pool, async (client) => {
        await client.query(`DELETE FROM settlement WHERE id = $1`, [first.rows[0]!.id]);
      });
      await reputation.recompute(users.ana.id);
      expect((await reputation.achievements(users.ana.id)).earned).toEqual([]);
      // A later settlement gives it back.
      await settle('ana', 0);
      await reputation.recompute(users.ana.id);
      expect((await reputation.achievements(users.ana.id)).earned.map((a) => a.kind)).toEqual([
        'first_settled',
      ]);
      expect(await told('ana')).toHaveLength(1);
    });

    it('records one earned long before it was first derived without telling', async () => {
      await settle('old', 24 * 30);
      await reputation.recompute(users.old.id);
      expect(await told('old')).toEqual([]);
      const { rows } = await pool.query<{ kind: string; told: boolean }>(
        `SELECT kind, told FROM achievement_unlocked WHERE user_id = $1`,
        [users.old.id],
      );
      expect(rows).toEqual([{ kind: 'first_settled', told: false }]);
    });

    it('is off for a member who switched it off, and the achievement is still theirs', async () => {
      await notifications.setPreference(users.qui.id, 'achievement_unlocked', false);
      await settle('qui', 1);
      await reputation.recompute(users.qui.id);
      expect(await told('qui')).toEqual([]);
      expect((await reputation.achievements(users.qui.id)).earned).toHaveLength(1);
    });

    it('never tells a deleted member', async () => {
      await settle('gon', 1);
      const deleted = await app.inject({
        method: 'POST',
        url: '/auth/account/delete',
        headers: { cookie: `fmip_session=${users.gon.cookie}` },
        payload: { password: PASSWORD, confirm: users.gon.username },
      });
      expect(deleted.statusCode).toBe(204);
      await reputation.recompute(users.gon.id);
      expect(await told('gon')).toEqual([]);
      const { rows } = await pool.query(`SELECT 1 FROM achievement_unlocked WHERE user_id = $1`, [
        users.gon.id,
      ]);
      expect(rows).toHaveLength(0);
    });
  },
);
