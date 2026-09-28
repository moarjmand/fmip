import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { ApiError } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { CaptureMailer, MAILER } from '../identity/internal/mailer';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../identity/identity.service';
import {
  AbsentIntelligence,
  type Completion,
  type CompletionRequest,
  type Intelligence,
  LANGUAGE_MODEL,
} from '../intelligence/intelligence.port';
import { ASK_REFUSAL } from './ask.controller';
import { AskModule } from './ask.module';

/**
 * The ceilings on `GET /ask` (T-838): a guest per address, as the web app
 * forwards it in `X-Fmip-Client-IP` (D-093), a member per account. Past a
 * ceiling the answer is 429 with `Retry-After` and a sentence, the model is
 * not called, and the refusal is counted for the day in `rate_refusal`. A
 * guest with no well-formed address is not limited, and neither is a
 * deployment with no model. The ceilings are lowered for the run and put
 * back after, so the test takes a handful of requests, not a hundred.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const ENGLAND = '00000000-0000-4000-8000-000000000101';
const CEILING = 3;

function cookieValue(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return /^fmip_session=([^;]*)/.exec(header ?? '')?.[1] ?? '';
}

/** A documentation address (2001:db8::/32) no other request or run shares. */
function address(): string {
  const part = () => Math.floor(Math.random() * 0x10000).toString(16);
  return `2001:db8:${part()}:${part()}:${part()}::1`;
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('the ceilings on /ask', () => {
  let app: NestFastifyApplication;
  let absent: NestFastifyApplication;
  let pool: Pool;
  let before: Map<string, number>;
  const member = `ak_${RUN}`;
  let session = '';
  const asked: CompletionRequest[] = [];
  const script: Completion = {
    text: '{"names":["Liverpool"],"types":["team"]}',
    model: 'scripted-1',
    stop: 'end_turn',
    input_tokens: 10,
    output_tokens: 5,
  };
  const scripted: Intelligence = {
    model: {
      provider: 'scripted',
      model: 'scripted-1',
      complete: async (request) => {
        asked.push(request);
        return script;
      },
    },
  };

  async function boot(intelligence: Intelligence): Promise<NestFastifyApplication> {
    const moduleRef = await Test.createTestingModule({ imports: [DatabaseModule, AskModule] })
      .overrideProvider(LANGUAGE_MODEL)
      .useValue(intelligence)
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
    const application = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    await application.init();
    await application.getHttpAdapter().getInstance().ready();
    return application;
  }

  const ask = (application: NestFastifyApplication, headers: Record<string, string> = {}) =>
    application.inject({ method: 'GET', url: '/ask?q=Liverpool%20next', headers });

  const refusalsToday = async (action: string): Promise<number> => {
    const { rows } = await pool.query<{ count: number }>(
      `SELECT count FROM rate_refusal WHERE action = $1 AND day = $2::date`,
      [action, new Date().toISOString().slice(0, 10)],
    );
    return rows[0]?.count ?? 0;
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    const { rows } = await pool.query<{ action: string; per_hour: number }>(
      `SELECT action, per_hour FROM rate_limit WHERE action IN ('ask', 'ask_ip')`,
    );
    before = new Map(rows.map((r) => [r.action, r.per_hour]));
    expect([...before.keys()].sort()).toEqual(['ask', 'ask_ip']);
    await pool.query(`UPDATE rate_limit SET per_hour = $1 WHERE action IN ('ask', 'ask_ip')`, [
      CEILING,
    ]);
    app = await boot(scripted);
    absent = await boot(new AbsentIntelligence());
    const registered = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        username: member,
        display_name: `Member ${member}`,
        email: `${member}@example.test`,
        password: 'a perfectly fine passphrase',
        country_id: ENGLAND,
        preferred_language: 'en',
        timezone: 'Europe/London',
        accept_rules: true,
      },
    });
    expect(registered.statusCode).toBe(201);
    session = cookieValue(registered.headers['set-cookie']);
  });

  afterAll(async () => {
    for (const [action, perHour] of before) {
      await pool.query(`UPDATE rate_limit SET per_hour = $2 WHERE action = $1`, [action, perHour]);
    }
    await pool.query(`DELETE FROM user_account WHERE username = $1`, [member]);
    await pool.end();
    await app.close();
    await absent.close();
  });

  it('refuses a guest past the ceiling for their address with 429, Retry-After and a sentence, without calling the model', async () => {
    const ip = address();
    const refusedBefore = await refusalsToday('ask_ip');
    const calls = asked.length;
    for (let i = 0; i < CEILING; i += 1) {
      expect((await ask(app, { 'x-fmip-client-ip': ip })).statusCode).toBe(200);
    }
    expect(asked.length).toBe(calls + CEILING);

    const refused = await ask(app, { 'x-fmip-client-ip': ip });
    expect(refused.statusCode).toBe(429);
    const retryAfter = Number(refused.headers['retry-after']);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(3600);
    const body = refused.json<ApiError>();
    expect(body.error).toBe('rate_limited');
    expect(body.message).toMatch(
      new RegExp(`^${ASK_REFUSAL.address} Try again in \\d+ minutes?\\.$`),
    );
    // The model was never asked for the refused question.
    expect(asked.length).toBe(calls + CEILING);
    expect(await refusalsToday('ask_ip')).toBe(refusedBefore + 1);

    // Another address has its own count.
    expect((await ask(app, { 'x-fmip-client-ip': address() })).statusCode).toBe(200);
  });

  it('does not limit a guest whose address is missing or not an address, rather than put everyone in one bucket', async () => {
    for (let i = 0; i < CEILING + 2; i += 1) {
      expect((await ask(app)).statusCode).toBe(200);
      expect((await ask(app, { 'x-fmip-client-ip': 'not-an-address' })).statusCode).toBe(200);
    }
  });

  it('refuses a member past their own ceiling, whatever address they come from', async () => {
    const refusedBefore = await refusalsToday('ask');
    const cookie = `fmip_session=${session}`;
    for (let i = 0; i < CEILING; i += 1) {
      expect((await ask(app, { cookie, 'x-fmip-client-ip': address() })).statusCode).toBe(200);
    }
    const calls = asked.length;
    const refused = await ask(app, { cookie, 'x-fmip-client-ip': address() });
    expect(refused.statusCode).toBe(429);
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
    expect(refused.json<ApiError>().message).toMatch(new RegExp(`^${ASK_REFUSAL.member} `));
    expect(asked.length).toBe(calls);
    expect(await refusalsToday('ask')).toBe(refusedBefore + 1);

    // Signed out, the same reader is a guest again, counted by address.
    expect((await ask(app, { 'x-fmip-client-ip': address() })).statusCode).toBe(200);
  });

  it('does not limit a deployment with no model: the keyword search costs nothing', async () => {
    const ip = address();
    for (let i = 0; i < CEILING + 2; i += 1) {
      expect((await ask(absent, { 'x-fmip-client-ip': ip })).statusCode).toBe(200);
    }
  });
});
