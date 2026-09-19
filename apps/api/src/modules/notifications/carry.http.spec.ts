import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import {
  AbsentDelivery,
  OUTBOUND_DELIVERY,
  type OutboundDelivery,
  type OutboundEmail,
  type OutboundPush,
} from '../delivery/delivery.port';
import { DeliveryService } from '../delivery/delivery.service';
import { CaptureMailer, MAILER } from '../identity/internal/mailer';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../identity/identity.service';
import type { PostgresNotificationsStore } from './internal/notifications-store';
import { NotificationsModule } from './notifications.module';
import { NotificationsService, WEB_ORIGIN } from './notifications.service';

/**
 * The way out (T-330, the composition): a notification of any kind leaves
 * the building as the inbox's own sentence and route -- an e-mail with the
 * absolute link, a push with the path -- once, claimed before the send; one
 * older than a day is not carried when a channel arrives; and with no
 * channel at all nothing is even claimed.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const ENGLAND = '00000000-0000-4000-8000-000000000101';

function cookieValue(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return /^fmip_session=([^;]*)/.exec(header ?? '')?.[1] ?? '';
}

describe('carry with no channel', () => {
  it('claims nothing: the inbox is the only place, and it already says so', async () => {
    let asked = 0;
    const store = {
      due: async () => {
        asked += 1;
        return [];
      },
    } as unknown as PostgresNotificationsStore;
    const service = new NotificationsService(
      store,
      new DeliveryService(new AbsentDelivery()),
      'http://web.test',
    );
    expect(await service.carry()).toEqual({ due: 0, carried: 0 });
    expect(asked).toBe(0);
  });
});

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('carry', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let service: NotificationsService;
  const ids = new Map<string, string>();
  const ada = `cr_${RUN}a`;
  const bob = `cr_${RUN}b`;
  const mails: OutboundEmail[] = [];
  const pushes: OutboundPush[] = [];
  const channels: OutboundDelivery = {
    email: {
      provider: 'capture',
      send: async (mail) => {
        mails.push(mail);
      },
    },
    push: {
      provider: 'capture',
      send: async (push) => {
        pushes.push(push);
      },
    },
  };

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
    expect(cookieValue(response.headers['set-cookie'])).not.toBe('');
    const { rows } = await pool.query<{ id: string }>(
      `UPDATE user_account SET email_verified_at = now() WHERE username = $1 RETURNING id`,
      [username],
    );
    ids.set(username, rows[0]!.id);
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
      .overrideProvider(OUTBOUND_DELIVERY)
      .useValue(channels)
      .overrideProvider(WEB_ORIGIN)
      .useValue('http://web.test')
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    pool = new Pool({ connectionString: DATABASE_URL });
    service = app.get(NotificationsService);
    await register(ada);
    await register(bob);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM user_account WHERE username LIKE $1`, [`cr_${RUN}%`]);
    await pool.end();
    await app.close();
  });

  it('carries a friend request as the inbox sentence with the absolute link, once', async () => {
    expect(
      await service.emit({
        userId: ids.get(ada)!,
        kind: 'friend_request',
        subjectType: 'member',
        subjectId: ids.get(bob)!,
        sourceId: ids.get(bob)!,
        dedupeKey: `friend:${ids.get(bob)}`,
      }),
    ).toBe('sent');
    const first = await service.carry();
    expect(first.carried).toBeGreaterThanOrEqual(1);
    const mine = mails.filter((mail) => mail.to === `${ada}@example.test`);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toEqual({
      to: `${ada}@example.test`,
      subject: `${bob} sent you a friend request.`,
      text: `${bob} sent you a friend request.\n\nhttp://web.test/en/u/${bob}`,
    });
    const push = pushes.filter((p) => p.userId === ids.get(ada));
    expect(push).toHaveLength(1);
    expect(push[0]).toMatchObject({
      title: 'FMIP',
      body: `${bob} sent you a friend request.`,
      url: `/en/u/${bob}`,
    });
    await service.carry();
    expect(mails.filter((mail) => mail.to === `${ada}@example.test`)).toHaveLength(1);
    const { rows } = await pool.query<{ email: string; push: string }>(
      `SELECT d.email, d.push FROM notification_delivery d
         JOIN notification n ON n.id = d.notification_id
        WHERE n.user_id = $1`,
      [ids.get(ada)],
    );
    expect(rows).toEqual([{ email: 'sent', push: 'sent' }]);
  });

  it('sends a push to the inbox and an e-mail without a link when the subject cannot be opened', async () => {
    // A group the notification is about that no longer resolves: the label is
    // null, the sentence still stands, and the push opens the inbox.
    await pool.query(
      `INSERT INTO notification (user_id, kind, subject_type, subject_id, source_id)
       VALUES ($1, 'group_invite', 'group', gen_random_uuid(), $2)`,
      [ids.get(bob), ids.get(ada)],
    );
    await service.carry();
    const mine = mails.filter((mail) => mail.to === `${bob}@example.test`);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.text).toBe(`${ada} invited you to a group.`);
    expect(pushes.filter((p) => p.userId === ids.get(bob))[0]?.url).toBe('/en/notifications');
  });

  it('does not carry a notification older than a day: a channel arriving is not a flood', async () => {
    await pool.query(
      `INSERT INTO notification (user_id, kind, subject_type, subject_id, created_at, deliver_after)
       VALUES ($1, 'rating_changed', 'prediction', gen_random_uuid(),
               now() - interval '2 days', now() - interval '2 days')`,
      [ids.get(ada)],
    );
    // Other suites' members are carried by the same pass; only this member's mail is counted.
    const mine = () => mails.filter((mail) => mail.to === `${ada}@example.test`).length;
    const before = mine();
    await service.carry();
    expect(mine()).toBe(before);
  });
});
