import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { OwnProfile, TerritoriesResponse, ViewingTerritoryResponse } from '@fmip/contracts';
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
 * The viewing territory (T-312, blueprint 11): chosen by the member, stored,
 * never inferred. The member registers with a football country (England) and
 * the territory is still `not_chosen` -- the one is not read as the other;
 * a choice is stored and read back with its name; a lower-case code is the
 * same code; a code that is not a territory is refused, not mapped to a
 * neighbour; clearing asks again; a guest is told to sign in; and the list a
 * member chooses from is the whole ISO list, with the United Kingdom in it
 * where no football country of that name exists.
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

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('viewing territory', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  const username = `tr_${RUN}`;
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
        display_name: 'Territory Tester',
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

  it('lists the whole ISO territory list, including a state that is not a football country', async () => {
    const response = await app.inject({ method: 'GET', url: '/territories' });
    expect(response.statusCode).toBe(200);
    const { territories } = response.json<TerritoriesResponse>();
    expect(territories.length).toBe(249);
    expect(territories.find((t) => t.code === 'GB')).toEqual({
      code: 'GB',
      name: 'United Kingdom',
    });
    expect(territories.every((t) => /^[A-Z]{2}$/.test(t.code))).toBe(true);
    // Ordered by name in the database's collation; a page re-sorts for its locale.
    const names = territories.map((t) => t.name);
    expect(names[0]).toBe('Afghanistan');
    expect(names).toEqual(expect.arrayContaining(['Åland Islands', 'Zimbabwe', "Côte d'Ivoire"]));
  });

  it('is not chosen until the member chooses, whatever country they registered with', async () => {
    const guest = await app.inject({ method: 'GET', url: '/me/territory' });
    expect(guest.statusCode).toBe(401);

    const mine = await app.inject({ method: 'GET', url: '/me/territory', headers: { cookie } });
    expect(mine.statusCode).toBe(200);
    expect(mine.json<ViewingTerritoryResponse>().viewing_territory).toEqual({
      state: 'not_chosen',
    });
    const own = await app.inject({ method: 'GET', url: '/me/profile', headers: { cookie } });
    expect(own.json<OwnProfile>().viewing_territory).toEqual({ state: 'not_chosen' });
  });

  it('stores the choice as made, refuses what is not a territory, and clears back to being asked', async () => {
    const chosen = await app.inject({
      method: 'PUT',
      url: '/me/territory',
      headers: { cookie },
      payload: { code: 'gb' },
    });
    expect(chosen.statusCode).toBe(200);
    expect(chosen.json<ViewingTerritoryResponse>().viewing_territory).toEqual({
      state: 'chosen',
      territory: { code: 'GB', name: 'United Kingdom' },
    });
    const again = await app.inject({ method: 'GET', url: '/me/territory', headers: { cookie } });
    expect(again.json<ViewingTerritoryResponse>().viewing_territory).toMatchObject({
      state: 'chosen',
      territory: { code: 'GB' },
    });

    for (const code of ['ZZ', 'GBR', 'G', 7, '']) {
      const refused = await app.inject({
        method: 'PUT',
        url: '/me/territory',
        headers: { cookie },
        payload: { code },
      });
      expect(refused.statusCode, String(code)).toBe(400);
    }
    const missing = await app.inject({
      method: 'PUT',
      url: '/me/territory',
      headers: { cookie },
      payload: {},
    });
    expect(missing.statusCode).toBe(400);
    // A refusal changes nothing.
    const still = await app.inject({ method: 'GET', url: '/me/territory', headers: { cookie } });
    expect(still.json<ViewingTerritoryResponse>().viewing_territory).toMatchObject({
      territory: { code: 'GB' },
    });

    const cleared = await app.inject({
      method: 'PUT',
      url: '/me/territory',
      headers: { cookie },
      payload: { code: null },
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json<ViewingTerritoryResponse>().viewing_territory).toEqual({
      state: 'not_chosen',
    });
  });
});
