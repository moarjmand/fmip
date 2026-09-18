import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { DeliveryHealth, NotificationsResponse } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../identity/identity.service';
import { CaptureMailer, MAILER } from '../identity/internal/mailer';
import { NotificationsModule } from '../notifications/notifications.module';

/**
 * A deployment with no provider says so and delivers nothing (T-330):
 * `/health/delivery` reports both channels absent, and the inbox carries the
 * same fact on every page so a member is told rather than left waiting.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const ENGLAND = '00000000-0000-4000-8000-000000000101';
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);

function cookieValue(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return /^fmip_session=([^;]*)/.exec(header ?? '')?.[1] ?? '';
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  'delivery: the honest absence',
  () => {
    let app: NestFastifyApplication;
    let pool: Pool;
    const username = `dl_${RUN}`;
    let cookie = '';

    beforeAll(async () => {
      delete process.env.DELIVERY_EMAIL_PROVIDER;
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
          display_name: 'Delivery Tester',
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
    });

    afterAll(async () => {
      await pool.query(`DELETE FROM user_account WHERE username = $1`, [username]);
      await pool.end();
      await app.close();
    });

    it('reports both channels absent on /health/delivery, as a fact and not a failure', async () => {
      const response = await app.inject({ method: 'GET', url: '/health/delivery' });
      expect(response.statusCode).toBe(200);
      expect(response.json<DeliveryHealth>()).toMatchObject({
        email: { state: 'absent' },
        push: { state: 'absent' },
        in_product_only: true,
      });
    });

    it('tells the inbox the same, on every page', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/me/notifications',
        headers: { cookie },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json<NotificationsResponse>().delivery).toMatchObject({
        email: { state: 'absent' },
        push: { state: 'absent' },
        in_product_only: true,
      });
    });
  },
);
