import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { FirstRunResponse, OwnProfile } from '@fmip/contracts';
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

/**
 * The first-run flow's two endpoints (T-620). A new member's flow is
 * `pending`; `PUT /me/first-run` ends it once and a second call keeps the
 * first moment; `PATCH /me/preferences` changes the language and time zone
 * registration stored, validates them as registration does, and leaves an
 * absent field alone. A guest is told to sign in.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const ENGLAND = '00000000-0000-4000-8000-000000000101';
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

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('first run', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  const username = `fr_${RUN}`;
  let cookie = '';

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

    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        username,
        display_name: 'First Runner',
        email: `${username}@example.test`,
        password: 'a perfectly fine passphrase',
        country_id: ENGLAND,
        preferred_language: 'en',
        timezone: 'UTC',
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

  it('asks a guest to sign in', async () => {
    for (const [method, url] of [
      ['GET', '/me/first-run'],
      ['PUT', '/me/first-run'],
      ['PATCH', '/me/preferences'],
    ] as const) {
      const response = await app.inject({ method, url, payload: {} });
      expect(response.statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it('is pending for a new member, on its own and on the own profile', async () => {
    const mine = await app.inject({ method: 'GET', url: '/me/first-run', headers: { cookie } });
    expect(mine.statusCode).toBe(200);
    expect(mine.json<FirstRunResponse>().first_run).toEqual({ state: 'pending' });
    const own = await app.inject({ method: 'GET', url: '/me/profile', headers: { cookie } });
    expect(own.json<OwnProfile>().first_run).toEqual({ state: 'pending' });
  });

  it('changes the time zone and language, refuses what registration would, and leaves the rest', async () => {
    const zone = await app.inject({
      method: 'PATCH',
      url: '/me/preferences',
      headers: { cookie },
      payload: { timezone: 'Asia/Tehran' },
    });
    expect(zone.statusCode).toBe(200);
    expect(zone.json<OwnProfile>().account).toMatchObject({
      timezone: 'Asia/Tehran',
      preferred_language: 'en',
    });

    const bad = await app.inject({
      method: 'PATCH',
      url: '/me/preferences',
      headers: { cookie },
      payload: { timezone: 'Mars/Olympus', preferred_language: 'not a tag' },
    });
    expect(bad.statusCode).toBe(400);
    expect(Object.keys(bad.json<{ fields: Record<string, string> }>().fields).sort()).toEqual([
      'preferred_language',
      'timezone',
    ]);

    const language = await app.inject({
      method: 'PATCH',
      url: '/me/preferences',
      headers: { cookie },
      payload: { preferred_language: 'ar' },
    });
    expect(language.json<OwnProfile>().account).toMatchObject({
      timezone: 'Asia/Tehran',
      preferred_language: 'ar',
    });
  });

  it('keeps the theme on the account (T-602): system until chosen, then the choice', async () => {
    const before = await app.inject({ method: 'GET', url: '/me/profile', headers: { cookie } });
    expect(before.json<OwnProfile>().theme).toBe('system');

    const dark = await app.inject({
      method: 'PATCH',
      url: '/me/preferences',
      headers: { cookie },
      payload: { theme: 'dark' },
    });
    expect(dark.statusCode).toBe(200);
    expect(dark.json<OwnProfile>().theme).toBe('dark');

    const bad = await app.inject({
      method: 'PATCH',
      url: '/me/preferences',
      headers: { cookie },
      payload: { theme: 'sepia' },
    });
    expect(bad.statusCode).toBe(400);
    expect(Object.keys(bad.json<{ fields: Record<string, string> }>().fields)).toEqual(['theme']);

    // Another preference leaves the theme alone.
    const zone = await app.inject({
      method: 'PATCH',
      url: '/me/preferences',
      headers: { cookie },
      payload: { timezone: 'UTC' },
    });
    expect(zone.json<OwnProfile>().theme).toBe('dark');
  });

  it('keeps text size, contrast and motion on the account (T-621)', async () => {
    const before = (
      await app.inject({ method: 'GET', url: '/me/profile', headers: { cookie } })
    ).json<OwnProfile>();
    expect([before.text_size, before.contrast, before.motion]).toEqual([
      'default',
      'system',
      'system',
    ]);

    const chosen = await app.inject({
      method: 'PATCH',
      url: '/me/preferences',
      headers: { cookie },
      payload: { text_size: 'larger', contrast: 'more', motion: 'reduce' },
    });
    expect(chosen.statusCode).toBe(200);
    const after = chosen.json<OwnProfile>();
    expect([after.text_size, after.contrast, after.motion]).toEqual(['larger', 'more', 'reduce']);

    const bad = await app.inject({
      method: 'PATCH',
      url: '/me/preferences',
      headers: { cookie },
      payload: { text_size: 'huge', contrast: 'standard' },
    });
    expect(bad.statusCode).toBe(400);
    expect(Object.keys(bad.json<{ fields: Record<string, string> }>().fields)).toEqual([
      'text_size',
    ]);

    // One preference leaves the others alone, the refused one included.
    const one = await app.inject({
      method: 'PATCH',
      url: '/me/preferences',
      headers: { cookie },
      payload: { contrast: 'standard' },
    });
    const kept = one.json<OwnProfile>();
    expect([kept.text_size, kept.contrast, kept.motion]).toEqual(['larger', 'standard', 'reduce']);
  });

  it('ends once, and a second end keeps the first moment', async () => {
    const first = await app.inject({ method: 'PUT', url: '/me/first-run', headers: { cookie } });
    expect(first.statusCode).toBe(200);
    const done = first.json<FirstRunResponse>().first_run;
    expect(done.state).toBe('done');

    const again = await app.inject({ method: 'PUT', url: '/me/first-run', headers: { cookie } });
    expect(again.json<FirstRunResponse>().first_run).toEqual(done);
    const own = await app.inject({ method: 'GET', url: '/me/profile', headers: { cookie } });
    expect(own.json<OwnProfile>().first_run).toEqual(done);
  });
});
