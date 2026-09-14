import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { CHAT_CLOSE, CHAT_SOCKET_PATH, type ChatServerFrame, type Message } from '@fmip/contracts';
import { Pool } from 'pg';
import { WebSocket } from 'ws';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
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
  ChatGateway,
  type ChatGatewayOptions,
  DEFAULT_CHAT_GATEWAY_OPTIONS,
} from './chat.gateway';
import { ConversationsModule } from './conversations.module';

/**
 * The acceptance criterion for T-230, over a real socket against the real
 * schema: **a socket can only ever carry conversations its member participates
 * in** — at subscribe time, and again at delivery, because membership can end
 * while the connection stays open.
 *
 * The other half of the suite is the handshake. A WebSocket upgrade ignores
 * CORS: any page anywhere can open one and the browser will attach our session
 * cookie to it. The origin test is the one that stops that, so it runs with a
 * *valid* cookie — refusing an unauthenticated stranger proves nothing about it.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const ENGLAND = '00000000-0000-4000-8000-000000000101';
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const WEB_ORIGIN = 'http://web.test';

const identityOptions: IdentityOptions = {
  ...DEFAULT_IDENTITY_OPTIONS,
  sessionSecret: 'test-secret-'.repeat(4),
  webBaseUrl: WEB_ORIGIN,
  cookieSecure: false,
};

/**
 * Tunables the test shortens. The heartbeat is what notices a session that
 * ended, so it runs in milliseconds here; one subscription per socket makes the
 * cap testable without building a third conversation to exceed it.
 */
const gatewayOptions: ChatGatewayOptions = {
  ...DEFAULT_CHAT_GATEWAY_OPTIONS,
  allowedOrigins: [WEB_ORIGIN],
  heartbeatMs: 150,
  maxSubscriptions: 1,
};

function cookieValue(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return /^fmip_session=([^;]*)/.exec(header ?? '')?.[1] ?? '';
}

/** One connected socket, with a way to wait for the frame a test is about. */
interface Client {
  socket: WebSocket;
  send(frame: unknown): void;
  /** The next frame of this type, whether it has already arrived or not. */
  next(type: ChatServerFrame['type'], timeoutMs?: number): Promise<ChatServerFrame>;
  /** Resolves with the close code once the server hangs up. */
  closed(timeoutMs?: number): Promise<number>;
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('chat gateway', () => {
  let app: NestFastifyApplication;
  let gateway: ChatGateway;
  let pool: Pool;
  let socketUrl = '';

  const ada = `cg_${RUN}a`;
  const bo = `cg_${RUN}b`;
  const stranger = `cg_${RUN}s`;
  const cookies = new Map<string, string>();
  const ids = new Map<string, string>();
  const open: Client[] = [];
  let room = '';

  const as = (who?: string) =>
    who === undefined ? {} : { cookie: `fmip_session=${cookies.get(who) ?? ''}` };
  const post = (url: string, payload: unknown, who?: string) =>
    app.inject({
      method: 'POST',
      url,
      payload: payload as Record<string, unknown>,
      headers: as(who),
    });

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
    cookies.set(username, cookieValue(response.headers['set-cookie']));
    const { rows } = await pool.query<{ id: string }>(
      `UPDATE user_account SET email_verified_at = now() WHERE username = $1 RETURNING id`,
      [username],
    );
    ids.set(username, rows[0]?.id ?? '');
  };

  /** Connect, or reject with what the handshake was answered with. */
  const connect = (who?: string, origin: string | undefined = WEB_ORIGIN): Promise<Client> => {
    const headers: Record<string, string> = {};
    if (who !== undefined) headers.cookie = `fmip_session=${cookies.get(who) ?? ''}`;
    if (origin !== undefined) headers.origin = origin;

    const socket = new WebSocket(socketUrl, { headers });
    const seen: ChatServerFrame[] = [];
    const waiting: { type: string; settle: (frame: ChatServerFrame) => void }[] = [];
    // Recorded rather than awaited, so a test that asks after the fact still
    // learns how the server hung up.
    let closedWith: number | null = null;
    const closeWatchers: ((code: number) => void)[] = [];
    socket.on('close', (code: number) => {
      closedWith = code;
      for (const watcher of closeWatchers) watcher(code);
    });

    socket.on('message', (data: unknown) => {
      const frame = JSON.parse(String(data)) as ChatServerFrame;
      const index = waiting.findIndex((entry) => entry.type === frame.type);
      if (index === -1) seen.push(frame);
      else waiting.splice(index, 1)[0]?.settle(frame);
    });

    const client: Client = {
      socket,
      send: (frame) => socket.send(JSON.stringify(frame)),
      next: (type, timeoutMs = 4_000) =>
        new Promise<ChatServerFrame>((resolve, reject) => {
          const index = seen.findIndex((frame) => frame.type === type);
          if (index !== -1) {
            resolve(seen.splice(index, 1)[0] as ChatServerFrame);
            return;
          }
          const timer = setTimeout(() => {
            reject(
              new Error(`no ${type} frame within ${timeoutMs}ms; saw ${JSON.stringify(seen)}`),
            );
          }, timeoutMs);
          waiting.push({
            type,
            settle: (frame) => {
              clearTimeout(timer);
              resolve(frame);
            },
          });
        }),
      closed: (timeoutMs = 4_000) =>
        new Promise<number>((resolve, reject) => {
          if (closedWith !== null) {
            resolve(closedWith);
            return;
          }
          const timer = setTimeout(() => reject(new Error('the socket stayed open')), timeoutMs);
          closeWatchers.push((code) => {
            clearTimeout(timer);
            resolve(code);
          });
        }),
    };

    return new Promise<Client>((resolve, reject) => {
      socket.on('open', () => {
        open.push(client);
        resolve(client);
      });
      socket.on('error', (error: Error) => reject(error));
    });
  };

  /** A message that stands in for whatever T-231 will publish. */
  const anEvent = (body: string): { kind: 'message'; message: Message } => ({
    kind: 'message',
    message: {
      id: '00000000-0000-4000-8000-0000000000ff',
      seq: 1,
      author: ada,
      body,
      reply_to_id: null,
      created_at: new Date().toISOString(),
      removed: null,
      card: null,
      reactions: [],
      mentions: [],
      pinned: false,
    },
  });

  beforeAll(async () => {
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

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    // A real listening server, not `inject`: an upgrade is the one thing a
    // synthetic request cannot stand in for.
    await app.listen({ port: 0, host: '127.0.0.1' });
    await app.getHttpAdapter().getInstance().ready();
    gateway = app.get(ChatGateway);
    socketUrl = `${(await app.getUrl()).replace('http://', 'ws://')}${CHAT_SOCKET_PATH}`;
    pool = new Pool({ connectionString: DATABASE_URL });

    for (const username of [ada, bo, stranger]) await register(username);
    expect((await post(`/me/friend-requests/${bo}`, null, ada)).statusCode).toBe(204);
    expect((await post(`/me/friend-requests/${ada}/accept`, null, bo)).statusCode).toBe(204);
    const opened = await post(`/me/conversations/direct/${bo}`, null, ada);
    expect(opened.statusCode).toBe(201);
    room = (opened.json() as { id: string }).id;
  });

  afterAll(async () => {
    for (const client of open) client.socket.terminate();
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
    await pool.query(`DELETE FROM user_account WHERE username LIKE $1`, [`cg_${RUN}%`]);
    await pool.end();
    await app.close();
  });

  /**
   * Every test hangs up its own sockets, and the gateway is asked to prove it
   * noticed. Without this a `deliver` in one test would reach a socket another
   * test left subscribed, and the counts would measure the suite rather than
   * the behaviour -- which is exactly how the first run of this file failed.
   */
  afterEach(async () => {
    for (const client of open) client.socket.close();
    open.length = 0;
    const deadline = Date.now() + 2_000;
    while (gateway.connectionCount > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(gateway.connectionCount).toBe(0);
  });

  it('refuses a handshake with no session', async () => {
    await expect(connect(undefined)).rejects.toThrow(/401/);
  });

  it('refuses a handshake from an origin it does not serve, cookie and all', async () => {
    // The cross-site socket hijack: a real session, somebody else's page.
    await expect(connect(ada, 'http://evil.test')).rejects.toThrow(/403/);
  });

  it('says who you are on the way in', async () => {
    const client = await connect(ada);
    expect(await client.next('ready')).toMatchObject({ type: 'ready', username: ada });
  });

  it('subscribes a participant and tells it where the conversation has got to', async () => {
    const client = await connect(bo);
    client.send({ type: 'subscribe', conversation_id: room });
    const frame = await client.next('subscribed');
    expect(frame).toMatchObject({ type: 'subscribed', conversation_id: room });
    expect((frame as { latest_seq: number }).latest_seq).toBeGreaterThanOrEqual(0);
  });

  it('will not subscribe somebody who is not in the conversation, and does not say it exists', async () => {
    const client = await connect(stranger);
    client.send({ type: 'subscribe', conversation_id: room });
    expect(await client.next('refused')).toMatchObject({ reason: 'not_found' });
  });

  it('refuses an id that is not one', async () => {
    const client = await connect(ada);
    client.send({ type: 'subscribe', conversation_id: 'the-one-with-bo' });
    expect(await client.next('refused')).toMatchObject({ reason: 'invalid' });
  });

  it('carries an event only to the sockets subscribed to that conversation', async () => {
    const inside = await connect(ada);
    const outside = await connect(stranger);
    inside.send({ type: 'subscribe', conversation_id: room });
    await inside.next('subscribed');
    outside.send({ type: 'subscribe', conversation_id: room });
    await outside.next('refused');

    expect(await gateway.deliver(room, anEvent('only to the room'))).toBe(1);
    expect(await inside.next('event')).toMatchObject({ conversation_id: room });
    await expect(outside.next('event', 300)).rejects.toThrow(/no event frame/);
  });

  it('stops carrying a conversation the moment the member is no longer in it', async () => {
    // The acceptance criterion, in its hard form: the subscription was honest
    // when it was made. Membership ended underneath it.
    const client = await connect(bo);
    client.send({ type: 'subscribe', conversation_id: room });
    await client.next('subscribed');
    expect(await gateway.deliver(room, anEvent('while still inside'))).toBe(1);
    await client.next('event');

    expect((await post(`/me/conversations/${room}/leave`, null, bo)).statusCode).toBe(204);

    expect(await gateway.deliver(room, anEvent('after leaving'))).toBe(0);
    expect(await client.next('dropped')).toMatchObject({
      conversation_id: room,
      reason: 'not_a_participant',
    });
    await expect(client.next('event', 300)).rejects.toThrow(/no event frame/);
  });

  it('will not subscribe somebody who has left, and does not pretend it is gone', async () => {
    // bo left in the test above. The history is still readable over HTTP
    // (T-223), so "no such conversation" would be a lie bo could disprove.
    const client = await connect(bo);
    client.send({ type: 'subscribe', conversation_id: room });
    expect(await client.next('refused')).toMatchObject({ reason: 'not_a_participant' });
  });

  it('unsubscribes on request', async () => {
    const client = await connect(ada);
    client.send({ type: 'subscribe', conversation_id: room });
    await client.next('subscribed');
    client.send({ type: 'unsubscribe', conversation_id: room });
    await client.next('unsubscribed');
    expect(await gateway.deliver(room, anEvent('nobody is listening'))).toBe(0);
  });

  it('answers a frame it does not understand instead of hanging up', async () => {
    const client = await connect(ada);
    await client.next('ready');
    client.socket.send('not json at all');
    expect(await client.next('error')).toMatchObject({ type: 'error' });
    client.send({ type: 'send', body: 'writing is not this surface' });
    expect(await client.next('error')).toMatchObject({ type: 'error' });
    expect(client.socket.readyState).toBe(WebSocket.OPEN);
  });

  it('holds only as many conversations as it is allowed', async () => {
    const client = await connect(ada);
    client.send({ type: 'subscribe', conversation_id: room });
    await client.next('subscribed');
    client.send({ type: 'subscribe', conversation_id: '00000000-0000-4000-8000-0000000000aa' });
    expect(await client.next('refused')).toMatchObject({ reason: 'invalid' });
  });

  it('hangs up on a socket whose session has ended', async () => {
    const client = await connect(stranger);
    await client.next('ready');
    expect((await post('/auth/logout', null, stranger)).statusCode).toBe(204);
    expect(await client.closed()).toBe(CHAT_CLOSE.UNAUTHENTICATED);
  });

  it('answers an upgrade on a path it does not serve rather than leaving it hanging', async () => {
    const elsewhere = socketUrl.replace(CHAT_SOCKET_PATH, '/me/conversations');
    await expect(
      new Promise((resolve, reject) => {
        const socket = new WebSocket(elsewhere, { headers: { origin: WEB_ORIGIN } });
        socket.on('open', () => resolve('opened'));
        socket.on('error', reject);
      }),
    ).rejects.toThrow(/404/);
  });
});
