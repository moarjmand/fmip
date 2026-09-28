import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { withTriggersOff } from '../../testing/cleanup';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../identity/identity.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PredictionsModule } from './predictions.module';

/**
 * "A friend predicted a match you follow" through `PUT /fixtures/:id/prediction`
 * (T-832, D-100), against the real schema. Who hears it: a friend who
 * switched it on and follows either team or predicted the match -- only when
 * the predictor's own history visibility lets that friend read it (D-063),
 * once per friend per match however often the prediction is revised, and
 * never with the pick in it.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const ENGLAND = '00000000-0000-4000-8000-000000000101';

const COMPETITION = randomUUID();
const SEASON = randomUUID();
const HOME = randomUUID();
const AWAY = randomUUID();
const FIXTURE = randomUUID();

function cookieValue(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return /^fmip_session=([^;]*)/.exec(header ?? '')?.[1] ?? '';
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  "friends' prediction alerts",
  { timeout: 40_000 },
  () => {
    let app: NestFastifyApplication;
    let pool: Pool;
    let notifications: NotificationsService;
    const cookies = new Map<string, string>();
    const ids = new Map<string, string>();
    const name = (label: string): string => `fp${label}${RUN}`;

    const predict = (label: string, outcome: 'home' | 'away' = 'home') =>
      app.inject({
        method: 'PUT',
        url: `/fixtures/${FIXTURE}/prediction`,
        payload: {
          outcome,
          score: outcome === 'home' ? { home: 2, away: 1 } : { home: 0, away: 1 },
          confidence: 3,
          reason_tags: ['form'],
        },
        headers: { cookie: `fmip_session=${cookies.get(label) ?? ''}` },
      });

    async function register(label: string): Promise<string> {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          username: name(label),
          display_name: `Friend ${label}`,
          email: `${name(label)}@example.test`,
          password: 'a perfectly fine passphrase',
          country_id: ENGLAND,
          preferred_language: 'en',
          timezone: 'Europe/London',
          accept_rules: true,
        },
      });
      expect(response.statusCode).toBe(201);
      cookies.set(label, cookieValue(response.headers['set-cookie']));
      const { rows } = await pool.query<{ id: string }>(
        `UPDATE user_account SET email_verified_at = now() WHERE username = $1 RETURNING id`,
        [name(label)],
      );
      const id = rows[0]?.id ?? '';
      ids.set(label, id);
      return id;
    }
    const befriend = (a: string, b: string) =>
      pool.query(
        `INSERT INTO friendship (low_id, high_id) VALUES (LEAST($1::uuid, $2::uuid), GREATEST($1::uuid, $2::uuid))`,
        [ids.get(a), ids.get(b)],
      );
    const followHome = (label: string) =>
      pool.query(
        `INSERT INTO followed_entity (user_id, entity_type, entity_id) VALUES ($1, 'team', $2)`,
        [ids.get(label), HOME],
      );
    const visibility = (label: string, value: 'public' | 'friends' | 'private') =>
      pool.query(
        `INSERT INTO privacy_setting (user_id, prediction_history_visibility) VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET prediction_history_visibility = EXCLUDED.prediction_history_visibility`,
        [ids.get(label), value],
      );
    /** Who told this member what, about the match. */
    async function heard(label: string): Promise<string[]> {
      const rows = await notifications.inbox(ids.get(label) ?? '', 50);
      return rows
        .filter((row) => row.kind === 'friend_predicted' && row.subject_id === FIXTURE)
        .map((row) => row.source ?? '');
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [DatabaseModule, PredictionsModule],
      })
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
      notifications = app.get(NotificationsService);

      await pool.query(
        `INSERT INTO competition (id, country_id, name, kind, scope, gender, age_group, tier)
         VALUES ($1, $2, $3, 'league', 'domestic', 'men', 'senior', 9)`,
        [COMPETITION, ENGLAND, `Friend League ${RUN}`],
      );
      await pool.query(
        `INSERT INTO season (id, competition_id, label, start_date, end_date, is_current)
         VALUES ($1, $2, '2026/27', DATE '2026-08-01', DATE '2027-05-31', true)`,
        [SEASON, COMPETITION],
      );
      await pool.query(
        `INSERT INTO team (id, name, kind, gender) VALUES ($1, 'Friend Home', 'club', 'men'),
                                                         ($2, 'Friend Away', 'club', 'men')`,
        [HOME, AWAY],
      );
      await pool.query(
        `INSERT INTO fixture (id, season_id, kickoff_at, status)
         VALUES ($1, $2, now() + interval '3 days', 'scheduled')`,
        [FIXTURE, SEASON],
      );
      await pool.query(
        `INSERT INTO fixture_participant (fixture_id, team_id, side)
         VALUES ($1, $2, 'home'), ($1, $3, 'away')`,
        [FIXTURE, HOME, AWAY],
      );

      // p predicts. a follows, b predicted, c neither, e follows with the
      // default (off), s is no friend but follows.
      for (const label of ['p', 'a', 'b', 'c', 'e', 's', 'q', 'r']) await register(label);
      for (const label of ['a', 'b', 'c', 'e']) await befriend('p', label);
      for (const label of ['a', 'e', 's']) await followHome(label);
      for (const label of ['a', 'b', 'c', 's']) {
        await notifications.setPreference(ids.get(label) ?? '', 'friend_predicted', true);
      }
      expect((await predict('b', 'away')).statusCode).toBe(200);
    });

    afterAll(async () => {
      const everyone = [...ids.values()];
      await withTriggersOff(pool, async (client) => {
        await client.query(
          `DELETE FROM prediction_version WHERE prediction_id IN
             (SELECT id FROM user_prediction WHERE user_id = ANY($1::uuid[]))`,
          [everyone],
        );
      });
      await pool.query(`DELETE FROM user_account WHERE id = ANY($1::uuid[])`, [everyone]);
      await pool.query(`DELETE FROM fixture WHERE id = $1`, [FIXTURE]);
      await pool.query(`DELETE FROM team WHERE id IN ($1, $2)`, [HOME, AWAY]);
      await pool.query(`DELETE FROM season WHERE id = $1`, [SEASON]);
      await pool.query(`DELETE FROM competition WHERE id = $1`, [COMPETITION]);
      await pool.end();
      await app.close();
    });

    it('tells the friends who follow or predicted the match and asked for it', async () => {
      expect((await predict('p')).statusCode).toBe(200);
      expect(await heard('a')).toEqual([name('p')]);
      expect(await heard('b')).toEqual([name('p')]);
      // Neither follows nor predicted; the default is off; not a friend.
      for (const label of ['c', 'e', 's']) expect(await heard(label)).toEqual([]);
    });

    it('says that they predicted, never what', async () => {
      const rows = await notifications.inbox(ids.get('a') ?? '', 50);
      const row = rows.find((r) => r.kind === 'friend_predicted');
      expect(row).toMatchObject({ subject_type: 'fixture', subject_id: FIXTURE, headline: null });
    });

    it('a revision is the same news, and reaches nobody twice', async () => {
      expect((await predict('p', 'away')).statusCode).toBe(200);
      expect(await heard('a')).toEqual([name('p')]);
      expect(await heard('b')).toEqual([name('p')]);
    });

    it('a private history is announced to nobody; friends-only reaches friends', async () => {
      await befriend('q', 'a');
      await visibility('q', 'private');
      expect((await predict('q')).statusCode).toBe(200);
      expect(await heard('a')).toEqual([name('p')]);

      await befriend('r', 'a');
      await visibility('r', 'friends');
      expect((await predict('r')).statusCode).toBe(200);
      expect((await heard('a')).sort()).toEqual([name('p'), name('r')].sort());
    });
  },
);
