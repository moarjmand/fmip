import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { NotificationsResponse } from '@fmip/contracts';
import { NOTIFICATION_HOURLY_CAP } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../identity/identity.service';
import { CaptureMailer, MAILER } from '../identity/internal/mailer';
import { NotificationsModule } from './notifications.module';
import { NotificationsService } from './notifications.service';

/**
 * Quiet hours and frequency limits (T-273).
 *
 * The criterion is **a quiet-hours notification is delayed or dropped by rule,
 * and says which** — and the rule this product chose is worth stating because
 * the two halves do different things on purpose.
 *
 * Quiet hours **delay**: they are about when somebody is disturbed, never about
 * whether they are told. The frequency cap **drops**: the tenth message
 * notification in an hour tells a member nothing the ninth did not. Both say so
 * in the inbox, because a cap that left no trace would make it quietly
 * incomplete.
 */
const DATABASE_URL = process.env.DATABASE_URL;
vi.setConfig({ testTimeout: 40_000, hookTimeout: 40_000 });

const ENGLAND = '00000000-0000-4000-8000-000000000101';
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);

function cookieValue(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return /^fmip_session=([^;]*)/.exec(header ?? '')?.[1] ?? '';
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  'quiet hours and frequency limits',
  () => {
    let app: NestFastifyApplication;
    let pool: Pool;
    let notifications: NotificationsService;

    const sleeper = `qh${RUN}s`;
    const source = `qh${RUN}x`;
    const cookies = new Map<string, string>();
    const ids = new Map<string, string>();

    const as = (who: string) => ({ cookie: `fmip_session=${cookies.get(who) ?? ''}` });
    const inbox = (who: string) =>
      app
        .inject({ method: 'GET', url: '/me/notifications', headers: as(who) })
        .then((r) => r.json() as NotificationsResponse);

    const rows = (who: string) =>
      pool
        .query<{ kind: string; held_reason: string | null; deliver_after: Date }>(
          `SELECT kind, held_reason, deliver_after FROM notification
            WHERE user_id = $1 ORDER BY created_at`,
          [ids.get(who)],
        )
        .then((r) => r.rows);

    /**
     * Emit one, with a distinct subject so nothing is deduplicated by accident.
     *
     * The source is always the *other* member: nobody is notified about
     * themselves, and the schema refuses it (T-270).
     */
    const emit = (to: string, kind: 'mentioned' | 'message_received' | 'moderation_decision') =>
      notifications.emit({
        userId: ids.get(to) ?? '',
        kind,
        subjectType: 'message',
        subjectId: randomUUID(),
        sourceId:
          kind === 'moderation_decision'
            ? null
            : (ids.get(to === sleeper ? source : sleeper) ?? null),
      });

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
      const { rows: created } = await pool.query<{ id: string }>(
        `UPDATE user_account SET email_verified_at = now() WHERE username = $1 RETURNING id`,
        [username],
      );
      ids.set(username, created[0]?.id ?? '');
    }

    /** Quiet from an hour ago to an hour from now, on the member's own clock. */
    async function beQuietNow(who: string): Promise<void> {
      await pool.query(
        `INSERT INTO quiet_hours (user_id, starts_at, ends_at)
         SELECT $1,
                ((now() AT TIME ZONE u.timezone) - interval '1 hour')::time,
                ((now() AT TIME ZONE u.timezone) + interval '1 hour')::time
           FROM user_account u WHERE u.id = $1
         ON CONFLICT (user_id) DO UPDATE
            SET starts_at = EXCLUDED.starts_at, ends_at = EXCLUDED.ends_at`,
        [ids.get(who)],
      );
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
      notifications = app.get(NotificationsService);

      for (const username of [sleeper, source]) await register(username);
    });

    afterAll(async () => {
      const everyone = [...ids.values()];
      await pool.query(`DELETE FROM user_account WHERE id = ANY($1::uuid[])`, [everyone]);
      await pool.end();
      await app.close();
    });

    describe('quiet hours delay, and never discard', () => {
      it('writes it, keeps it out of the inbox, and says why it is waiting', async () => {
        await beQuietNow(sleeper);
        expect(await emit(sleeper, 'mentioned')).toBe('delayed');

        // Written. Nothing is thrown away because it landed at the wrong hour.
        const written = await rows(sleeper);
        expect(written).toHaveLength(1);
        expect(written[0]?.held_reason).toBe('your quiet hours');

        // And not in the inbox, nor in the badge: a count for something nobody
        // can see would send a member looking for it.
        const seen = await inbox(sleeper);
        expect(seen.notifications).toHaveLength(0);
        expect(seen.unread).toBe(0);
      });

      it('delays it to the end of the window, not by a fixed amount', async () => {
        const [held] = await rows(sleeper);
        const { rows: expected } = await pool.query<{ ends: Date }>(
          `SELECT quiet_hours_end($1, now()) AS ends`,
          [ids.get(sleeper)],
        );
        // The same function the emitter used, asked again: the delay is until
        // their morning, whatever time it is now.
        expect(held?.deliver_after.toISOString()).toBe(expected[0]?.ends.toISOString());
      });

      it('delays a moderation decision too, rather than dropping it', async () => {
        // The case the rule exists to settle. Dropping this because it landed
        // at two in the morning would be the product deciding a member did not
        // need to know what was done to their account.
        expect(await emit(sleeper, 'moderation_decision')).toBe('delayed');
        const written = await rows(sleeper);
        expect(written.filter((r) => r.kind === 'moderation_decision')).toHaveLength(1);
      });

      it('arrives once the window has passed, carrying its reason', async () => {
        // `deliver_after = created_at`, not `now() - 1 minute`. The schema
        // refuses a delivery earlier than the creation it belongs to
        // (`notification_delivers_after_creation`), and it is right to: a
        // notification cannot arrive before it exists. Winding the clock forward
        // is spelled as "deliverable from the moment it was made".
        await pool.query(`UPDATE notification SET deliver_after = created_at WHERE user_id = $1`, [
          ids.get(sleeper),
        ]);
        const seen = await inbox(sleeper);
        expect(seen.notifications).toHaveLength(2);
        expect(seen.unread).toBe(2);
        // Shown rather than swallowed: the member can see it waited, and why.
        expect(seen.notifications.every((n) => n.held_reason === 'your quiet hours')).toBe(true);
      });

      it('sends at once again when the quiet hours are cleared', async () => {
        await pool.query(`DELETE FROM quiet_hours WHERE user_id = $1`, [ids.get(sleeper)]);
        expect(await emit(sleeper, 'mentioned')).toBe('sent');
        const newest = (await rows(sleeper)).at(-1);
        expect(newest?.held_reason).toBeNull();
      });
    });

    describe('a frequency cap drops, and says how many', () => {
      it('sends up to the ceiling and then stops writing', async () => {
        const cap = NOTIFICATION_HOURLY_CAP.message_received ?? 0;
        expect(cap).toBeGreaterThan(0);

        for (let n = 0; n < cap; n += 1) {
          expect(await emit(source, 'message_received')).toBe('sent');
        }
        expect(await emit(source, 'message_received')).toBe('capped');
        expect(await emit(source, 'message_received')).toBe('capped');

        const written = (await rows(source)).filter((r) => r.kind === 'message_received');
        // The ceiling, and not one more. A row per suppressed event would be
        // the flood again with a note attached.
        expect(written).toHaveLength(cap);
      });

      it('marks the newest one with how many were held behind it', async () => {
        const written = (await rows(source)).filter((r) => r.kind === 'message_received');
        const newest = written.at(-1);
        // Two were refused above, and the count says so. Silence here would
        // make the inbox quietly incomplete (rule 3).
        expect(newest?.held_reason).toBe('2 more like this were held back this hour');
        // And the earlier ones are untouched: they arrived on their own terms.
        expect(written.slice(0, -1).every((r) => r.held_reason === null)).toBe(true);
      });

      it('caps one kind without touching another', async () => {
        // `mentioned` has no ceiling. A cap is for a thing that can happen to
        // you faster than you can care about it, and most things happen at
        // human speed.
        expect(NOTIFICATION_HOURLY_CAP.mentioned).toBeUndefined();
        expect(await emit(source, 'mentioned')).toBe('sent');
        expect(await emit(source, 'mentioned')).toBe('sent');
      });
    });
  },
);
