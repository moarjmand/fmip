import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FriendPredictionsResponse } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { withTriggersOff } from '../../testing/cleanup';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../identity/identity.service';
import { PredictionsModule } from './predictions.module';

/**
 * Friends' recent predictions on the member's homepage through
 * `GET /me/friends/predictions` (T-942, D-115), against the real schema.
 * A friend's call is shown only when their own history visibility lets this
 * viewer read it (D-063) -- one test per setting -- and never a stranger's,
 * the viewer's own, or one outside the window.
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
  "friends' recent predictions",
  { timeout: 40_000 },
  () => {
    let app: NestFastifyApplication;
    let pool: Pool;
    const cookies = new Map<string, string>();
    const ids = new Map<string, string>();
    const name = (label: string): string => `fr${label}${RUN}`;

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
    const visibility = (label: string, value: 'public' | 'friends' | 'private') =>
      pool.query(
        `INSERT INTO privacy_setting (user_id, prediction_history_visibility) VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET prediction_history_visibility = EXCLUDED.prediction_history_visibility`,
        [ids.get(label), value],
      );
    const recent = (label?: string) =>
      app.inject({
        method: 'GET',
        url: '/me/friends/predictions',
        headers: label === undefined ? {} : { cookie: `fmip_session=${cookies.get(label) ?? ''}` },
      });
    const shown = async (label: string): Promise<string[]> => {
      const response = await recent(label);
      expect(response.statusCode).toBe(200);
      return (response.json() as FriendPredictionsResponse).predictions.map((p) => p.username);
    };

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

      await pool.query(
        `INSERT INTO competition (id, country_id, name, kind, scope, gender, age_group, tier)
         VALUES ($1, $2, $3, 'league', 'domestic', 'men', 'senior', 9)`,
        [COMPETITION, ENGLAND, `Home Friend League ${RUN}`],
      );
      await pool.query(
        `INSERT INTO season (id, competition_id, label, start_date, end_date, is_current)
         VALUES ($1, $2, '2026/27', DATE '2026-08-01', DATE '2027-05-31', true)`,
        [SEASON, COMPETITION],
      );
      await pool.query(
        `INSERT INTO team (id, name, kind, gender) VALUES ($1, 'Home Friend Home', 'club', 'men'),
                                                         ($2, 'Home Friend Away', 'club', 'men')`,
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

      // v reads. pub, fri and pri are friends with each setting; old is a
      // public friend whose call is outside the window; x is public and no
      // friend.
      for (const label of ['v', 'pub', 'fri', 'pri', 'old', 'x']) await register(label);
      for (const label of ['pub', 'fri', 'pri', 'old']) await befriend('v', label);
      for (const label of ['pub', 'old', 'x', 'v']) await visibility(label, 'public');
      await visibility('fri', 'friends');
      await visibility('pri', 'private');
      for (const label of ['v', 'pub', 'fri', 'pri', 'old', 'x']) {
        expect((await predict(label)).statusCode).toBe(200);
      }
      await withTriggersOff(pool, async (client) => {
        await client.query(
          `UPDATE prediction_version SET submitted_at = now() - interval '10 days'
            WHERE prediction_id IN (SELECT id FROM user_prediction WHERE user_id = $1)`,
          [ids.get('old')],
        );
      });
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

    it('asks who is reading first', async () => {
      expect((await recent()).statusCode).toBe(401);
    });

    it('shows a friend whose history is public, with the pick and the match', async () => {
      const response = await recent('v');
      const { predictions, since } = response.json() as FriendPredictionsResponse;
      const pub = predictions.find((p) => p.username === name('pub'));
      expect(pub).toMatchObject({
        display_name: 'Friend pub',
        fixture: { id: FIXTURE, home: { name: 'Home Friend Home' } },
        version: { outcome: 'home', score: { home: 2, away: 1 } },
        revisions: 1,
        settlement: null,
      });
      expect(Date.parse(since)).toBeLessThan(Date.now() - 6 * 86_400_000);
    });

    it('shows a friend whose history is for friends', async () => {
      expect(await shown('v')).toContain(name('fri'));
    });

    it('never shows a friend whose history is private', async () => {
      expect(await shown('v')).not.toContain(name('pri'));
    });

    it("never shows a stranger's, the viewer's own, or a call outside the window", async () => {
      const seen = await shown('v');
      expect(seen).not.toContain(name('x'));
      expect(seen).not.toContain(name('v'));
      expect(seen).not.toContain(name('old'));
      expect(seen.sort()).toEqual([name('fri'), name('pub')].sort());
    });

    it('follows a changed setting at once, and a revision moves the call to the top', async () => {
      await visibility('fri', 'private');
      expect(await shown('v')).toEqual([name('pub')]);
      await visibility('fri', 'friends');
      expect((await predict('fri', 'away')).statusCode).toBe(200);
      const response = await recent('v');
      const [first] = (response.json() as FriendPredictionsResponse).predictions;
      expect(first).toMatchObject({
        username: name('fri'),
        version: { outcome: 'away', version_number: 2 },
        revisions: 2,
      });
    });

    it('stops at the end of a friendship', async () => {
      await pool.query(
        `DELETE FROM friendship WHERE low_id = LEAST($1::uuid, $2::uuid) AND high_id = GREATEST($1::uuid, $2::uuid)`,
        [ids.get('v'), ids.get('pub')],
      );
      expect(await shown('v')).not.toContain(name('pub'));
    });
  },
);
