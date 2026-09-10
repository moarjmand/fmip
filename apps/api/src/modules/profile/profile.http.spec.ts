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

// The acceptance criterion for T-041: public / friends-only / private enforced
// server-side. These tests go through the HTTP surface with real sessions and
// the real schema, so what a viewer receives is exactly what a browser would.
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

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('profiles and privacy', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  const owner = `pr_${RUN}o`;
  const stranger = `pr_${RUN}s`;
  let ownerCookie = '';
  let strangerCookie = '';

  const register = async (username: string) => {
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
    return cookieValue(response.headers['set-cookie']);
  };

  const get = (url: string, cookie?: string) =>
    app.inject({
      method: 'GET',
      url,
      headers: cookie === undefined ? {} : { cookie: `fmip_session=${cookie}` },
    });

  const patch = (url: string, payload: unknown, cookie?: string) =>
    app.inject({
      method: 'PATCH',
      url,
      payload: payload as Record<string, unknown>,
      headers: cookie === undefined ? {} : { cookie: `fmip_session=${cookie}` },
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

    ownerCookie = await register(owner);
    strangerCookie = await register(stranger);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM user_account WHERE username LIKE $1`, [`pr_${RUN}%`]);
    await pool.end();
    await app.close();
  });

  it('a fresh member has an empty, public profile', async () => {
    const anonymous = await get(`/profiles/${owner}`);

    expect(anonymous.statusCode).toBe(200);
    expect(anonymous.json()).toEqual({
      kind: 'visible',
      is_self: false,
      profile: {
        username: owner,
        display_name: `Member ${owner}`,
        bio: null,
        avatar_url: null,
        country_id: ENGLAND,
        member_since: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      },
    });
    expect((await get(`/profiles/${owner}`, ownerCookie)).json().is_self).toBe(true);
    expect((await get(`/profiles/${owner.toUpperCase()}`)).statusCode).toBe(200);
    expect((await get(`/profiles/nobody_${RUN}`)).statusCode).toBe(404);
  });

  it('the owner edits bio, avatar and display name; a stranger sees the result', async () => {
    const updated = await patch(
      '/me/profile',
      { display_name: 'Owner Renamed', bio: '  Reds fan.  ', avatar_url: 'https://img.test/a.png' },
      ownerCookie,
    );

    expect(updated.statusCode).toBe(200);
    expect(updated.json().profile).toMatchObject({
      display_name: 'Owner Renamed',
      bio: 'Reds fan.',
      avatar_url: 'https://img.test/a.png',
    });
    expect(updated.json().account.display_name).toBe('Owner Renamed');
    expect(updated.json().privacy).toEqual({
      profile_visibility: 'public',
      prediction_history_visibility: 'public',
    });

    const seen = await get(`/profiles/${owner}`, strangerCookie);
    expect(seen.json().profile.bio).toBe('Reds fan.');

    const cleared = await patch('/me/profile', { avatar_url: null }, ownerCookie);
    expect(cleared.json().profile).toMatchObject({ bio: 'Reds fan.', avatar_url: null });
  });

  it('rejects edits without a session and invalid edits with named fields', async () => {
    expect((await patch('/me/profile', { bio: 'x' })).statusCode).toBe(401);
    expect((await get('/me/profile')).statusCode).toBe(401);

    const bad = await patch('/me/profile', { avatar_url: 'javascript:alert(1)' }, ownerCookie);
    expect(bad.statusCode).toBe(400);
    expect(bad.json().fields).toEqual({ avatar_url: 'must be an http(s) URL' });

    const empty = await patch('/me/profile', {}, ownerCookie);
    expect(empty.statusCode).toBe(400);
  });

  it('private: the owner sees everything, everyone else sees only the name', async () => {
    const set = await patch('/me/privacy', { profile_visibility: 'private' }, ownerCookie);
    expect(set.statusCode).toBe(200);
    expect(set.json().privacy.profile_visibility).toBe('private');

    const restricted = {
      kind: 'restricted',
      username: owner,
      display_name: 'Owner Renamed',
      visibility: 'private',
    };
    expect((await get(`/profiles/${owner}`)).json()).toEqual(restricted);
    expect((await get(`/profiles/${owner}`, strangerCookie)).json()).toEqual(restricted);

    const self = await get(`/profiles/${owner}`, ownerCookie);
    expect(self.json().kind).toBe('visible');
    expect(self.json().profile.bio).toBe('Reds fan.');
    // Nothing beyond name and username leaves the server for a restricted view.
    expect(JSON.stringify((await get(`/profiles/${owner}`)).json())).not.toContain('Reds fan');
  });

  it('friends-only: with no friendships yet, behaves as private for everyone but the owner', async () => {
    await patch('/me/privacy', { profile_visibility: 'friends' }, ownerCookie);

    const asStranger = await get(`/profiles/${owner}`, strangerCookie);
    expect(asStranger.json()).toEqual({
      kind: 'restricted',
      username: owner,
      display_name: 'Owner Renamed',
      visibility: 'friends',
    });
    expect((await get(`/profiles/${owner}`)).json().visibility).toBe('friends');
    expect((await get(`/profiles/${owner}`, ownerCookie)).json().kind).toBe('visible');
  });

  it('prediction-history visibility is stored independently and rejects unknown levels', async () => {
    const set = await patch(
      '/me/privacy',
      { prediction_history_visibility: 'private' },
      ownerCookie,
    );
    expect(set.json().privacy).toEqual({
      profile_visibility: 'friends',
      prediction_history_visibility: 'private',
    });

    const bad = await patch('/me/privacy', { profile_visibility: 'secret' }, ownerCookie);
    expect(bad.statusCode).toBe(400);
    expect(bad.json().fields.profile_visibility).toMatch(/must be one of/);
  });

  it('back to public: visible to a signed-out viewer again', async () => {
    await patch('/me/privacy', { profile_visibility: 'public' }, ownerCookie);
    expect((await get(`/profiles/${owner}`)).json().kind).toBe('visible');
  });
});
