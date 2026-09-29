import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
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
import { ProfileModule } from './profile.module';

// Seeded catalog rows (packages/db/seed/001_catalog.sql).
const ENGLAND = '00000000-0000-4000-8000-000000000101';
const LIVERPOOL = '00000000-0000-4000-8000-000000000602';
const MAN_UNITED = '00000000-0000-4000-8000-000000000601';
const PREMIER_LEAGUE = '00000000-0000-4000-8000-000000000201';
const SALAH = '00000000-0000-4000-8000-000000000701';
const NOBODY = '00000000-0000-4000-8000-00000000ffff';
const SEASON_2025 = '00000000-0000-4000-8000-000000000302';

const DATABASE_URL = process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);

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
  'following and favourites',
  () => {
    let app: NestFastifyApplication;
    let pool: Pool;
    const username = `fw_${RUN}`;
    let cookie = '';
    const fixtures: string[] = [];

    /** A Manchester United v Liverpool match, kicking off `offset` from now. */
    async function match(status: 'scheduled' | 'finished', offset: string): Promise<string> {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO fixture (season_id, kickoff_at, status)
         VALUES ($1, now() + $2::interval, $3) RETURNING id`,
        [SEASON_2025, offset, status],
      );
      const id = rows[0]!.id;
      fixtures.push(id);
      await pool.query(
        `INSERT INTO fixture_participant (fixture_id, team_id, side)
         VALUES ($1, $2, 'home'), ($1, $3, 'away')`,
        [id, MAN_UNITED, LIVERPOOL],
      );
      return id;
    }

    const request = (
      method: 'GET' | 'PUT' | 'DELETE',
      url: string,
      payload?: unknown,
      withCookie = true,
    ) =>
      app.inject({
        method,
        url,
        ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
        headers: withCookie ? { cookie: `fmip_session=${cookie}` } : {},
      });

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [DatabaseModule, IdentityModule, ProfileModule],
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

      const registered = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          username,
          display_name: 'Follower',
          email: `${username}@example.test`,
          password: 'a perfectly fine passphrase',
          country_id: ENGLAND,
          preferred_language: 'en',
          timezone: 'Europe/London',
          accept_rules: true,
        },
      });
      cookie = cookieValue(registered.headers['set-cookie']);
    });

    afterAll(async () => {
      await pool.query(`DELETE FROM user_account WHERE username = $1`, [username]);
      await pool.query(`DELETE FROM fixture WHERE id = ANY($1::uuid[])`, [fixtures]);
      await pool.end();
      await app.close();
    });

    it('starts empty and requires a session', async () => {
      expect((await request('GET', '/me/following')).json()).toEqual({ items: [] });
      expect((await request('GET', '/me/following', undefined, false)).statusCode).toBe(401);
      expect((await request('PUT', `/me/following/team/${LIVERPOOL}`, {}, false)).statusCode).toBe(
        401,
      );
    });

    it('follows a team, a competition and a person, joining their current names', async () => {
      await request('PUT', `/me/following/team/${MAN_UNITED}`, {});
      await request('PUT', `/me/following/competition/${PREMIER_LEAGUE}`);
      const response = await request('PUT', `/me/following/person/${SALAH}`, {});

      expect(response.statusCode).toBe(200);
      expect(response.json().items).toEqual([
        expect.objectContaining({
          entity_type: 'team',
          entity_id: MAN_UNITED,
          name: 'Manchester United',
          favourite: false,
        }),
        expect.objectContaining({
          entity_type: 'person',
          entity_id: SALAH,
          name: 'Mohamed Salah',
          favourite: false,
        }),
        expect.objectContaining({
          entity_type: 'competition',
          entity_id: PREMIER_LEAGUE,
          name: 'Premier League',
          favourite: false,
        }),
      ]);
    });

    it('a favourite is followed and sorts first; following twice is one row', async () => {
      const first = await request('PUT', `/me/following/team/${LIVERPOOL}`, { favourite: true });
      const second = await request('PUT', `/me/following/team/${LIVERPOOL}`, { favourite: true });

      expect(first.statusCode).toBe(200);
      expect(second.json().items).toHaveLength(4);
      expect(second.json().items[0]).toMatchObject({ name: 'Liverpool', favourite: true });

      const { rows } = await pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM followed_entity f JOIN user_account u ON u.id = f.user_id WHERE u.username = $1 AND f.entity_id = $2`,
        [username, LIVERPOOL],
      );
      expect(rows[0]?.n).toBe(1);
    });

    it('exposes the id sets a personalised view sorts with, and the favourite teams on the profile', async () => {
      const favourites = await request('GET', '/me/favourites');
      expect(favourites.json()).toEqual({
        team_ids: [LIVERPOOL],
        competition_ids: [],
        person_ids: [],
        followed_team_ids: expect.arrayContaining([LIVERPOOL, MAN_UNITED]),
        followed_competition_ids: [PREMIER_LEAGUE],
      });

      const profile = await request('GET', `/profiles/${username}`, undefined, false);
      expect(profile.json().profile.favourite_teams).toEqual(['Liverpool']);
    });

    it('unpins without unfollowing, and unfollows', async () => {
      const unpinned = await request('PUT', `/me/following/team/${LIVERPOOL}`, {
        favourite: false,
      });
      expect(
        unpinned.json().items.find((i: { entity_id: string }) => i.entity_id === LIVERPOOL),
      ).toMatchObject({ favourite: false });

      const removed = await request('DELETE', `/me/following/team/${LIVERPOOL}`);
      expect(removed.statusCode).toBe(200);
      expect(removed.json().items.map((i: { entity_id: string }) => i.entity_id)).not.toContain(
        LIVERPOOL,
      );
      expect(
        (await request('GET', `/profiles/${username}`, undefined, false)).json().profile
          .favourite_teams,
      ).toEqual([]);
    });

    it('follows a match by name, never as a favourite, and not once its window has closed (D-116)', async () => {
      const upcoming = await match('scheduled', '1 day');
      const followed = await request('PUT', `/me/following/fixture/${upcoming}`, {});
      expect(followed.statusCode).toBe(200);
      expect(followed.json().items).toContainEqual(
        expect.objectContaining({
          entity_type: 'fixture',
          entity_id: upcoming,
          name: 'Manchester United v Liverpool',
          favourite: false,
        }),
      );
      const pinned = await request('PUT', `/me/following/fixture/${upcoming}`, { favourite: true });
      expect(pinned.statusCode).toBe(400);
      expect(pinned.json().fields).toEqual({ favourite: 'must not be true for a match' });
      // A match is not a favourite team: the id sets are unchanged.
      expect((await request('GET', '/me/favourites')).json().team_ids).toEqual([]);

      // Full-time two hours after a kick-off five hours ago: past the three-hour window.
      const over = await match('finished', '-5 hours');
      const late = await request('PUT', `/me/following/fixture/${over}`, {});
      expect(late.statusCode).toBe(409);
      expect(late.json().error).toBe('conflict');
      // Finished an hour ago: still open.
      const recent = await match('finished', '-3 hours');
      expect((await request('PUT', `/me/following/fixture/${recent}`, {})).statusCode).toBe(200);
      expect((await request('PUT', `/me/following/fixture/${NOBODY}`, {})).statusCode).toBe(404);

      // The window closes on a followed match: it leaves the list by itself,
      // and its row goes the next time the member follows a match.
      await pool.query(`UPDATE fixture SET kickoff_at = now() - interval '6 hours' WHERE id = $1`, [
        recent,
      ]);
      const listed = (await request('GET', '/me/following')).json().items as {
        entity_id: string;
      }[];
      expect(listed.map((i) => i.entity_id)).toContain(upcoming);
      expect(listed.map((i) => i.entity_id)).not.toContain(recent);
      await request('PUT', `/me/following/fixture/${upcoming}`, {});
      const { rows } = await pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM followed_entity WHERE entity_id = $1`,
        [recent],
      );
      expect(rows[0]?.n).toBe(0);

      const unfollowed = await request('DELETE', `/me/following/fixture/${upcoming}`);
      expect(unfollowed.json().items.map((i: { entity_id: string }) => i.entity_id)).not.toContain(
        upcoming,
      );
    });

    it('rejects an unknown entity, an unknown type, a bad id and a bad flag', async () => {
      expect((await request('PUT', `/me/following/team/${NOBODY}`, {})).statusCode).toBe(404);
      const badType = await request('PUT', `/me/following/stadium/${LIVERPOOL}`, {});
      expect(badType.statusCode).toBe(400);
      expect(badType.json().fields.entity_type).toMatch(/must be one of/);
      expect((await request('PUT', `/me/following/team/not-a-uuid`, {})).statusCode).toBe(400);
      const badFlag = await request('PUT', `/me/following/team/${LIVERPOOL}`, { favourite: 'yes' });
      expect(badFlag.statusCode).toBe(400);
      expect(badFlag.json().fields).toEqual({ favourite: 'must be true or false' });
    });
  },
);
