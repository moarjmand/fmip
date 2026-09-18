import { randomUUID } from 'node:crypto';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { NotificationSettings } from '@fmip/contracts';
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_OF,
  NOTIFICATION_KINDS,
} from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../identity/identity.service';
import { CaptureMailer, MAILER } from '../identity/internal/mailer';
import { NotificationsModule } from './notifications.module';
import { NotificationsService } from './notifications.service';

/**
 * Per-team, per-competition and per-category controls (T-331, blueprint
 * 12.2): a member can silence one team without silencing football.
 *
 * Two clubs and a match between them exist for this run. A mute on one club
 * silences a notification about that match and leaves one about another
 * match alone; a mute on the competition silences both; a category mute
 * silences every kind in it and nothing outside it; a mute names a team by
 * id and a made-up id is refused; unmuting is the end of it; and the
 * settings list what was silenced, with the club's name for the page.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const ENGLAND = '00000000-0000-4000-8000-000000000101';
const PREMIER_LEAGUE = '00000000-0000-4000-8000-000000000201';
const PL_2025 = '00000000-0000-4000-8000-000000000302';
const REGULAR_SEASON = '00000000-0000-4000-8000-000000000401';
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const HOME = randomUUID();
const AWAY = randomUUID();
const OTHER = randomUUID();
const MATCH = randomUUID();
const OTHER_MATCH = randomUUID();

function cookieValue(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return /^fmip_session=([^;]*)/.exec(header ?? '')?.[1] ?? '';
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('notification mutes', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let notifications: NotificationsService;
  const username = `mu_${RUN}`;
  let userId = '';
  let cookie = '';

  const mute = (scope: string, target: string) =>
    app.inject({
      method: 'PUT',
      url: `/me/notification-mutes/${scope}/${target}`,
      headers: { cookie },
    });
  const unmute = (scope: string, target: string) =>
    app.inject({
      method: 'DELETE',
      url: `/me/notification-mutes/${scope}/${target}`,
      headers: { cookie },
    });
  const settings = async (): Promise<NotificationSettings> =>
    (
      await app.inject({ method: 'GET', url: '/me/notification-settings', headers: { cookie } })
    ).json<NotificationSettings>();
  const about = (
    fixtureId: string,
    kind: 'prediction_settled' | 'friend_request' = 'prediction_settled',
  ) =>
    notifications.emit({
      userId,
      kind,
      subjectType: kind === 'friend_request' ? 'member' : 'fixture',
      subjectId: fixtureId,
      dedupeKey: `${kind}-${fixtureId}-${randomUUID()}`,
    });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, NotificationsModule],
    })
      .overrideProvider(MAILER)
      .useValue(new CaptureMailer())
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
    notifications = moduleRef.get(NotificationsService);
    pool = new Pool({ connectionString: DATABASE_URL });

    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        username,
        display_name: 'Mute Tester',
        email: `${username}@example.test`,
        password: 'a perfectly fine passphrase',
        country_id: ENGLAND,
        preferred_language: 'en',
        timezone: 'Europe/London',
        accept_rules: true,
      },
    });
    expect(response.statusCode).toBe(201);
    cookie = `fmip_session=${cookieValue(response.headers['set-cookie'])}`;
    const { rows } = await pool.query<{ id: string }>(
      `UPDATE user_account SET email_verified_at = now() WHERE username = $1 RETURNING id`,
      [username],
    );
    userId = rows[0]!.id;

    await pool.query(
      `INSERT INTO team (id, country_id, name, short_name, kind, gender) VALUES
         ($1, $4, $5, 'MHM', 'club', 'men'),
         ($2, $4, $6, 'MAW', 'club', 'men'),
         ($3, $4, $7, 'MOT', 'club', 'men')`,
      [HOME, AWAY, OTHER, ENGLAND, `Mute Home ${RUN}`, `Mute Away ${RUN}`, `Mute Other ${RUN}`],
    );
    await pool.query(
      `INSERT INTO fixture (id, season_id, stage_id, round, kickoff_at, status) VALUES
         ($1, $3, $4, 'Matchday 9', now() + interval '2 days', 'scheduled'),
         ($2, $3, $4, 'Matchday 9', now() + interval '2 days', 'scheduled')`,
      [MATCH, OTHER_MATCH, PL_2025, REGULAR_SEASON],
    );
    await pool.query(
      `INSERT INTO fixture_participant (fixture_id, team_id, side) VALUES
         ($1, $3, 'home'), ($1, $4, 'away'), ($2, $4, 'home'), ($2, $5, 'away')`,
      [MATCH, OTHER_MATCH, HOME, AWAY, OTHER],
    );
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM user_account WHERE username = $1`, [username]);
    await pool.query(`DELETE FROM fixture WHERE id IN ($1, $2)`, [MATCH, OTHER_MATCH]);
    await pool.query(`DELETE FROM team WHERE id IN ($1, $2, $3)`, [HOME, AWAY, OTHER]);
    await pool.end();
    await app.close();
  });

  it('puts every kind in exactly one category', () => {
    for (const kind of NOTIFICATION_KINDS) {
      expect(NOTIFICATION_CATEGORIES, kind).toContain(NOTIFICATION_CATEGORY_OF[kind]);
    }
    expect(Object.keys(NOTIFICATION_CATEGORY_OF).sort()).toEqual([...NOTIFICATION_KINDS].sort());
  });

  it('silences one team without silencing football', async () => {
    expect(await about(MATCH)).toBe('sent');
    expect((await mute('team', HOME)).statusCode).toBe(204);

    expect(await about(MATCH)).toBe('muted');
    // Away plays somebody else: not the muted club's match, so it arrives.
    expect(await about(OTHER_MATCH)).toBe('sent');
    // A friend request is about nobody's team.
    expect(await about(randomUUID(), 'friend_request')).toBe('sent');
    // Football as a kind is untouched: the preference in force is still the default.
    const current = await settings();
    expect(current.preferences.find((p) => p.kind === 'prediction_settled')?.in_product).toBe(true);
    expect(current.mutes).toEqual([
      expect.objectContaining({ scope: 'team', target: HOME, label: `Mute Home ${RUN}` }),
    ]);

    // Idempotent, and undone by one call.
    expect((await mute('team', HOME)).statusCode).toBe(204);
    expect((await unmute('team', HOME)).statusCode).toBe(204);
    expect((await unmute('team', HOME)).statusCode).toBe(404);
    expect(await about(MATCH)).toBe('sent');
  });

  it('silences a competition, which is every match in it', async () => {
    expect((await mute('competition', PREMIER_LEAGUE)).statusCode).toBe(204);
    expect(await about(MATCH)).toBe('muted');
    expect(await about(OTHER_MATCH)).toBe('muted');
    expect((await settings()).mutes).toEqual([
      expect.objectContaining({
        scope: 'competition',
        target: PREMIER_LEAGUE,
        label: 'Premier League',
      }),
    ]);
    expect((await unmute('competition', PREMIER_LEAGUE)).statusCode).toBe(204);
    expect(await about(MATCH)).toBe('sent');
  });

  it('silences a category as one, and nothing outside it', async () => {
    expect((await mute('category', 'social')).statusCode).toBe(204);
    expect(await notifications.wants(userId, 'friend_request')).toBe(false);
    expect(await notifications.wants(userId, 'message_received')).toBe(false);
    expect(await notifications.wants(userId, 'prediction_settled')).toBe(true);
    expect(await about(randomUUID(), 'friend_request')).toBe('muted');
    expect(await about(MATCH)).toBe('sent');
    const current = await settings();
    expect(current.mutes).toEqual([
      expect.objectContaining({ scope: 'category', target: 'social', label: null }),
    ]);
    // The per-kind preference is untouched by a category mute: it still reads as the default.
    expect(current.preferences.find((p) => p.kind === 'friend_request')?.chosen).toBe(false);
    expect((await unmute('category', 'social')).statusCode).toBe(204);
    expect(await notifications.wants(userId, 'friend_request')).toBe(true);
  });

  it('names a target by id and refuses what does not exist', async () => {
    expect((await mute('team', randomUUID())).statusCode).toBe(400);
    expect((await mute('team', 'liverpool')).statusCode).toBe(400);
    expect((await mute('category', 'gossip')).statusCode).toBe(400);
    expect((await mute('player', HOME)).statusCode).toBe(404);
    const guest = await app.inject({ method: 'PUT', url: `/me/notification-mutes/team/${HOME}` });
    expect(guest.statusCode).toBe(401);
    expect((await settings()).mutes).toEqual([]);
  });
});
