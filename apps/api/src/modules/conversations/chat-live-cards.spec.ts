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

/**
 * The acceptance criterion for T-232: **a score change updates a shared card
 * without a new message.**
 *
 * Blueprint 8.3 puts it as "match cards shared in chat remain live; the score
 * and status update without replacing the original discussion context". T-222
 * made that true of a *read* — the card is resolved every time the page is
 * built. This suite is about the other half: a reader who is already looking at
 * the conversation sees the score change without asking, and the conversation
 * does not move while they do.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const ENGLAND = '00000000-0000-4000-8000-000000000101';
const LIVERPOOL = '00000000-0000-4000-8000-000000000602';
const ESTEGHLAL = '00000000-0000-4000-8000-000000000605';
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const WEB_ORIGIN = 'http://web.test';

const identityOptions: IdentityOptions = {
  ...DEFAULT_IDENTITY_OPTIONS,
  sessionSecret: 'test-secret-'.repeat(4),
  webBaseUrl: WEB_ORIGIN,
  cookieSecure: false,
};

/** Short enough for a test to wait through, long enough to still collapse. */
const gatewayOptions: ChatGatewayOptions = {
  ...DEFAULT_CHAT_GATEWAY_OPTIONS,
  allowedOrigins: [WEB_ORIGIN],
  cardDebounceMs: 100,
};

function cookieValue(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return /^fmip_session=([^;]*)/.exec(header ?? '')?.[1] ?? '';
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('live match cards', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let socketUrl = '';

  const ada = `cl_${RUN}a`;
  const bo = `cl_${RUN}b`;
  const cookies = new Map<string, string>();
  const ids = new Map<string, string>();
  const sockets: WebSocket[] = [];
  let room = '';
  let competition = '';
  let season = '';
  let fixture = '';
  let sharedMessage = '';

  const post = (url: string, payload: unknown, who?: string) =>
    app.inject({
      method: 'POST',
      url,
      payload: payload as Record<string, unknown>,
      headers: who === undefined ? {} : { cookie: `fmip_session=${cookies.get(who) ?? ''}` },
    });

  const register = async (username: string) => {
    const response = await post('/auth/register', {
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

  /** A socket already subscribed to the room, and a way to take its frames. */
  const watcher = async (
    who: string,
  ): Promise<(timeoutMs?: number) => Promise<ChatServerFrame>> => {
    const socket = new WebSocket(socketUrl, {
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
    const next = (timeoutMs = 4_000): Promise<ChatServerFrame> =>
      new Promise((resolve, reject) => {
        const ready = seen.shift();
        if (ready !== undefined) {
          resolve(ready);
          return;
        }
        const timer = setTimeout(() => reject(new Error('no frame arrived')), timeoutMs);
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
    await app.listen({ port: 0, host: '127.0.0.1' });
    await app.getHttpAdapter().getInstance().ready();
    socketUrl = `${(await app.getUrl()).replace('http://', 'ws://')}${CHAT_SOCKET_PATH}`;
    pool = new Pool({ connectionString: DATABASE_URL });

    for (const username of [ada, bo]) await register(username);
    expect((await post(`/me/friend-requests/${bo}`, null, ada)).statusCode).toBe(204);
    expect((await post(`/me/friend-requests/${ada}/accept`, null, bo)).statusCode).toBe(204);
    const opened = await post(`/me/conversations/direct/${bo}`, null, ada);
    expect(opened.statusCode).toBe(201);
    room = (opened.json() as { id: string }).id;

    // A fixture of this suite's own, so a score can move underneath the card
    // without touching anything another suite is reading.
    const { rows: competitions } = await pool.query<{ id: string }>(
      `INSERT INTO competition (country_id, name, kind, scope, gender)
       VALUES ($1, $2, 'league', 'domestic', 'men') RETURNING id`,
      [ENGLAND, `Live Card League ${RUN}`],
    );
    competition = competitions[0]?.id ?? '';
    const { rows: seasons } = await pool.query<{ id: string }>(
      `INSERT INTO season (competition_id, label, start_date, end_date, is_current)
       VALUES ($1, '2025/26', DATE '2025-08-01', DATE '2026-05-31', false) RETURNING id`,
      [competition],
    );
    season = seasons[0]?.id ?? '';
    const { rows: fixtures } = await pool.query<{ id: string }>(
      `INSERT INTO fixture (season_id, kickoff_at, status)
       VALUES ($1, TIMESTAMPTZ '2099-03-01T15:00:00Z', 'scheduled') RETURNING id`,
      [season],
    );
    fixture = fixtures[0]?.id ?? '';
    for (const [side, team] of [
      ['home', LIVERPOOL],
      ['away', ESTEGHLAL],
    ] as const) {
      await pool.query(
        `INSERT INTO fixture_participant (fixture_id, team_id, side) VALUES ($1, $2, $3)`,
        [fixture, team, side],
      );
    }

    const shared = await post(
      `/me/conversations/${room}/messages`,
      { body: 'this one', card: { kind: 'fixture', id: fixture } },
      ada,
    );
    expect(shared.statusCode).toBe(201);
    sharedMessage = (shared.json() as { message: { id: string } }).message.id;

    // The fixture and its two participants were just written, and every one
    // of those writes raised `fixture_change`, so a card refresh is already
    // scheduled behind the collapse window. Let it go out before any test
    // opens a socket. Without this the first test's first frame is sometimes
    // that refresh -- a card read before its own score write, so `score` is
    // null -- and it asserted on it. Passed here every time and failed on CI,
    // which is what a race against the collapse window looks like; the card
    // was right both times, the test's assumption about which frame was its
    // own was not.
    await new Promise((resolve) => setTimeout(resolve, gatewayOptions.cardDebounceMs * 3));
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
    await pool.query(`DELETE FROM user_account WHERE username LIKE $1`, [`cl_${RUN}%`]);
    if (season !== '') await pool.query(`DELETE FROM fixture WHERE season_id = $1`, [season]);
    if (competition !== '') {
      await pool.query(`DELETE FROM season WHERE competition_id = $1`, [competition]);
      await pool.query(`DELETE FROM competition WHERE id = $1`, [competition]);
    }
    await pool.end();
    await app.close();
  });

  it('sends the card again when the score moves, naming the message it hangs on', async () => {
    const next = await watcher(bo);
    await pool.query(
      `INSERT INTO fixture_score (fixture_id, kind, home, away) VALUES ($1, 'current', 1, 0)`,
      [fixture],
    );

    const frame = (await next()) as {
      type: string;
      conversation_id: string;
      event: { kind: string; message_id: string; card: { score: { home: number; away: number } } };
    };
    expect(frame.type).toBe('event');
    expect(frame.conversation_id).toBe(room);
    expect(frame.event.kind).toBe('card');
    // The message it hangs on, so the client replaces the card in place.
    expect(frame.event.message_id).toBe(sharedMessage);
    expect(frame.event.card.score).toEqual({ home: 1, away: 0 });
  });

  it('does not move the conversation: no message is sent, and none is claimed', async () => {
    const next = await watcher(bo);
    const countBefore = await pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM message WHERE conversation_id = $1`,
      [room],
    );

    await pool.query(`UPDATE fixture SET status = 'live' WHERE id = $1`, [fixture]);
    const frame = (await next()) as { event: { kind: string; card: { status: string } } };
    expect(frame.event.kind).toBe('card');
    expect(frame.event.card.status).toBe('live');

    // Nothing was written, and nothing else was sent down the socket.
    const countAfter = await pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM message WHERE conversation_id = $1`,
      [room],
    );
    expect(countAfter.rows[0]?.n).toBe(countBefore.rows[0]?.n);
    await expect(next(400)).rejects.toThrow(/no frame arrived/);
  });

  it('collapses a burst into one refresh, because a goal is three writes', async () => {
    const next = await watcher(bo);
    // Score, status and minute: what one goal looks like to the database.
    //
    // **In one transaction, and that is the point rather than a convenience.**
    // Postgres delivers `NOTIFY` at commit, so a single transaction is what
    // makes this a burst at all -- three separate commits are three bursts that
    // merely arrive close together, and whether the collapse window outlives
    // them is a race against however fast the database happens to be that day.
    // It is also what ingestion actually does: a goal is one transactional
    // write of a fixture's state, not three unrelated ones.
    const writer = await pool.connect();
    try {
      await writer.query('BEGIN');
      await writer.query(
        `UPDATE fixture_score SET home = 2 WHERE fixture_id = $1 AND kind = 'current'`,
        [fixture],
      );
      await writer.query(`UPDATE fixture SET status = 'live' WHERE id = $1`, [fixture]);
      await writer.query(
        `UPDATE fixture_score SET away = 1 WHERE fixture_id = $1 AND kind = 'current'`,
        [fixture],
      );
      await writer.query('COMMIT');
    } catch (error) {
      await writer.query('ROLLBACK');
      throw error;
    } finally {
      writer.release();
    }

    const frame = (await next()) as { event: { card: { score: { home: number; away: number } } } };
    expect(frame.event.card.score).toEqual({ home: 2, away: 1 });
    // One card, not three.
    await expect(next(500)).rejects.toThrow(/no frame arrived/);
  });

  it('says nothing to a socket that is not subscribed to the conversation', async () => {
    // The same rule the message path follows (T-230): a card is delivery, and
    // delivery is only ever to a participant who asked for it.
    const socket = new WebSocket(socketUrl, {
      headers: { cookie: `fmip_session=${cookies.get(bo) ?? ''}`, origin: WEB_ORIGIN },
    });
    sockets.push(socket);
    const frames: ChatServerFrame[] = [];
    socket.on('message', (data: unknown) => {
      frames.push(JSON.parse(String(data)) as ChatServerFrame);
    });
    await new Promise<void>((resolve, reject) => {
      socket.on('open', () => resolve());
      socket.on('error', reject);
    });

    await pool.query(
      `UPDATE fixture_score SET home = 3 WHERE fixture_id = $1 AND kind = 'current'`,
      [fixture],
    );
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(frames.filter((f) => f.type === 'event')).toEqual([]);
  });

  it('leaves a removed message alone: a tombstone has no card to refresh', async () => {
    const next = await watcher(bo);
    const removed = await app.inject({
      method: 'DELETE',
      url: `/me/conversations/${room}/messages/${sharedMessage}`,
      headers: { cookie: `fmip_session=${cookies.get(ada) ?? ''}` },
    });
    expect(removed.statusCode).toBe(204);

    await pool.query(
      `UPDATE fixture_score SET away = 2 WHERE fixture_id = $1 AND kind = 'current'`,
      [fixture],
    );
    await expect(next(600)).rejects.toThrow(/no frame arrived/);
  });
});
