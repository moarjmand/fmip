import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { NotificationSettings, NotificationsResponse } from '@fmip/contracts';
import { NOTIFICATION_DEFAULTS, NOTIFICATION_KINDS } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../identity/identity.service';
import { CaptureMailer, MAILER } from '../identity/internal/mailer';
import { NotificationsModule } from './notifications.module';

/**
 * The inbox, and the settings behind it (T-272).
 *
 * The acceptance criterion is **every notification opens the match, profile,
 * group or conversation that caused it**, and the way that is kept true is that
 * the pair is always present — so the interesting assertion is not that a link
 * works but that no notification can be returned without one.
 *
 * The other half is the preferences surface, which is where T-270's "a missing
 * row means the documented default" becomes visible: every kind comes back with
 * the value in force *and* whether it is the member's own.
 */
const DATABASE_URL = process.env.DATABASE_URL;
vi.setConfig({ testTimeout: 40_000, hookTimeout: 40_000 });

const ENGLAND = '00000000-0000-4000-8000-000000000101';
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);

function cookieValue(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return /^fmip_session=([^;]*)/.exec(header ?? '')?.[1] ?? '';
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('the inbox', () => {
  let app: NestFastifyApplication;
  let pool: Pool;

  const owner = `ib${RUN}o`;
  const other = `ib${RUN}x`;
  const cookies = new Map<string, string>();
  const ids = new Map<string, string>();

  const as = (who?: string) =>
    who === undefined ? {} : { cookie: `fmip_session=${cookies.get(who) ?? ''}` };
  const get = (url: string, who?: string) => app.inject({ method: 'GET', url, headers: as(who) });
  const post = (url: string, who?: string) => app.inject({ method: 'POST', url, headers: as(who) });
  const put = (url: string, payload: unknown, who?: string) =>
    app.inject({
      method: 'PUT',
      url,
      payload: payload as Record<string, unknown>,
      headers: as(who),
    });

  const inbox = (who: string) =>
    get('/me/notifications', who).then((r) => r.json() as NotificationsResponse);
  const settings = (who: string) =>
    get('/me/notification-settings', who).then((r) => r.json() as NotificationSettings);

  /** Written straight in, because what emits them is T-271 and already tested. */
  const seed = (
    who: string,
    kind: string,
    subjectType: string,
    subjectId: string,
    deliver = 'now()',
  ) =>
    pool.query<{ id: string }>(
      `INSERT INTO notification (user_id, kind, subject_type, subject_id, deliver_after, held_reason)
       VALUES ($1, $2, $3, $4, ${deliver}, $5) RETURNING id`,
      [ids.get(who), kind, subjectType, subjectId, deliver === 'now()' ? null : 'quiet hours'],
    );

  async function register(username: string): Promise<void> {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        username,
        display_name: `Member ${username}`,
        email: `${username}@example.test`,
        password: 'a perfectly fine passphrase',
        country_id: ENGLAND,
        preferred_language: 'en',
        timezone: 'Europe/London',
        accept_rules: true,
      },
    });
    expect(response.statusCode).toBe(201);
    cookies.set(username, cookieValue(response.headers['set-cookie']));
    const { rows } = await pool.query<{ id: string }>(
      `UPDATE user_account SET email_verified_at = now() WHERE username = $1 RETURNING id`,
      [username],
    );
    ids.set(username, rows[0]?.id ?? '');
  }

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
    pool = new Pool({ connectionString: DATABASE_URL });

    for (const username of [owner, other]) await register(username);
  });

  afterAll(async () => {
    const everyone = [...ids.values()];
    await pool.query(`DELETE FROM user_account WHERE id = ANY($1::uuid[])`, [everyone]);
    await pool.end();
    await app.close();
  });

  describe('every notification opens the thing that caused it', () => {
    it('always carries the pair, whatever the kind', async () => {
      await seed(owner, 'prediction_settled', 'fixture', randomUUID());
      await seed(owner, 'friend_request', 'member', ids.get(other) ?? '');
      await seed(owner, 'group_invite', 'group', randomUUID());

      const body = await inbox(owner);
      expect(body.notifications).toHaveLength(3);
      // The criterion, asserted as a property of every row rather than of the
      // three that happen to be here: a notification that cannot open the thing
      // it is about is a sentence, and an inbox of sentences is a worse email
      // folder.
      for (const notification of body.notifications) {
        expect(notification.subject_type).toBeTruthy();
        expect(notification.subject_id).toBeTruthy();
      }
    });

    it('resolves the handle a route is actually keyed by', async () => {
      const body = await inbox(owner);
      const aboutMember = body.notifications.find((n) => n.subject_type === 'member');
      // The gap this field exists to close: a profile lives at `/u/{username}`
      // and a group at `/groups/{slug}`, while `subject_id` is the canonical
      // UUID (rule 1). Without the label the pair could not open two of the
      // four things the criterion names.
      expect(aboutMember?.subject_label).toBe(other);

      const aboutFixture = body.notifications.find((n) => n.subject_type === 'fixture');
      // A fixture is addressed by its id, so there is nothing to resolve and
      // null is the honest answer rather than a repeat of the id.
      expect(aboutFixture?.subject_label).toBeNull();
    });

    it('leaves the label null when the subject no longer resolves', async () => {
      // A group that was deleted. A client with no label renders the
      // notification without a link rather than one that 404s.
      await seed(owner, 'group_invite', 'group', randomUUID());
      const body = await inbox(owner);
      const orphan = body.notifications.find((n) => n.subject_type === 'group');
      expect(orphan?.subject_label).toBeNull();
    });

    it('sends the pair and not a URL', async () => {
      const body = await inbox(owner);
      const raw = JSON.stringify(body);
      // A URL built in the API would put the web app's routing table in the
      // API, and Phase 4's second client would have to accept the web's routes
      // or ignore the field.
      expect(raw).not.toMatch(/"https?:\/\//);
      expect(raw).not.toMatch(/"\/[a-z]{2}\/match/);
    });

    it('is one member and nobody else', async () => {
      expect((await get('/me/notifications')).statusCode).toBe(401);
      expect((await inbox(other)).notifications).toHaveLength(0);
    });
  });

  describe('unread, and reading', () => {
    it('counts the whole inbox rather than the page', async () => {
      const whole = await inbox(owner);
      expect(whole.notifications.length).toBeGreaterThan(1);

      const page = await get('/me/notifications?limit=1', owner).then(
        (r) => r.json() as NotificationsResponse,
      );
      expect(page.notifications).toHaveLength(1);
      // Asserted as a relationship rather than a number: a badge counting only
      // what was fetched would go down when somebody scrolled, and a hardcoded
      // total would only say how many rows this file happens to seed.
      expect(page.unread).toBe(whole.notifications.length);
    });

    it('reads one, and refuses somebody else one of theirs', async () => {
      const before = await inbox(owner);
      const first = before.notifications[0]?.id ?? '';
      expect((await post(`/me/notifications/${first}/read`, owner)).statusCode).toBe(204);
      expect((await inbox(owner)).unread).toBe(before.unread - 1);

      // 404, not 403: telling a stranger "that exists but is not yours" answers
      // "does this id exist" for anybody who guesses one.
      expect((await post(`/me/notifications/${first}/read`, other)).statusCode).toBe(404);
      // And reading one twice is 404 too, which is the same sentence.
      expect((await post(`/me/notifications/${first}/read`, owner)).statusCode).toBe(404);
    });

    it('reads the rest at once and says how many changed', async () => {
      const remaining = (await inbox(owner)).unread;
      expect(remaining).toBeGreaterThan(0);
      const response = await post('/me/notifications/read', owner);
      expect(response.statusCode).toBe(200);
      expect((response.json() as { read: number }).read).toBe(remaining);
      expect((await inbox(owner)).unread).toBe(0);
    });
  });

  describe('a held notification waits, and says so', () => {
    it('is absent until its moment, and then arrives carrying its reason', async () => {
      const held = await seed(
        other,
        'rating_changed',
        'member',
        ids.get(other) ?? '',
        `now() + interval '1 hour'`,
      );
      // Not in the inbox yet, and not counted either: a badge for something
      // nobody can see would send a member looking for it.
      expect((await inbox(other)).notifications).toHaveLength(0);
      expect((await inbox(other)).unread).toBe(0);

      await pool.query(`UPDATE notification SET deliver_after = now() WHERE id = $1`, [
        held.rows[0]?.id,
      ]);
      const body = await inbox(other);
      expect(body.notifications).toHaveLength(1);
      // Shown rather than swallowed. A delay that left no trace would make the
      // inbox quietly incomplete (rule 3, T-270).
      expect(body.notifications[0]?.held_reason).toBe('quiet hours');
    });
  });

  describe('the settings say what is in force and whose decision it was', () => {
    it('returns every kind, with the documented default and `chosen: false`', async () => {
      const body = await settings(owner);
      expect(body.preferences).toHaveLength(NOTIFICATION_KINDS.length);
      for (const preference of body.preferences) {
        expect(preference.chosen).toBe(false);
        // The visible form of "a missing row means the documented default".
        expect(preference.in_product).toBe(NOTIFICATION_DEFAULTS[preference.kind]);
      }
      expect(body.timezone).toBe('Europe/London');
      expect(body.quiet_hours).toBeNull();
    });

    it('records a choice, and marks it as one even when it agrees with the default', async () => {
      expect(
        (await put('/me/notification-settings/mentioned', { in_product: false }, owner)).statusCode,
      ).toBe(204);
      // Turning something *on* that was already on is still a choice, and the
      // difference matters the day the default changes: this member said yes.
      expect(
        (await put('/me/notification-settings/panel_reaction', { in_product: true }, owner))
          .statusCode,
      ).toBe(204);

      const body = await settings(owner);
      const mentioned = body.preferences.find((p) => p.kind === 'mentioned');
      const reaction = body.preferences.find((p) => p.kind === 'panel_reaction');
      expect(mentioned).toMatchObject({ in_product: false, chosen: true });
      expect(reaction).toMatchObject({ in_product: true, chosen: true });
    });

    it('is idempotent, and refuses a kind the product cannot emit', async () => {
      expect(
        (await put('/me/notification-settings/mentioned', { in_product: false }, owner)).statusCode,
      ).toBe(204);
      expect(
        (await put('/me/notification-settings/weekly_digest', { in_product: true }, owner))
          .statusCode,
      ).toBe(404);
    });
  });

  describe('quiet hours', () => {
    it('sets a window that wraps midnight, which is the ordinary one', async () => {
      expect(
        (await put('/me/quiet-hours', { starts_at: '23:00', ends_at: '07:00' }, owner)).statusCode,
      ).toBe(204);
      expect((await settings(owner)).quiet_hours).toEqual({
        starts_at: '23:00',
        ends_at: '07:00',
      });
    });

    it('refuses something that is not a time, and a window that means nothing', async () => {
      expect(
        (await put('/me/quiet-hours', { starts_at: '25:00', ends_at: '07:00' }, owner)).statusCode,
      ).toBe(400);
      expect(
        (await put('/me/quiet-hours', { starts_at: 'evening', ends_at: '07:00' }, owner))
          .statusCode,
      ).toBe(400);
      const same = await put('/me/quiet-hours', { starts_at: '09:00', ends_at: '09:00' }, owner);
      expect(same.statusCode).toBe(400);
      // A whole day and no day at once, and nothing can tell them apart.
      expect((same.json() as { message: string }).message).toMatch(/means nothing/i);
    });

    it('clears them, twice, without complaining the second time', async () => {
      const clear = () =>
        app.inject({ method: 'DELETE', url: '/me/quiet-hours', headers: as(owner) });
      expect((await clear()).statusCode).toBe(204);
      expect((await settings(owner)).quiet_hours).toBeNull();
      // The end state is what was asked for.
      expect((await clear()).statusCode).toBe(204);
    });
  });
});
