import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { PushState } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { CaptureMailer, MAILER } from '../identity/internal/mailer';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../identity/identity.service';
import { NotificationsModule } from './notifications.module';

/**
 * A member's devices (T-330, D-074): the settings page reads whether push
 * exists and how many devices are registered; a browser's subscription is
 * kept, the same endpoint again refreshes rather than doubles, a malformed
 * one is refused, and removing one that is not there says so.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const ENGLAND = '00000000-0000-4000-8000-000000000101';

function cookieValue(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return /^fmip_session=([^;]*)/.exec(header ?? '')?.[1] ?? '';
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('push devices', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  const username = `pd_${RUN}`;
  let cookie = '';
  // A real push service's host: no other is taken (T-1880). Nothing is sent in this spec.
  const endpoint = `https://fcm.googleapis.com/fcm/send/${RUN}`;

  const as = () => ({ cookie: `fmip_session=${cookie}` });
  const state = async () => {
    const response = await app.inject({ method: 'GET', url: '/me/push', headers: as() });
    return { status: response.statusCode, body: response.json<PushState>() };
  };

  beforeAll(async () => {
    delete process.env.DELIVERY_PUSH_PROVIDER;
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
    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        username,
        display_name: 'Push Tester',
        email: `${username}@example.test`,
        password: 'a perfectly fine passphrase',
        country_id: ENGLAND,
        preferred_language: 'en',
        timezone: 'Europe/London',
        accept_rules: true,
      },
    });
    expect(response.statusCode).toBe(201);
    cookie = cookieValue(response.headers['set-cookie']);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM user_account WHERE username = $1`, [username]);
    await pool.end();
    await app.close();
  });

  it('says push is absent on this deployment, with no device yet, and needs a session', async () => {
    expect((await state()).body).toEqual({ state: 'absent', email: false, devices: 0 });
    const guest = await app.inject({ method: 'GET', url: '/me/push' });
    expect(guest.statusCode).toBe(401);
  });

  it('keeps a browser subscription once, refreshes the same endpoint, and refuses a malformed one', async () => {
    const subscribe = (body: Record<string, unknown>) =>
      app.inject({ method: 'POST', url: '/me/push-subscriptions', headers: as(), payload: body });
    expect((await subscribe({ endpoint, keys: { p256dh: 'p1', auth: 'a1' } })).statusCode).toBe(
      204,
    );
    expect((await subscribe({ endpoint, keys: { p256dh: 'p2', auth: 'a2' } })).statusCode).toBe(
      204,
    );
    expect((await state()).body.devices).toBe(1);
    const { rows } = await pool.query<{ p256dh: string }>(
      `SELECT p256dh FROM push_subscription WHERE endpoint = $1`,
      [endpoint],
    );
    expect(rows).toEqual([{ p256dh: 'p2' }]);
    expect(
      (await subscribe({ endpoint: 'http://not-https', keys: { p256dh: 'p', auth: 'a' } }))
        .statusCode,
    ).toBe(400);
    expect((await subscribe({ endpoint, keys: { p256dh: '', auth: 'a' } })).statusCode).toBe(400);
    // T-1880: only a browser's own push service, by name, over https on its own port.
    for (const elsewhere of [
      `https://push.example/${RUN}`,
      'https://127.0.0.1/hook',
      'https://[::1]/hook',
      'https://169.254.169.254/latest/meta-data/',
      'https://fcm.googleapis.com:8443/fcm/send/x',
      'https://fcm.googleapis.com.example.com/fcm/send/x',
      'https://fcm.googleapis.com@example.com/fcm/send/x',
      'https://api.push.apple.com/3/device/x',
    ]) {
      const refused = await subscribe({ endpoint: elsewhere, keys: { p256dh: 'p', auth: 'a' } });
      expect(refused.statusCode, elsewhere).toBe(400);
      expect(refused.json<{ error: string }>().error, elsewhere).toBe('validation');
    }
    // The other browsers' services are taken; nothing refused was stored.
    for (const [n, real] of [
      `https://updates.push.services.mozilla.com/wpush/v2/${RUN}`,
      `https://wns2-par02p.notify.windows.com/w/?token=${RUN}`,
      `https://web.push.apple.com/${RUN}`,
    ].entries()) {
      expect(
        (await subscribe({ endpoint: real, keys: { p256dh: `p${n}`, auth: 'a' } })).statusCode,
        real,
      ).toBe(204);
      await pool.query(`DELETE FROM push_subscription WHERE endpoint = $1`, [real]);
    }
    expect((await state()).body.devices).toBe(1);
  });

  it('removes a device, and says so when it is not there', async () => {
    const remove = () =>
      app.inject({
        method: 'DELETE',
        url: '/me/push-subscriptions',
        headers: as(),
        payload: { endpoint },
      });
    expect((await remove()).statusCode).toBe(204);
    expect((await state()).body.devices).toBe(0);
    expect((await remove()).statusCode).toBe(404);
  });
});
