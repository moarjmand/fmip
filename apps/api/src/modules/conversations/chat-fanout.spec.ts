import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { CHAT_SOCKET_PATH, type ChatServerFrame } from '@fmip/contracts';
import { Pool } from 'pg';
import { WebSocket } from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { IdentityModule } from '../identity/identity.module';
import {
  DEFAULT_IDENTITY_OPTIONS,
  IDENTITY_OPTIONS,
  type IdentityOptions,
} from '../identity/identity.service';
import { CaptureMailer, MAILER } from '../identity/internal/mailer';
import { SocialModule } from '../social/social.module';
import {
  CHAT_GATEWAY_OPTIONS,
  type ChatGatewayOptions,
  DEFAULT_CHAT_GATEWAY_OPTIONS,
} from './chat.gateway';
import { ConversationsModule } from './conversations.module';
import { AbsentChatBus, CHAT_BUS, type ChatBus } from './internal/chat-bus';

/**
 * The acceptance criterion for T-231: **a message sent through one instance
 * reaches a socket held by another.**
 *
 * So the suite runs two complete API instances against one Postgres and one
 * Redis, which is what production is. A single-instance test would pass with an
 * in-process fan-out and prove nothing — that is exactly the failure this task
 * exists to make impossible, and it cannot be caught by a test that never has a
 * second instance.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const REDIS_URL = process.env.REDIS_URL;
const ENGLAND = '00000000-0000-4000-8000-000000000101';
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const WEB_ORIGIN = 'http://web.test';

const identityOptions: IdentityOptions = {
  ...DEFAULT_IDENTITY_OPTIONS,
  sessionSecret: 'test-secret-'.repeat(4),
  webBaseUrl: WEB_ORIGIN,
  cookieSecure: false,
};

const gatewayOptions: ChatGatewayOptions = {
  ...DEFAULT_CHAT_GATEWAY_OPTIONS,
  allowedOrigins: [WEB_ORIGIN],
};

function cookieValue(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return /^fmip_session=([^;]*)/.exec(header ?? '')?.[1] ?? '';
}

describe('the absent bus', () => {
  it('says it is not healthy rather than swallowing a broadcast quietly', async () => {
    const bus: ChatBus = new AbsentChatBus();
    expect(bus.healthy).toBe(false);
    // It must not throw: a send is already stored and answered for, and a
    // missing transport is not a reason to fail it.
    await expect(
      bus.publish({ conversation_id: 'x', event: { kind: 'message', message: null as never } }),
    ).resolves.toBeUndefined();
    await bus.close();
  });
});

const missing = [DATABASE_URL, REDIS_URL].some((value) => value === undefined || value === '');

describe.skipIf(missing)('chat fan-out across instances', () => {
  /** Two whole API instances, the way production has more than one. */
  const instances: NestFastifyApplication[] = [];
  let alpha: NestFastifyApplication;
  let beta: NestFastifyApplication;
  let pool: Pool;
  const sockets: WebSocket[] = [];

  const ada = `cf_${RUN}a`;
  const bo = `cf_${RUN}b`;
  const cookies = new Map<string, string>();
  const ids = new Map<string, string>();
  let room = '';

  const build = async (): Promise<NestFastifyApplication> => {
    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, IdentityModule, ConversationsModule, SocialModule],
    })
      .overrideProvider(MAILER)
      .useValue(new CaptureMailer())
      .overrideProvider(IDENTITY_OPTIONS)
      .useValue(identityOptions)
      .overrideProvider(CHAT_GATEWAY_OPTIONS)
      .useValue(gatewayOptions)
      .compile();
    const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.listen({ port: 0, host: '127.0.0.1' });
    await app.getHttpAdapter().getInstance().ready();
    instances.push(app);
    return app;
  };

  const post = (app: NestFastifyApplication, url: string, payload: unknown, who?: string) =>
    app.inject({
      method: 'POST',
      url,
      payload: payload as Record<string, unknown>,
      headers: who === undefined ? {} : { cookie: `fmip_session=${cookies.get(who) ?? ''}` },
    });

  const register = async (username: string) => {
    const response = await post(alpha, '/auth/register', {
      username,
      display_name: `Member ${username}`,
      email: `${username}@example.test`,
      password: 'a perfectly fine passphrase',
      country_id: ENGLAND,
      preferred_language: 'en',
      timezone: 'Europe/London',
      accept_rules: true,
    });
    expect(response.statusCode).toBe(201);
    cookies.set(username, cookieValue(response.headers['set-cookie']));
    const { rows } = await pool.query<{ id: string }>(
      `UPDATE user_account SET email_verified_at = now() WHERE username = $1 RETURNING id`,
      [username],
    );
    ids.set(username, rows[0]?.id ?? '');
  };

  /** A socket on one particular instance, already subscribed to the room. */
  const listenOn = async (
    app: NestFastifyApplication,
    who: string,
  ): Promise<() => Promise<ChatServerFrame>> => {
    const url = `${(await app.getUrl()).replace('http://', 'ws://')}${CHAT_SOCKET_PATH}`;
    const socket = new WebSocket(url, {
      headers: { cookie: `fmip_session=${cookies.get(who) ?? ''}`, origin: WEB_ORIGIN },
    });
    sockets.push(socket);
    const seen: ChatServerFrame[] = [];
    const waiting: ((frame: ChatServerFrame) => void)[] = [];
    socket.on('message', (data: unknown) => {
      const frame = JSON.parse(String(data)) as ChatServerFrame;
      const settle = waiting.shift();
      if (settle === undefined) seen.push(frame);
      else settle(frame);
    });
    const next = (): Promise<ChatServerFrame> =>
      new Promise((resolve, reject) => {
        const ready = seen.shift();
        if (ready !== undefined) {
          resolve(ready);
          return;
        }
        const timer = setTimeout(() => reject(new Error('no frame arrived')), 4_000);
        waiting.push((frame) => {
          clearTimeout(timer);
          resolve(frame);
        });
      });

    await new Promise<void>((resolve, reject) => {
      socket.on('open', () => resolve());
      socket.on('error', reject);
    });
    expect(await next()).toMatchObject({ type: 'ready' });
    socket.send(JSON.stringify({ type: 'subscribe', conversation_id: room }));
    expect(await next()).toMatchObject({ type: 'subscribed' });
    return next;
  };

  beforeAll(async () => {
    alpha = await build();
    beta = await build();
    pool = new Pool({ connectionString: DATABASE_URL });

    for (const username of [ada, bo]) await register(username);
    expect((await post(alpha, `/me/friend-requests/${bo}`, null, ada)).statusCode).toBe(204);
    expect((await post(alpha, `/me/friend-requests/${ada}/accept`, null, bo)).statusCode).toBe(204);
    const opened = await post(alpha, `/me/conversations/direct/${bo}`, null, ada);
    expect(opened.statusCode).toBe(201);
    room = (opened.json() as { id: string }).id;
  });

  afterAll(async () => {
    for (const socket of sockets) socket.terminate();
    const everyone = [...ids.values()];
    const client = await pool.connect();
    try {
      await client.query(`SET session_replication_role = 'replica'`);
      await client.query(`DELETE FROM message WHERE author_id = ANY($1::uuid[])`, [everyone]);
      await client.query(`DELETE FROM rate_window WHERE user_id = ANY($1::uuid[])`, [everyone]);
    } finally {
      // Restored before the accounts go, or the foreign keys that clean up
      // credentials and sessions are switched off too (see 03-project-map.md).
      await client.query(`SET session_replication_role = 'origin'`);
      client.release();
    }
    await pool.query(`DELETE FROM user_account WHERE username LIKE $1`, [`cf_${RUN}%`]);
    await pool.end();
    for (const app of instances) await app.close();
  });

  it('carries a message written on one instance to a socket held by the other', async () => {
    const onBeta = await listenOn(beta, bo);
    const sent = await post(alpha, `/me/conversations/${room}/messages`, { body: 'across' }, ada);
    expect(sent.statusCode).toBe(201);

    const frame = await onBeta();
    expect(frame).toMatchObject({ type: 'event', conversation_id: room });
    expect((frame as { event: { message: { body: string } } }).event.message.body).toBe('across');
  });

  it('delivers to a socket on the same instance the message was written through', async () => {
    // Not a given: an implementation that published outward and skipped itself
    // would pass the test above and leave every sender's own tab silent.
    const onAlpha = await listenOn(alpha, ada);
    expect(
      (await post(alpha, `/me/conversations/${room}/messages`, { body: 'and at home' }, ada))
        .statusCode,
    ).toBe(201);
    const frame = await onAlpha();
    expect((frame as { event: { message: { body: string } } }).event.message.body).toBe(
      'and at home',
    );
  });

  it('carries the whole message, so the socket needs no second request to render it', async () => {
    const onBeta = await listenOn(beta, bo);
    expect(
      (await post(alpha, `/me/conversations/${room}/messages`, { body: 'hello @' + bo }, ada))
        .statusCode,
    ).toBe(201);
    const frame = (await onBeta()) as {
      event: { message: { author: string; seq: number; mentions: string[]; reactions: unknown[] } };
    };
    expect(frame.event.message.author).toBe(ada);
    expect(frame.event.message.seq).toBeGreaterThan(0);
    expect(frame.event.message.mentions).toContain(bo);
    expect(frame.event.message.reactions).toEqual([]);
  });

  it('has a bus that reports itself healthy', async () => {
    const bus = alpha.get<ChatBus>(CHAT_BUS);
    // Publishing is what opens the lazy connection, and by now both instances
    // have published and received.
    expect(bus.healthy).toBe(true);
    await Promise.resolve();
  });
});
