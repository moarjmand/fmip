import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import {
  CONSOLE_MESSAGE_MAX,
  CONSOLE_SNAPSHOT_SCHEMA,
  type ApiError,
  type ConsoleAuditEntry,
  type ConsoleBoardCard,
  type ConsoleCommand,
  type ConsoleConversation,
  type ConsoleMessage,
  type ConsoleRequestDetail,
  type ConsoleRequestList,
  type ConsoleSnapshot,
  type ConsoleSnapshotResponse,
} from '@fmip/contracts';
import {
  CONSOLE_REQUEST_BODY_MAX,
  CONSOLE_REQUEST_IMAGE_MAX_BYTES,
  CONSOLE_REQUEST_IMAGES_MAX,
} from '@fmip/contracts/console';
import { Pool } from 'pg';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { main as consoleCli, parseConsoleArgs } from '../../cli/agents-console';
import { DatabaseModule } from '../../database/database.module';
import { withTriggersOff } from '../../testing/cleanup';
import { hashToken, newToken } from '../identity/identity.service';
import { CONSOLE_OPTIONS } from './agents-console.controller';
import { AgentsConsoleModule } from './agents-console.module';
import {
  LOCK_AFTER_FAILURES,
  SESSION_IDLE_HOURS,
  SESSION_MAX_DAYS,
  checkSnapshot,
  consoleTokenText,
} from './internal/console-rules';
import { DISABLED_MESSAGE_FAILURE, PostgresConsoleStore } from './internal/console-store';
import { PostgresRequestStore } from './internal/request-store';
import { IMAGE_REFUSALS } from './internal/request-images';

/**
 * The agents console (T-1696, T-1697, D-340): an account opens only from a
 * one-time invitation; a session is the console's own cookie; wrong
 * passwords lock a name; a session ends after 12 hours idle; nothing but
 * signing in answers without a session;
 * the snapshot keeps an open security finding to its title; a command is
 * queued, taken and finished; board changes and sign-ins are audited.
 *
 * Its names start `ac_<run>` and its snapshot is dated 2099, so it is the
 * newest while the spec runs; everything is removed afterwards. The media
 * volume of the requests' pictures (T-1731) is a temporary folder.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const SECRET = 'console-test-secret-'.repeat(3);
const PASSWORD = 'a perfectly fine passphrase';
const GENERATED = '2099-01-01T00:00:00.000Z';

function cookieOf(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return /^fmip_console=([^;]*)/.exec(header ?? '')?.[1] ?? '';
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('agents console', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let store: PostgresConsoleStore;
  let cookie = '';
  let media = '';
  const previousMedia = process.env.MEDIA_DIR;
  const name = `ac_${RUN}`;

  const as = (value: string | null) => (value === null ? {} : { cookie: `fmip_console=${value}` });
  const get = (url: string, who: string | null = cookie) =>
    app.inject({ method: 'GET', url: `/console/${url}`, headers: as(who) });
  const send = (
    method: 'POST' | 'PATCH' | 'DELETE',
    url: string,
    payload?: unknown,
    who: string | null = cookie,
  ) =>
    app.inject({
      method,
      url: `/console/${url}`,
      headers: as(who),
      payload: payload as Record<string, unknown>,
    });

  async function invite(display: string): Promise<string> {
    const token = newToken();
    await store.createInvitation(
      hashToken(consoleTokenText(token), SECRET),
      display,
      new Date(Date.now() + 3_600_000),
    );
    return token;
  }

  beforeAll(async () => {
    media = await mkdtemp(join(tmpdir(), 'fmip-console-'));
    process.env.MEDIA_DIR = media;
    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, AgentsConsoleModule],
    })
      .overrideProvider(CONSOLE_OPTIONS)
      .useValue({ secret: SECRET, cookieSecure: false })
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    pool = new Pool({ connectionString: DATABASE_URL });
    store = app.get(PostgresConsoleStore);
  });

  afterAll(async () => {
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM console_user WHERE username LIKE $1`,
      [`ac_${RUN}%`],
    );
    const ids = rows.map((r) => r.id);
    await pool.query(
      `DELETE FROM console_message WHERE reply_to IN
         (SELECT id FROM console_message WHERE author_id = ANY($1::uuid[]))`,
      [ids],
    );
    await pool.query(`DELETE FROM console_message WHERE author_id = ANY($1::uuid[])`, [ids]);
    await pool.query(`DELETE FROM console_command WHERE requested_by = ANY($1::uuid[])`, [ids]);
    await pool.query(`DELETE FROM console_board_card WHERE created_by = ANY($1::uuid[])`, [ids]);
    await pool.query(`DELETE FROM console_snapshot WHERE generated_at = $1`, [GENERATED]);
    await withTriggersOff(pool, async (client) => {
      // Replica mode runs no cascade, so the pictures go first (T-1731).
      await client.query(
        `DELETE FROM console_request_image WHERE request_id IN
           (SELECT id FROM console_request WHERE created_by = ANY($1::uuid[]))`,
        [ids],
      );
      // The request history is immutable like the audit (T-1728).
      await client.query(
        `DELETE FROM console_request_event WHERE request_id IN
           (SELECT id FROM console_request WHERE created_by = ANY($1::uuid[]))`,
        [ids],
      );
      await client.query(`DELETE FROM console_request WHERE created_by = ANY($1::uuid[])`, [ids]);
      await client.query(
        `DELETE FROM console_audit WHERE actor_id = ANY($1::uuid[]) OR actor_name LIKE $2`,
        [ids, `ac_${RUN}%`],
      );
      // An invitation's own audit row has the server as its actor (T-1880).
      await client.query(
        `DELETE FROM console_audit WHERE action = 'console.invitation_created' AND target_id IN
           (SELECT id::text FROM console_invite WHERE used_by = ANY($1::uuid[]) OR display_name LIKE $2)`,
        [ids, `AC ${RUN}%`],
      );
    });
    await pool.query(
      `DELETE FROM console_invite WHERE used_by = ANY($1::uuid[]) OR display_name LIKE $2`,
      [ids, `AC ${RUN}%`],
    );
    await pool.query(`DELETE FROM console_user WHERE id = ANY($1::uuid[])`, [ids]);
    await pool.end();
    await app.close();
    await rm(media, { recursive: true, force: true });
    if (previousMedia === undefined) delete process.env.MEDIA_DIR;
    else process.env.MEDIA_DIR = previousMedia;
  });

  it('opens an account once from an invitation, and only then', async () => {
    const token = await invite(`AC ${RUN} maintainer`);
    expect((await get(`invitations/${token}`, null)).json()).toMatchObject({
      display_name: `AC ${RUN} maintainer`,
    });

    const short = await send(
      'POST',
      'invitations/accept',
      { token, username: name, password: 'short' },
      null,
    );
    expect(short.statusCode).toBe(400);

    const accepted = await send(
      'POST',
      'invitations/accept',
      { token, username: name, password: PASSWORD },
      null,
    );
    expect(accepted.statusCode).toBe(204);
    const setCookie = String(accepted.headers['set-cookie']);
    expect(setCookie).toContain('SameSite=Strict');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).not.toContain('Domain');
    cookie = cookieOf(accepted.headers['set-cookie']);
    expect((await get('me')).json()).toMatchObject({
      username: name,
      display_name: `AC ${RUN} maintainer`,
    });

    expect((await get(`invitations/${token}`, null)).statusCode).toBe(404);
    const again = await send(
      'POST',
      'invitations/accept',
      { token, username: `${name}x`, password: PASSWORD },
      null,
    );
    expect(again.statusCode).toBe(404);
  });

  it('answers nothing but signing in without a session', async () => {
    for (const url of ['me', 'snapshot', 'commands', 'board', 'audit']) {
      expect((await get(url, null)).statusCode).toBe(401);
      expect((await get(url, 'not-a-token')).statusCode).toBe(401);
    }
    expect(
      (await send('POST', 'commands', { kind: 'agent.run', target: 'x', reason: 'r' }, null))
        .statusCode,
    ).toBe(401);
    expect((await send('POST', 'board', { title: 't', column: 'next' }, null)).statusCode).toBe(
      401,
    );
  });

  it('signs out, and a wrong password locks the name', async () => {
    expect((await send('DELETE', 'session')).statusCode).toBe(204);
    expect((await get('me')).statusCode).toBe(401);

    for (let i = 0; i < LOCK_AFTER_FAILURES; i += 1) {
      expect(
        (await send('POST', 'session', { username: name, password: 'wrong password!' }, null))
          .statusCode,
      ).toBe(401);
    }
    const locked = await send('POST', 'session', { username: name, password: PASSWORD }, null);
    expect(locked.statusCode).toBe(401);

    await pool.query(`UPDATE console_user SET locked_until = NULL WHERE username = $1`, [name]);
    const signedIn = await send(
      'POST',
      'session',
      { username: name.toUpperCase(), password: PASSWORD },
      null,
    );
    expect(signedIn.statusCode).toBe(204);
    cookie = cookieOf(signedIn.headers['set-cookie']);
    expect((await get('me')).statusCode).toBe(200);

    const unknown = await send(
      'POST',
      'session',
      { username: `${name}nobody`, password: PASSWORD },
      null,
    );
    expect(unknown.statusCode).toBe(401);
  });

  it('ends a session left idle for 12 hours; each use restarts its clock', async () => {
    const signedIn = await send('POST', 'session', { username: name, password: PASSWORD }, null);
    expect(signedIn.statusCode).toBe(204);
    const idle = cookieOf(signedIn.headers['set-cookie']);
    const tokenHash = hashToken(consoleTokenText(idle), SECRET);
    /** Hours from now to the session's end, and from its last use to its end. */
    const clock = async () => {
      const { rows } = await pool.query<{ left: number; window: number }>(
        `SELECT extract(epoch FROM expires_at - now()) / 3600 AS left,
                extract(epoch FROM expires_at - last_seen_at) / 3600 AS window
           FROM console_session WHERE token_hash = $1`,
        [tokenHash],
      );
      return { left: Number(rows[0]?.left), window: Number(rows[0]?.window) };
    };
    /** As if the session was last used `hours` ago (the clock moved, not the rows' rule). */
    const idleFor = (hours: string) =>
      pool.query(
        `UPDATE console_session
            SET last_seen_at = now() - $2::interval,
                expires_at = now() - $2::interval + make_interval(hours => $3)
          WHERE token_hash = $1`,
        [tokenHash, hours, SESSION_IDLE_HOURS],
      );

    expect(SESSION_IDLE_HOURS).toBe(12);
    expect((await clock()).window).toBeCloseTo(SESSION_IDLE_HOURS, 3);

    // Idle a minute short of 12 hours: still open, and the use restarts the clock.
    await idleFor('11 hours 59 minutes');
    expect((await clock()).left).toBeLessThan(0.02);
    expect((await get('me', idle)).statusCode).toBe(200);
    expect((await clock()).left).toBeGreaterThan(SESSION_IDLE_HOURS - 0.01);

    // Idle for 12 hours and a second: the session is over, everywhere.
    await idleFor('12 hours 1 second');
    for (const url of ['me', 'snapshot', 'commands', 'board', 'audit']) {
      expect((await get(url, idle)).statusCode).toBe(401);
    }
    expect((await send('POST', 'board', { title: 't', column: 'next' }, idle)).statusCode).toBe(
      401,
    );
    // A refused use does not reopen it.
    expect((await clock()).left).toBeLessThan(0);
    // Another session of the same person is not touched.
    expect((await get('me')).statusCode).toBe(200);
  });

  it('ends a session 7 days after it was opened, however much it is used (T-1880)', async () => {
    const signedIn = await send('POST', 'session', { username: name, password: PASSWORD }, null);
    const old = cookieOf(signedIn.headers['set-cookie']);
    const tokenHash = hashToken(consoleTokenText(old), SECRET);
    /** As if the session was opened `age` ago and has been in use ever since. */
    const openedAgo = (age: string) =>
      pool.query(
        `UPDATE console_session
            SET created_at = now() - $2::interval, last_seen_at = now(),
                expires_at = now() + make_interval(hours => $3)
          WHERE token_hash = $1`,
        [tokenHash, age, SESSION_IDLE_HOURS],
      );
    const hoursLeft = async () => {
      const { rows } = await pool.query<{ left: number }>(
        `SELECT extract(epoch FROM expires_at - now()) / 3600 AS left
           FROM console_session WHERE token_hash = $1`,
        [tokenHash],
      );
      return Number(rows[0]?.left);
    };

    expect(SESSION_MAX_DAYS).toBe(7);
    // Opened an hour short of seven days ago and used all along: still open,
    // and a use no longer buys twelve more hours, only what is left of the seven days.
    await openedAgo('167 hours');
    expect((await get('me', old)).statusCode).toBe(200);
    const left = await hoursLeft();
    expect(left).toBeGreaterThan(0.9);
    expect(left).toBeLessThan(1.01);

    // Seven days and a second: over, everywhere, whatever its idle clock says.
    await openedAgo('168 hours 1 second');
    expect(await hoursLeft()).toBeGreaterThan(SESSION_IDLE_HOURS - 0.01);
    for (const url of ['me', 'snapshot', 'commands', 'board', 'audit']) {
      expect((await get(url, old)).statusCode).toBe(401);
    }
    expect((await send('POST', 'board', { title: 't', column: 'next' }, old)).statusCode).toBe(401);
    // The person signs in again; another session of theirs is not touched.
    expect((await get('me')).statusCode).toBe(200);
    const again = await send('POST', 'session', { username: name, password: PASSWORD }, null);
    expect((await get('me', cookieOf(again.headers['set-cookie']))).statusCode).toBe(200);
  });

  it('shows the newest snapshot with an open security finding kept to its title', async () => {
    const raw: ConsoleSnapshot = {
      schema: CONSOLE_SNAPSHOT_SCHEMA,
      generated_at: GENERATED,
      agents: [
        {
          name: 'data-auditor',
          description: 'Audits the data',
          model: 'sonnet',
          tools: ['Read'],
          access: [],
          skills: [],
          schedule: 'daily',
          paused: false,
          workflow: { inputs: [], steps: [], outputs: [] },
          memory: { sources: [], entries: [] },
          runs: [],
        },
      ],
      findings: [
        {
          id: 'sec-9',
          agent: 'security',
          severity: 'major',
          status: 'open',
          title: 'Open',
          opened_at: GENERATED,
          detail: 'exploit',
          related: null,
        },
      ],
      reports: [],
      brief: { date: '2099-01-01', text: 'All quiet.' },
      decisions: [
        {
          id: `d-${RUN}`,
          title: 'A question',
          status: 'open',
          summary: 's',
          options: [{ key: 'a', label: 'A' }],
          answer: null,
          decided_by: null,
          decided_at: null,
        },
      ],
    };
    const checked = checkSnapshot(raw);
    if (!checked.ok) throw new Error(checked.reason);
    await store.loadSnapshot(checked.snapshot);

    const body = (await get('snapshot')).json<ConsoleSnapshotResponse>();
    expect(body.snapshot?.generated_at).toBe(GENERATED);
    expect(body.snapshot?.findings[0]).toMatchObject({ title: 'Open', detail: null });
    expect(body.snapshot?.brief?.text).toBe('All quiet.');
  });

  it('queues a command, which the computer takes and finishes', async () => {
    const refused = await send('POST', 'commands', {
      kind: 'agent.pause',
      target: 'nobody',
      reason: 'r',
    });
    expect(refused.statusCode).toBe(400);

    const queued = await send('POST', 'commands', {
      kind: 'agent.pause',
      target: 'data-auditor',
      reason: 'too noisy',
    });
    expect(queued.statusCode).toBe(201);
    const command = queued.json<ConsoleCommand>();
    expect(command).toMatchObject({ status: 'queued', requested_by: `AC ${RUN} maintainer` });

    const answer = await send('POST', 'commands', {
      kind: 'decision.answer',
      target: `d-${RUN}`,
      payload: { answer: 'a' },
      reason: 'chosen',
    });
    expect(answer.statusCode).toBe(201);

    const taken = await store.takeCommands();
    expect(taken.map((c) => c.id)).toContain(command.id);
    expect(await store.finishCommand(command.id, 'done', 'paused in the daily run')).toBe(true);
    expect(await store.finishCommand(command.id, 'done', 'twice')).toBe(false);

    const listed = (await get('commands')).json<{ commands: ConsoleCommand[] }>().commands;
    expect(listed.find((c) => c.id === command.id)).toMatchObject({
      status: 'done',
      outcome: 'paused in the daily run',
    });
  });

  it('holds commands to two hourly ceilings, and an agent to one waiting run (T-1880)', async () => {
    const run = { kind: 'agent.run', target: 'data-auditor', reason: 'now' };
    const pause = { kind: 'agent.pause', target: 'data-auditor', reason: 'quiet' };
    const { rows: limits } = await pool.query<{ action: string; per_hour: number }>(
      `SELECT action, per_hour FROM rate_limit WHERE action LIKE 'console_command%' ORDER BY action`,
    );
    expect(limits).toEqual([
      { action: 'console_command', per_hour: 40 },
      { action: 'console_command_run', per_hour: 10 },
    ]);

    // What a command carries is a choice and a short note.
    const long = await send('POST', 'commands', { ...pause, payload: { note: 'x'.repeat(501) } });
    expect(long.statusCode).toBe(400);
    expect(long.json<ApiError>().error).toBe('validation');

    // Nothing of an earlier test is left waiting.
    await store.takeCommands();
    expect((await send('POST', 'commands', run)).statusCode).toBe(201);
    // The computer starts every queued run in one go: no second one for the same agent.
    const twice = await send('POST', 'commands', run);
    expect(twice.statusCode).toBe(409);
    expect(twice.json<ApiError>()).toEqual({
      error: 'conflict',
      message: 'This agent already has a run waiting.',
    });
    // Once the computer has taken it, another may be asked.
    await store.takeCommands();

    const mine = async () => {
      const { rows } = await pool.query<{ used: number; runs: number }>(
        `SELECT count(*)::int AS used, (count(*) FILTER (WHERE c.kind = 'agent.run'))::int AS runs
           FROM console_command c JOIN console_user u ON u.id = c.requested_by
          WHERE u.username = $1`,
        [name],
      );
      return rows[0]!;
    };
    try {
      // One run an hour: this person has asked one this hour, whatever the clock.
      await pool.query(`UPDATE rate_limit SET per_hour = 1 WHERE action = 'console_command_run'`);
      await send('POST', 'commands', run);
      await store.takeCommands();
      const before = await mine();
      const refused = await send('POST', 'commands', run);
      expect(refused.statusCode).toBe(429);
      expect(refused.json<ApiError>().error).toBe('rate_limited');
      expect(refused.json<ApiError>().message).toMatch(
        /^That is the most immediate runs an hour allows\. Try again in \d+ minutes?\.$/,
      );
      expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
      // Another kind of command is not a run.
      expect((await send('POST', 'commands', pause)).statusCode).toBe(201);

      // One command an hour, of any kind.
      await pool.query(`UPDATE rate_limit SET per_hour = 1 WHERE action = 'console_command'`);
      const over = await send('POST', 'commands', pause);
      expect(over.statusCode).toBe(429);
      expect(over.json<ApiError>().message).toMatch(/^That is the most commands an hour allows\./);
      expect(Number(over.headers['retry-after'])).toBeGreaterThan(0);
      // A refused command is not queued.
      expect(await mine()).toEqual({ used: before.used + 1, runs: before.runs });
      const { rows: refusals } = await pool.query<{ action: string }>(
        `SELECT action FROM rate_refusal
          WHERE action LIKE 'console_command%' AND day = $1::date AND count > 0 ORDER BY action`,
        [new Date().toISOString().slice(0, 10)],
      );
      expect(refusals.map((r) => r.action)).toEqual(['console_command', 'console_command_run']);
    } finally {
      await pool.query(`UPDATE rate_limit SET per_hour = 40 WHERE action = 'console_command'`);
      await pool.query(`UPDATE rate_limit SET per_hour = 10 WHERE action = 'console_command_run'`);
      await store.takeCommands();
    }
  });

  describe('chat with an agent (T-1722, D-350)', () => {
    const agent = 'data-auditor';
    const messages = `agents/${agent}/messages`;

    it('needs a session to read or write a conversation', async () => {
      expect((await get(messages, null)).statusCode).toBe(401);
      expect((await get(messages, 'not-a-token')).statusCode).toBe(401);
      expect((await send('POST', messages, { body: 'hello' }, null)).statusCode).toBe(401);
      expect((await send('POST', messages, { body: 'hello' }, 'not-a-token')).statusCode).toBe(401);
    });

    it('refuses an agent the snapshot does not name, no text, and too much text', async () => {
      expect((await send('POST', 'agents/nobody/messages', { body: 'hi' })).statusCode).toBe(400);
      expect((await send('POST', messages, {})).statusCode).toBe(400);
      expect((await send('POST', messages, { body: '   ' })).statusCode).toBe(400);
      const long = await send('POST', messages, { body: 'x'.repeat(CONSOLE_MESSAGE_MAX + 1) });
      expect(long.statusCode).toBe(400);
      expect(long.json<ApiError>().error).toBe('validation');
      expect((await get('agents/Not_A_Name/messages')).statusCode).toBe(404);
      expect((await get(`${messages}?before=nope`)).statusCode).toBe(400);
    });

    it('queues a message, audited, which the computer takes and answers', async () => {
      const posted = await send('POST', messages, { body: `  What did you find today? ${RUN} ` });
      expect(posted.statusCode).toBe(201);
      const message = posted.json<ConsoleMessage>();
      expect(message).toMatchObject({
        agent,
        author_kind: 'person',
        author: `AC ${RUN} maintainer`,
        body: `What did you find today? ${RUN}`,
        status: 'queued',
        reply_to: null,
      });

      const { rows: audit } = await pool.query<{ target_id: string; next: { message_id: string } }>(
        `SELECT target_id, next FROM console_audit WHERE action = 'chat.message_posted' AND next->>'message_id' = $1`,
        [message.id],
      );
      expect(audit).toEqual([
        { target_id: agent, next: { message_id: message.id, characters: message.body.length } },
      ]);

      const taken = await store.takeMessages();
      const item = taken.find((t) => t.message.id === message.id);
      expect(item?.message.status).toBe('answering');
      expect(item?.conversation.at(-1)?.id).toBe(message.id);
      // Taken once: a second pull does not hand it out again.
      expect((await store.takeMessages()).some((t) => t.message.id === message.id)).toBe(false);

      expect(await store.postReply(message.id, 'answered', 'Three findings, all minor.')).toBe(
        true,
      );
      expect(await store.postReply(message.id, 'answered', 'twice')).toBe(false);

      const conversation = (await get(messages)).json<ConsoleConversation>();
      const mine = conversation.messages.filter(
        (m) => m.id === message.id || m.reply_to === message.id,
      );
      expect(mine).toMatchObject([
        { id: message.id, status: 'answered' },
        {
          author_kind: 'agent',
          author: agent,
          body: 'Three findings, all minor.',
          status: null,
          reply_to: message.id,
        },
      ]);
    });

    it('says why a message was not answered, and pages a long conversation', async () => {
      const posted = (
        await send('POST', messages, { body: `Fails ${RUN}` })
      ).json<ConsoleMessage>();
      await store.takeMessages();
      expect(await store.postReply(posted.id, 'failed', '')).toBe(true);
      const after = (await get(messages)).json<ConsoleConversation>();
      expect(after.messages.find((m) => m.id === posted.id)).toMatchObject({
        status: 'failed',
        failure: 'The run did not answer.',
      });

      const page = await store.conversation(agent, null, 2);
      expect(page.messages).toHaveLength(2);
      expect(page.has_older).toBe(true);
      expect(page.messages.at(-1)?.id).toBe(posted.id);
      const older = (
        await get(`${messages}?before=${page.messages[0]!.id}`)
      ).json<ConsoleConversation>();
      expect(older.messages.every((m) => m.created_at <= page.messages[0]!.created_at)).toBe(true);
      expect(older.messages.some((m) => m.id === page.messages[0]!.id)).toBe(false);
    });

    it('holds a person to the hourly ceiling, with Retry-After', async () => {
      const { rows } = await pool.query<{ per_hour: number }>(
        `SELECT per_hour FROM rate_limit WHERE action = 'console_message'`,
      );
      expect(rows[0]?.per_hour).toBe(30);
      try {
        // One an hour: this person has written one this hour after the first post, whatever the clock.
        await pool.query(`UPDATE rate_limit SET per_hour = 1 WHERE action = 'console_message'`);
        await send('POST', messages, { body: `Warm-up ${RUN}` });
        const refused = await send('POST', messages, { body: 'one more' });
        expect(refused.statusCode).toBe(429);
        expect(refused.json<ApiError>().error).toBe('rate_limited');
        expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
        const { rowCount } = await pool.query(
          `SELECT 1 FROM console_message WHERE body = 'one more'`,
        );
        expect(rowCount).toBe(0);
      } finally {
        await pool.query(`UPDATE rate_limit SET per_hour = 30 WHERE action = 'console_message'`);
      }
    });
  });

  describe('teammate requests (T-1728, D-354)', () => {
    let mate = '';
    let requestStore: PostgresRequestStore;

    beforeAll(async () => {
      const token = await invite(`AC ${RUN} teammate`);
      const accepted = await send(
        'POST',
        'invitations/accept',
        { token, username: `${name}_mate`, password: PASSWORD },
        null,
      );
      mate = cookieOf(accepted.headers['set-cookie']);
      requestStore = app.get(PostgresRequestStore);
    });

    it('needs a session for every route', async () => {
      const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
      for (const who of [null, 'not-a-token']) {
        expect((await get('requests', who)).statusCode).toBe(401);
        expect((await get('requests/counts', who)).statusCode).toBe(401);
        expect((await get(`requests/${id}`, who)).statusCode).toBe(401);
        expect((await send('POST', 'requests', { title: 'x' }, who)).statusCode).toBe(401);
        expect((await send('PATCH', `requests/${id}`, { title: 'x' }, who)).statusCode).toBe(401);
        for (const [path, body] of [
          ['status', { action: 'cancel' }],
          ['execute', { execute: true }],
          ['decision', { choice: 'approve' }],
        ] as const)
          expect((await send('POST', `requests/${id}/${path}`, body, who)).statusCode).toBe(401);
      }
    });

    it('refuses a request without a title, too long, or of an unknown priority or id', async () => {
      expect((await send('POST', 'requests', {})).statusCode).toBe(400);
      expect((await send('POST', 'requests', { title: '  ' })).statusCode).toBe(400);
      const long = await send('POST', 'requests', {
        title: 't',
        body: 'x'.repeat(CONSOLE_REQUEST_BODY_MAX + 1),
      });
      expect(long.statusCode).toBe(400);
      expect(long.json<ApiError>().error).toBe('validation');
      expect((await send('POST', 'requests', { title: 't', priority: 'now' })).statusCode).toBe(
        400,
      );
      expect((await get('requests/not-an-id')).statusCode).toBe(404);
      expect((await get('requests?status=open')).statusCode).toBe(400);
      expect(
        (await send('PATCH', 'requests/0f8fad5b-d9cb-469f-a165-70867728950e', { title: 'x' }))
          .statusCode,
      ).toBe(404);
    });

    it('records who filed each request, and lists one filer at a time (T-1831)', async () => {
      const mine = (
        await send('POST', 'requests', { title: `${RUN} mine` })
      ).json<ConsoleRequestDetail>();
      const theirs = (
        await send('POST', 'requests', { title: `${RUN} theirs` }, mate)
      ).json<ConsoleRequestDetail>();
      expect(mine.created_by_username).not.toBe(`${name}_mate`);
      expect(theirs).toMatchObject({
        created_by: `AC ${RUN} teammate`,
        created_by_username: `${name}_mate`,
      });
      const filtered = (await get(`requests?by=${name}_mate`)).json<ConsoleRequestList>();
      expect(filtered.requests.length).toBeGreaterThan(0);
      expect(filtered.requests.every((r) => r.created_by_username === `${name}_mate`)).toBe(true);
      expect(filtered.requests.map((r) => r.id)).toContain(theirs.id);
      expect(filtered.requests.map((r) => r.id)).not.toContain(mine.id);
      expect(filtered.counts.all).toBe(filtered.requests.length);
      // The filers are everyone's, whatever the filter.
      const usernames = filtered.filers.map((f) => f.username);
      expect(usernames).toEqual(expect.arrayContaining([`${name}_mate`, mine.created_by_username]));
      expect(filtered.filers.find((f) => f.username === `${name}_mate`)?.display_name).toBe(
        `AC ${RUN} teammate`,
      );
      expect((await get('requests?by=Not%20A%20User')).statusCode).toBe(400);
      expect((await get('requests?by=nobody_here')).json<ConsoleRequestList>().requests).toEqual(
        [],
      );
      for (const id of [mine.id, theirs.id])
        expect((await send('POST', `requests/${id}/status`, { action: 'cancel' })).statusCode).toBe(
          200,
        );
    });

    it('keeps a request from new to done, with its history and audit', async () => {
      const created = await send('POST', 'requests', {
        title: `  Fix the table ${RUN} `,
        body: 'line one\r\nline two',
        priority: 'high',
      });
      expect(created.statusCode).toBe(201);
      const request = created.json<ConsoleRequestDetail>();
      expect(request).toMatchObject({
        title: `Fix the table ${RUN}`,
        body: 'line one\nline two',
        priority: 'high',
        status: 'new',
        created_by: `AC ${RUN} maintainer`,
        result: null,
        execute_requested_at: null,
      });
      expect(request.events).toMatchObject([
        { kind: 'created', actor_kind: 'person', from_status: null, to_status: 'new' },
      ]);

      // Any console user edits it: the teammate puts it in his own words.
      const edited = await send('PATCH', `requests/${request.id}`, { body: 'In his words' }, mate);
      expect(edited.json<ConsoleRequestDetail>()).toMatchObject({ body: 'In his words' });

      const marked = await send('POST', `requests/${request.id}/execute`, { execute: true });
      expect(marked.statusCode).toBe(200);
      expect(marked.json<ConsoleRequestDetail>().execute_requested_at).not.toBeNull();

      const started = await requestStore.agentResult(request.id, 'in_progress', 'On it.');
      expect(started).toMatchObject({
        kind: 'ok',
        request: { status: 'in_progress', result: 'On it.', execute_requested_at: null },
      });
      const done = await requestStore.agentResult(request.id, 'done', 'Fixed in #900.');
      expect(done.kind === 'ok' && done.request.result).toBe('Fixed in #900.');

      // Closed: no edit until it is reopened.
      expect((await send('PATCH', `requests/${request.id}`, { title: 'later' })).statusCode).toBe(
        409,
      );
      const reopened = await send('POST', `requests/${request.id}/status`, { action: 'reopen' });
      expect(reopened.json<ConsoleRequestDetail>().status).toBe('new');

      const fetched = (await get(`requests/${request.id}`)).json<ConsoleRequestDetail>();
      expect(fetched.events.map((e) => [e.kind, e.actor_kind, e.to_status])).toEqual([
        ['created', 'person', 'new'],
        ['edited', 'person', 'new'],
        ['execute_requested', 'person', 'new'],
        ['result', 'agent', 'in_progress'],
        ['result', 'agent', 'done'],
        ['reopened', 'person', 'new'],
      ]);
      expect(fetched.events[1]?.actor).toBe(`AC ${RUN} teammate`);
      expect(fetched.events[3]?.actor).toBeNull();

      const { rows: audit } = await pool.query<{ action: string; actor_name: string }>(
        `SELECT action, actor_name FROM console_audit WHERE target_type = 'console_request'
            AND target_id = $1 ORDER BY created_at, action`,
        [request.id],
      );
      expect(audit.map((a) => a.action).sort()).toEqual(
        [
          'request.created',
          'request.edited',
          'request.execute_requested',
          'request.result',
          'request.result',
          'request.reopened',
        ].sort(),
      );
      expect(audit.find((a) => a.action === 'request.result')?.actor_name).toBe('agent');
      // The history cannot be rewritten.
      await expect(
        pool.query(`DELETE FROM console_request_event WHERE request_id = $1`, [request.id]),
      ).rejects.toThrow();
    });

    it('takes the run mark off a request whose text changes after it was marked (T-1880)', async () => {
      const request = (
        await send('POST', 'requests', { title: `Marked ${RUN}`, body: 'Do this.' })
      ).json<ConsoleRequestDetail>();
      const mark = async (): Promise<string> => {
        const marked = await send('POST', `requests/${request.id}/execute`, { execute: true });
        expect(marked.statusCode).toBe(200);
        const at = marked.json<ConsoleRequestDetail>().execute_requested_at;
        expect(at).not.toBeNull();
        return at!;
      };
      const edit = async (change: Record<string, string>) => {
        const edited = await send('PATCH', `requests/${request.id}`, change, mate);
        expect(edited.statusCode).toBe(200);
        return edited.json<ConsoleRequestDetail>();
      };
      const markedAt = await mark();

      // The priority is not what runs, and the same words again change nothing.
      expect((await edit({ priority: 'high' })).execute_requested_at).toBe(markedAt);
      expect((await edit({ title: `Marked ${RUN}`, body: 'Do this.' })).execute_requested_at).toBe(
        markedAt,
      );

      // The teammate rewrites what was marked: it is read and marked again before it runs.
      expect(await edit({ body: 'Do something else.' })).toMatchObject({
        body: 'Do something else.',
        execute_requested_at: null,
      });
      expect((await requestStore.get(request.id))?.execute_requested_at).toBeNull();
      const cleared = () =>
        pool.query<{ actor_name: string; previous: unknown; next: unknown }>(
          `SELECT actor_name, previous, next FROM console_audit
            WHERE action = 'request.edited' AND target_id = $1 AND next ? 'execute'
            ORDER BY created_at`,
          [request.id],
        );
      expect((await cleared()).rows).toEqual([
        {
          actor_name: `${name}_mate`,
          previous: {
            title: `Marked ${RUN}`,
            body: 'Do this.',
            priority: 'high',
            execute_requested_at: markedAt,
          },
          next: { body: 'Do something else.', execute: false },
        },
      ]);

      // The title is what runs too; an edit of an unmarked request says nothing of a mark.
      const again = await mark();
      expect((await edit({ title: `Marked ${RUN}, reworded` })).execute_requested_at).toBeNull();
      await edit({ body: 'Unmarked, changed once more.' });
      const { rows } = await cleared();
      expect(rows).toHaveLength(2);
      expect(rows[1]).toMatchObject({
        previous: { execute_requested_at: again },
        next: { title: `Marked ${RUN}, reworded`, execute: false },
      });
    });

    it('puts a question to the teammate, who decides it; a decided request can be run', async () => {
      const request = (
        await send('POST', 'requests', { title: `Question ${RUN}` })
      ).json<ConsoleRequestDetail>();
      expect(
        (await send('POST', `requests/${request.id}/decision`, { choice: 'approve' })).statusCode,
      ).toBe(409);

      const asked = await requestStore.agentAsk(request.id, 'Both cups, or the league only?');
      expect(asked).toMatchObject({
        kind: 'ok',
        request: {
          status: 'waiting_decision',
          decision_question: 'Both cups, or the league only?',
        },
      });
      // Not marked to run while the question is open.
      expect(
        (await send('POST', `requests/${request.id}/execute`, { execute: true })).statusCode,
      ).toBe(409);
      // Another view needs its text.
      expect(
        (await send('POST', `requests/${request.id}/decision`, { choice: 'other' }, mate))
          .statusCode,
      ).toBe(400);

      const decided = await send(
        'POST',
        `requests/${request.id}/decision`,
        { choice: 'other', text: 'The league first, cups next week.' },
        mate,
      );
      expect(decided.statusCode).toBe(200);
      expect(decided.json<ConsoleRequestDetail>()).toMatchObject({
        status: 'decided',
        decision_choice: 'other',
        decision_text: 'The league first, cups next week.',
        decision_by: `AC ${RUN} teammate`,
      });
      // Decided once: a second answer is refused.
      expect(
        (await send('POST', `requests/${request.id}/decision`, { choice: 'reject' })).statusCode,
      ).toBe(409);
      expect(
        (await send('POST', `requests/${request.id}/execute`, { execute: true })).statusCode,
      ).toBe(200);

      // A new question clears the old decision from the request; the history keeps it.
      const again = await requestStore.agentAsk(request.id, 'And the cups now?');
      expect(again).toMatchObject({
        kind: 'ok',
        request: { decision_choice: null, decision_text: null, execute_requested_at: null },
      });
      const fetched = (await get(`requests/${request.id}`)).json<ConsoleRequestDetail>();
      expect(fetched.events.find((e) => e.kind === 'decided')?.note).toBe(
        'other: The league first, cups next week.',
      );

      const cancelled = await send('POST', `requests/${request.id}/status`, { action: 'cancel' });
      expect(cancelled.json<ConsoleRequestDetail>().status).toBe('cancelled');
      expect(await requestStore.agentAsk(request.id, 'Still?')).toMatchObject({
        kind: 'refused',
      });
      expect(
        await requestStore.agentResult('0f8fad5b-d9cb-469f-a165-70867728950e', 'done', 'x'),
      ).toEqual({ kind: 'missing' });
    });

    it('lists newest first, filters by status and counts each one', async () => {
      const list = (await get('requests')).json<ConsoleRequestList>();
      const mine = list.requests.filter((r) => r.title.endsWith(RUN));
      expect(mine.map((r) => r.title)).toEqual([`Question ${RUN}`, `Fix the table ${RUN}`]);
      expect(list.counts.by_status.cancelled).toBeGreaterThanOrEqual(1);
      expect(list.counts.all).toBe(Object.values(list.counts.by_status).reduce((a, b) => a + b, 0));
      const cancelled = (await get('requests?status=cancelled')).json<ConsoleRequestList>();
      expect(cancelled.requests.every((r) => r.status === 'cancelled')).toBe(true);
      expect(cancelled.requests.some((r) => r.title === `Question ${RUN}`)).toBe(true);
      const counts = (await get('requests/counts')).json<ConsoleRequestList['counts']>();
      expect(counts.open).toBe(
        counts.by_status.new +
          counts.by_status.in_progress +
          counts.by_status.waiting_decision +
          counts.by_status.decided,
      );
    });

    it('holds a person to the hourly ceiling, with Retry-After', async () => {
      const { rows } = await pool.query<{ per_hour: number }>(
        `SELECT per_hour FROM rate_limit WHERE action = 'console_request'`,
      );
      expect(rows[0]?.per_hour).toBe(60);
      try {
        await pool.query(`UPDATE rate_limit SET per_hour = 1 WHERE action = 'console_request'`);
        await send('POST', 'requests', { title: `Warm-up ${RUN}` }, mate);
        const refused = await send('POST', 'requests', { title: `One more ${RUN}` }, mate);
        expect(refused.statusCode).toBe(429);
        expect(refused.json<ApiError>().error).toBe('rate_limited');
        expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
        const { rowCount } = await pool.query(`SELECT 1 FROM console_request WHERE title = $1`, [
          `One more ${RUN}`,
        ]);
        expect(rowCount).toBe(0);
      } finally {
        await pool.query(`UPDATE rate_limit SET per_hour = 60 WHERE action = 'console_request'`);
      }
    });
  });

  // --- Pictures on a request (T-1731, D-357) --------------------------------
  //
  // In this file, not their own, because the ceiling tests above change the
  // shared `rate_limit` rows for a moment, and spec files run side by side.
  describe('pictures on a request (T-1731, D-357)', () => {
    let picMate = '';

    const solid = (width: number, height: number) =>
      sharp({ create: { width, height, channels: 3, background: { r: 200, g: 40, b: 40 } } });

    /** A JPEG as a phone writes it: EXIF with the maker and a GPS position. */
    const gpsJpeg = () =>
      solid(320, 240)
        .withExif({
          IFD0: { Make: 'TestPhone', Model: `ai-${RUN}` },
          IFD3: {
            GPSLatitudeRef: 'N',
            GPSLatitude: '35/1 41/1 0/1',
            GPSLongitudeRef: 'E',
            GPSLongitude: '51/1 25/1 0/1',
          },
        })
        .jpeg()
        .toBuffer();

    const upload = (
      requestId: string,
      bytes: Buffer,
      options: { who?: string | null; caption?: string; type?: string } = {},
    ) =>
      app.inject({
        method: 'POST',
        url: `/console/requests/${requestId}/images${
          options.caption === undefined ? '' : `?caption=${encodeURIComponent(options.caption)}`
        }`,
        headers: {
          ...as(options.who === undefined ? cookie : options.who),
          'content-type': options.type ?? 'application/octet-stream',
        },
        payload: bytes,
      });

    async function newRequest(title: string): Promise<ConsoleRequestDetail> {
      const created = await send('POST', 'requests', { title });
      expect(created.statusCode).toBe(201);
      return created.json<ConsoleRequestDetail>();
    }

    const readdirCount = (dir: string): number => readdirSync(dir).length;

    beforeAll(async () => {
      const token = await invite(`AC ${RUN} picture mate`);
      const accepted = await send(
        'POST',
        'invitations/accept',
        { token, username: `${name}_pic`, password: PASSWORD },
        null,
      );
      picMate = cookieOf(accepted.headers['set-cookie']);
    });

    it('needs a session for every picture route', async () => {
      const request = await newRequest(`Session ${RUN}`);
      const added = await upload(request.id, await solid(20, 20).png().toBuffer());
      expect(added.statusCode).toBe(201);
      const imageId = added.json<ConsoleRequestDetail>().images[0]!.id;
      for (const who of [null, 'not-a-token']) {
        expect(
          (await upload(request.id, await solid(4, 4).png().toBuffer(), { who })).statusCode,
        ).toBe(401);
        expect((await get(`requests/${request.id}/images/${imageId}`, who)).statusCode).toBe(401);
        expect((await get(`requests/${request.id}/images/${imageId}/thumb`, who)).statusCode).toBe(
          401,
        );
        const patch = await app.inject({
          method: 'PATCH',
          url: `/console/requests/${request.id}/images/${imageId}`,
          headers: as(who),
          payload: { caption: 'x' },
        });
        expect(patch.statusCode).toBe(401);
        const remove = await app.inject({
          method: 'DELETE',
          url: `/console/requests/${request.id}/images/${imageId}`,
          headers: as(who),
        });
        expect(remove.statusCode).toBe(401);
      }
      // A served picture is behind the session even with the right ids.
      const served = await get(`requests/${request.id}/images/${imageId}`);
      expect(served.statusCode).toBe(200);
    });

    it('judges an upload by its first bytes, not its name or stated type', async () => {
      const request = await newRequest(`Types ${RUN}`);
      const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>');
      const refusedSvg = await upload(request.id, svg);
      expect(refusedSvg.statusCode).toBe(400);
      expect(refusedSvg.json<ApiError>().message).toBe(IMAGE_REFUSALS.type);
      const heic = Buffer.concat([
        Buffer.from([0, 0, 0, 24]),
        Buffer.from('ftypheic'),
        Buffer.alloc(64),
      ]);
      const refusedHeic = await upload(request.id, heic);
      expect(refusedHeic.statusCode).toBe(400);
      expect(refusedHeic.json<ApiError>().message).toBe(IMAGE_REFUSALS.heic);
      // PNG bytes behind a JPEG's first three bytes: the decoder disagrees.
      const png = await solid(8, 8).png().toBuffer();
      const polyglot = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), png]);
      expect((await upload(request.id, polyglot)).statusCode).toBe(400);
      // A picture's bytes sent as JSON or as image/png are not this route's body.
      expect((await upload(request.id, png, { type: 'image/png' })).statusCode).toBe(415);
      // The raw type is refused by every other route.
      const elsewhere = await app.inject({
        method: 'POST',
        url: '/console/requests',
        headers: { ...as(cookie), 'content-type': 'application/octet-stream' },
        payload: png,
      });
      expect(elsewhere.statusCode).toBe(415);
      const { rows } = await pool.query(
        `SELECT 1 FROM console_request_image WHERE request_id = $1`,
        [request.id],
      );
      expect(rows).toHaveLength(0);
    });

    it('refuses more than 8 MB, and a ninth picture', { timeout: 30_000 }, async () => {
      const request = await newRequest(`Limits ${RUN}`);
      const big = Buffer.alloc(CONSOLE_REQUEST_IMAGE_MAX_BYTES + 1);
      Buffer.from([0xff, 0xd8, 0xff]).copy(big);
      const tooBig = await upload(request.id, big);
      expect(tooBig.statusCode).toBe(413);
      expect(tooBig.json<ApiError>().message).toBe(IMAGE_REFUSALS.tooBig);

      for (let i = 0; i < CONSOLE_REQUEST_IMAGES_MAX; i += 1)
        expect(
          (
            await upload(
              request.id,
              await solid(10 + i, 10)
                .png()
                .toBuffer(),
            )
          ).statusCode,
        ).toBe(201);
      const ninth = await upload(request.id, await solid(30, 30).png().toBuffer());
      expect(ninth.statusCode).toBe(409);
      expect(ninth.json<ApiError>().message).toBe('A request holds at most 8 pictures.');
      const list = (await get('requests')).json<ConsoleRequestList>();
      const listed = list.requests.find((r) => r.id === request.id)!;
      expect(listed.images.map((i) => i.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    });

    it('stores and serves a WebP without the EXIF and GPS of the upload', async () => {
      const request = await newRequest(`Metadata ${RUN}`);
      const jpeg = await gpsJpeg();
      expect(jpeg.includes(Buffer.from('TestPhone'))).toBe(true);
      const added = await upload(request.id, jpeg, { caption: '  نمای صفحه  ' });
      expect(added.statusCode).toBe(201);
      const image = added.json<ConsoleRequestDetail>().images[0]!;
      expect(image).toMatchObject({
        position: 1,
        caption: 'نمای صفحه',
        content_type: 'image/webp',
        width: 320,
        height: 240,
        uploaded_by: `AC ${RUN} maintainer`,
      });
      expect(image.thumb_width).toBeLessThanOrEqual(480);

      const served = await get(`requests/${request.id}/images/${image.id}`);
      expect(served.statusCode).toBe(200);
      expect(served.headers['content-type']).toBe('image/webp');
      expect(served.headers['cache-control']).toBe('private, max-age=3600');
      expect(String(served.headers['content-disposition'])).toMatch(/^inline; filename="request-/);
      expect(served.headers['x-content-type-options']).toBe('nosniff');
      expect(String(served.headers['content-security-policy'])).toContain('sandbox');
      const bytes = served.rawPayload;
      expect(bytes.length).toBe(image.byte_size);
      const meta = await sharp(bytes).metadata();
      expect(meta.format).toBe('webp');
      expect(meta.exif).toBeUndefined();
      expect(bytes.includes(Buffer.from('TestPhone'))).toBe(false);
      expect(bytes.includes(Buffer.from('GPS'))).toBe(false);
      expect(bytes.includes(Buffer.from('Exif'))).toBe(false);

      // The file on the volume is the same stored WebP, under the private folder.
      const onDisk = await readFile(
        join(media, 'console-requests', request.id, `${image.id}.webp`),
      );
      expect(onDisk.equals(bytes)).toBe(true);
      const thumb = await get(`requests/${request.id}/images/${image.id}/thumb`);
      expect(thumb.statusCode).toBe(200);
      expect((await sharp(thumb.rawPayload).metadata()).exif).toBeUndefined();

      // Another request's id with this picture's id finds nothing.
      const other = await newRequest(`Other ${RUN}`);
      expect((await get(`requests/${other.id}/images/${image.id}`)).statusCode).toBe(404);
      expect((await get(`requests/${request.id}/images/not-an-id`)).statusCode).toBe(404);
    });

    it('captions and removes a picture, with its files, history and audit', async () => {
      const request = await newRequest(`Remove ${RUN}`);
      const added = await upload(request.id, await solid(50, 30).png().toBuffer(), {
        who: picMate,
      });
      const image = added.json<ConsoleRequestDetail>().images[0]!;
      const full = join(media, 'console-requests', request.id, `${image.id}.webp`);
      const thumb = join(media, 'console-requests', request.id, `${image.id}-thumb.webp`);
      expect(existsSync(full) && existsSync(thumb)).toBe(true);

      const captioned = await app.inject({
        method: 'PATCH',
        url: `/console/requests/${request.id}/images/${image.id}`,
        headers: as(cookie),
        payload: { caption: 'جدول لیگ' },
      });
      expect(captioned.statusCode).toBe(200);
      expect(captioned.json<ConsoleRequestDetail>().images[0]!.caption).toBe('جدول لیگ');
      const long = await app.inject({
        method: 'PATCH',
        url: `/console/requests/${request.id}/images/${image.id}`,
        headers: as(cookie),
        payload: { caption: 'x'.repeat(301) },
      });
      expect(long.statusCode).toBe(400);

      const removed = await app.inject({
        method: 'DELETE',
        url: `/console/requests/${request.id}/images/${image.id}`,
        headers: as(cookie),
      });
      expect(removed.statusCode).toBe(200);
      const after = removed.json<ConsoleRequestDetail>();
      expect(after.images).toHaveLength(0);
      expect(after.events.map((e) => e.kind)).toEqual([
        'created',
        'image_added',
        'image_captioned',
        'image_removed',
      ]);
      expect(existsSync(full) || existsSync(thumb)).toBe(false);
      expect((await get(`requests/${request.id}/images/${image.id}`)).statusCode).toBe(404);
      const again = await app.inject({
        method: 'DELETE',
        url: `/console/requests/${request.id}/images/${image.id}`,
        headers: as(cookie),
      });
      expect(again.statusCode).toBe(404);
      expect(again.json<ApiError>().message).toBe('No such picture.');

      const { rows } = await pool.query<{ action: string; actor_name: string; previous: unknown }>(
        `SELECT action, actor_name, previous FROM console_audit
          WHERE target_type = 'console_request' AND target_id = $1 ORDER BY created_at, id`,
        [request.id],
      );
      expect(rows.map((r) => r.action)).toEqual([
        'request.created',
        'request.image_added',
        'request.image_captioned',
        'request.image_removed',
      ]);
      expect(rows[1]!.actor_name).toBe(`${name}_pic`);
      expect(rows[3]!.previous).toMatchObject({ image: image.id, caption: 'جدول لیگ' });
    });

    it('takes the run mark off a request whose pictures change after it was marked (T-1880)', async () => {
      const request = await newRequest(`Marked pictures ${RUN}`);
      const mark = async (): Promise<string> => {
        const marked = await send('POST', `requests/${request.id}/execute`, { execute: true });
        const at = marked.json<ConsoleRequestDetail>().execute_requested_at;
        expect(at).not.toBeNull();
        return at!;
      };
      const audited = async (action: string) => {
        const { rows } = await pool.query<{
          previous: Record<string, unknown> | null;
          next: Record<string, unknown> | null;
        }>(
          `SELECT previous, next FROM console_audit
            WHERE action = $1 AND target_id = $2 ORDER BY created_at DESC LIMIT 1`,
          [action, request.id],
        );
        return rows[0]!;
      };

      // A picture added to a marked request.
      const first = await mark();
      const added = await upload(request.id, await solid(40, 30).png().toBuffer(), {
        who: picMate,
      });
      expect(added.statusCode).toBe(201);
      expect(added.json<ConsoleRequestDetail>().execute_requested_at).toBeNull();
      const image = added.json<ConsoleRequestDetail>().images[0]!;
      expect(await audited('request.image_added')).toMatchObject({
        previous: { execute_requested_at: first },
        next: { image: image.id, execute: false },
      });

      // Its caption rewritten.
      const second = await mark();
      const captioned = await app.inject({
        method: 'PATCH',
        url: `/console/requests/${request.id}/images/${image.id}`,
        headers: as(picMate),
        payload: { caption: 'Read this instead' },
      });
      expect(captioned.json<ConsoleRequestDetail>().execute_requested_at).toBeNull();
      expect(await audited('request.image_captioned')).toMatchObject({
        previous: { image: image.id, caption: null, execute_requested_at: second },
        next: { image: image.id, caption: 'Read this instead', execute: false },
      });

      // And the picture removed.
      const third = await mark();
      const removed = await app.inject({
        method: 'DELETE',
        url: `/console/requests/${request.id}/images/${image.id}`,
        headers: as(picMate),
      });
      expect(removed.json<ConsoleRequestDetail>().execute_requested_at).toBeNull();
      expect(await audited('request.image_removed')).toMatchObject({
        previous: { image: image.id, execute_requested_at: third },
        next: { execute: false },
      });

      // A picture on an unmarked request says nothing of a mark.
      await upload(request.id, await solid(40, 30).png().toBuffer());
      const plain = await audited('request.image_added');
      expect(plain.previous).toBeNull();
      expect(plain.next).not.toHaveProperty('execute');
    });

    it('takes no picture on a closed request until it is reopened', async () => {
      const request = await newRequest(`Closed ${RUN}`);
      const added = await upload(request.id, await solid(12, 12).png().toBuffer());
      const imageId = added.json<ConsoleRequestDetail>().images[0]!.id;
      await app.inject({
        method: 'POST',
        url: `/console/requests/${request.id}/status`,
        headers: as(cookie),
        payload: { action: 'cancel' },
      });
      const refused = await upload(request.id, await solid(12, 12).png().toBuffer());
      expect(refused.statusCode).toBe(409);
      const remove = await app.inject({
        method: 'DELETE',
        url: `/console/requests/${request.id}/images/${imageId}`,
        headers: as(cookie),
      });
      expect(remove.statusCode).toBe(409);
      // Still served: a closed request keeps its pictures.
      expect((await get(`requests/${request.id}/images/${imageId}`)).statusCode).toBe(200);
      expect(readdirCount(join(media, 'console-requests', request.id))).toBe(2);
    });

    it('holds a person to the hourly picture ceiling', async () => {
      const { rows } = await pool.query<{ per_hour: number }>(
        `SELECT per_hour FROM rate_limit WHERE action = 'console_request_image'`,
      );
      expect(rows[0]?.per_hour).toBe(40);
      const request = await newRequest(`Ceiling ${RUN}`);
      try {
        await pool.query(
          `UPDATE rate_limit SET per_hour = 1 WHERE action = 'console_request_image'`,
        );
        // The teammate's first picture this hour is the one allowed.
        await pool.query(
          `UPDATE rate_limit SET per_hour = per_hour + (SELECT count(*) FROM console_request_event e
              JOIN console_user u ON u.id = e.actor_id
             WHERE u.username = $1 AND e.kind = 'image_added'
               AND e.created_at >= date_trunc('hour', now()))
           WHERE action = 'console_request_image'`,
          [`${name}_pic`],
        );
        expect(
          (await upload(request.id, await solid(9, 9).png().toBuffer(), { who: picMate }))
            .statusCode,
        ).toBe(201);
        const refused = await upload(request.id, await solid(9, 9).png().toBuffer(), {
          who: picMate,
        });
        expect(refused.statusCode).toBe(429);
        expect(refused.json<ApiError>().message).toMatch(
          /^That is the most pictures an hour allows\./,
        );
        expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
      } finally {
        await pool.query(
          `UPDATE rate_limit SET per_hour = 40 WHERE action = 'console_request_image'`,
        );
      }
    });

    it('prints a picture as base64 from the command line', async () => {
      expect(parseConsoleArgs(['request-image', '--id', 'nope'])).toMatchObject({ kind: 'error' });
      const request = await newRequest(`CLI ${RUN}`);
      const added = await upload(request.id, await solid(64, 48).png().toBuffer());
      const image = added.json<ConsoleRequestDetail>().images[0]!;
      expect(parseConsoleArgs(['request-image', '--id', image.id, '--thumb'])).toEqual({
        kind: 'request-image',
        id: image.id,
        thumb: true,
      });
      const secret = process.env.SESSION_SECRET;
      process.env.SESSION_SECRET ??= SECRET;
      const written: string[] = [];
      const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
        written.push(String(chunk));
        return true;
      });
      let code: number;
      try {
        code = await consoleCli(['request-image', '--id', image.id]);
      } finally {
        spy.mockRestore();
      }
      expect(code).toBe(0);
      const out = written.join('');
      expect(out).toMatch(/^[A-Za-z0-9+/]+=*\n$/);
      const bytes = Buffer.from(out.trim(), 'base64');
      expect(bytes.length).toBe(image.byte_size);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(image.sha256);
      const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        expect(
          await consoleCli(['request-image', '--id', '0f8fad5b-d9cb-469f-a165-70867728950e']),
        ).toBe(1);
      } finally {
        errors.mockRestore();
        if (secret === undefined) delete process.env.SESSION_SECRET;
      }
    });
  });

  describe('closing an account from the command line (T-1880)', () => {
    const closed = `ac_${RUN}_k`;
    const BY = `ac_${RUN} operator`;
    let userId = '';

    /** The command line as the operator runs it: its exit code and what it printed. */
    async function cli(argv: string[]): Promise<{ code: number; out: string; err: string }> {
      const secret = process.env.SESSION_SECRET;
      process.env.SESSION_SECRET ??= SECRET;
      const out: string[] = [];
      const err: string[] = [];
      const collect = (into: string[]) => (chunk: unknown) => {
        into.push(String(chunk));
        return true;
      };
      const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(collect(out));
      const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(collect(err));
      try {
        return { code: await consoleCli(argv), out: out.join(''), err: err.join('') };
      } finally {
        stdout.mockRestore();
        stderr.mockRestore();
        if (secret === undefined) delete process.env.SESSION_SECRET;
      }
    }

    const signIn = async (): Promise<string> => {
      const response = await send(
        'POST',
        'session',
        { username: closed, password: PASSWORD },
        null,
      );
      expect(response.statusCode).toBe(204);
      return cookieOf(response.headers['set-cookie']);
    };

    const auditOf = async (action: string) => {
      const { rows } = await pool.query<{
        actor_id: string | null;
        actor_name: string;
        reason: string;
        previous: Record<string, unknown> | null;
        next: Record<string, unknown> | null;
      }>(
        `SELECT actor_id, actor_name, reason, previous, next FROM console_audit
          WHERE action = $1 AND target_id = $2 ORDER BY created_at, id`,
        [action, userId],
      );
      return rows;
    };

    beforeAll(async () => {
      const token = await invite(`AC ${RUN} closed`);
      const accepted = await send(
        'POST',
        'invitations/accept',
        { token, username: closed, password: PASSWORD },
        null,
      );
      expect(accepted.statusCode).toBe(204);
      userId = (await get('me', cookieOf(accepted.headers['set-cookie']))).json<{ id: string }>()
        .id;
    });

    it('audits an invitation with who it is for and until when, never its token', async () => {
      const token = await invite(`AC ${RUN} audited`);
      const { rows } = await pool.query<{
        actor_id: string | null;
        actor_name: string;
        target_type: string;
        reason: string;
        previous: unknown;
        next: { display_name: string; expires_at: string };
      }>(
        `SELECT a.actor_id, a.actor_name, a.target_type, a.reason, a.previous, a.next
           FROM console_audit a JOIN console_invite i ON i.id::text = a.target_id
          WHERE a.action = 'console.invitation_created' AND i.display_name = $1`,
        [`AC ${RUN} audited`],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        actor_id: null,
        actor_name: 'invite (server)',
        target_type: 'console_invite',
        reason: `invitation made for AC ${RUN} audited`,
        previous: null,
        next: { display_name: `AC ${RUN} audited` },
      });
      expect(Date.parse(rows[0]!.next.expires_at)).toBeGreaterThan(Date.now());
      const written = JSON.stringify(rows[0]);
      expect(written).not.toContain(token);
      expect(written).not.toContain(hashToken(consoleTokenText(token), SECRET));
    });

    it('disable-user refuses the sign-in, ends every session and calls off what was queued', async () => {
      const first = await signIn();
      const second = await signIn();
      const queued = await send(
        'POST',
        'commands',
        { kind: 'agent.run', target: 'data-auditor', reason: 'now' },
        first,
      );
      expect(queued.statusCode).toBe(201);
      const posted = await send(
        'POST',
        'agents/data-auditor/messages',
        { body: `Queued before closing ${RUN}` },
        second,
      );
      expect(posted.statusCode).toBe(201);
      // A message the computer took two hours ago and has not answered: left
      // alone it would be taken again, the run having died.
      const taken = (
        await send('POST', 'agents/data-auditor/messages', { body: `Taken ${RUN}` }, second)
      ).json<ConsoleMessage>();
      await pool.query(
        `UPDATE console_message SET status = 'answering', taken_at = now() - interval '2 hours'
          WHERE id = $1`,
        [taken.id],
      );
      // Requests it marked to run, its own and the maintainer's; and one the maintainer marked.
      const requestOf = async (title: string, who: string) =>
        (await send('POST', 'requests', { title }, who)).json<ConsoleRequestDetail>();
      const markedBy = async (id: string, who: string) => {
        const marked = await send('POST', `requests/${id}/execute`, { execute: true }, who);
        expect(marked.statusCode).toBe(200);
        return marked.json<ConsoleRequestDetail>().execute_requested_at!;
      };
      const own = await requestOf(`Closed, own ${RUN}`, first);
      const theirs = await requestOf(`Closed, the maintainer's ${RUN}`, cookie);
      const kept = await requestOf(`Closed, marked by the maintainer ${RUN}`, cookie);
      const ownMark = await markedBy(own.id, first);
      const theirMark = await markedBy(theirs.id, second);
      const keptMark = await markedBy(kept.id, cookie);

      const done = await cli([
        'disable-user',
        '--name',
        closed,
        '--by',
        BY,
        '--reason',
        'its cookie was copied',
      ]);
      expect(done).toMatchObject({ code: 0, err: '' });
      // The sign-ins of `beforeAll` and of this test: three sessions were open.
      // Not the owner: no warning.
      expect(done.out).toBe(
        `${closed} is disabled: it cannot sign in, 3 session(s) ended, ` +
          `1 queued command(s), 2 unanswered message(s) and ` +
          `2 run mark(s) on teammate requests called off.\n`,
      );

      // At once, on every session, and no new one.
      for (const session of [first, second]) {
        expect((await get('me', session)).statusCode).toBe(401);
        expect(
          (await send('POST', 'board', { title: 't', column: 'next' }, session)).statusCode,
        ).toBe(401);
      }
      const refused = await send('POST', 'session', { username: closed, password: PASSWORD }, null);
      expect(refused.statusCode).toBe(401);
      const { rows: open } = await pool.query(
        `SELECT 1 FROM console_session WHERE user_id = $1 AND revoked_at IS NULL`,
        [userId],
      );
      expect(open).toEqual([]);

      // What it had queued never reaches the computer.
      const command = queued.json<ConsoleCommand>();
      const { rows: commands } = await pool.query<{ status: string }>(
        `SELECT status FROM console_command WHERE id = $1`,
        [command.id],
      );
      expect(commands).toEqual([{ status: 'cancelled' }]);
      expect((await store.takeCommands()).some((c) => c.id === command.id)).toBe(false);
      const message = posted.json<ConsoleMessage>();
      expect((await store.takeMessages()).some((t) => t.message.id === message.id)).toBe(false);
      const { rows: messages } = await pool.query<{ status: string; failure: string }>(
        `SELECT status, failure FROM console_message WHERE id = $1`,
        [message.id],
      );
      expect(messages).toEqual([{ status: 'failed', failure: DISABLED_MESSAGE_FAILURE }]);
      // The one being answered is not taken again, and a reply that comes for it is not stored.
      const { rows: answering } = await pool.query<{ status: string; failure: string }>(
        `SELECT status, failure FROM console_message WHERE id = $1`,
        [taken.id],
      );
      expect(answering).toEqual([{ status: 'failed', failure: DISABLED_MESSAGE_FAILURE }]);
      expect((await store.takeMessages()).some((t) => t.message.id === taken.id)).toBe(false);
      expect(await store.postReply(taken.id, 'answered', 'A late reply.')).toBe(false);
      const { rowCount: replies } = await pool.query(
        `SELECT 1 FROM console_message WHERE reply_to = $1`,
        [taken.id],
      );
      expect(replies).toBe(0);

      // "Run the marked ones" runs nothing this account marked; another person's mark stays.
      const requestStore = app.get(PostgresRequestStore);
      expect((await requestStore.get(own.id))?.execute_requested_at).toBeNull();
      expect((await requestStore.get(theirs.id))?.execute_requested_at).toBeNull();
      expect((await requestStore.get(kept.id))?.execute_requested_at).toBe(keptMark);
      expect((await requestStore.get(theirs.id))?.title).toBe(theirs.title);

      // Work that slipped in for the account after it was closed is never handed out either.
      const { rows: late } = await pool.query<{ id: string }>(
        `INSERT INTO console_command (kind, target, requested_by)
         VALUES ('agent.pause', 'data-auditor', $1) RETURNING id`,
        [userId],
      );
      const { rows: lateMessage } = await pool.query<{ id: string }>(
        `INSERT INTO console_message (agent, author_id, body, status)
         VALUES ('data-auditor', $1, $2, 'queued') RETURNING id`,
        [userId, `Late ${RUN}`],
      );
      expect((await store.takeCommands()).some((c) => c.id === late[0]!.id)).toBe(false);
      expect((await store.takeMessages()).some((t) => t.message.id === lateMessage[0]!.id)).toBe(
        false,
      );

      // Rule 10: who, why, and what it was before.
      const audit = await auditOf('console.user_disabled');
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        actor_id: null,
        actor_name: `${BY} (server)`,
        reason: 'its cookie was copied',
        previous: {
          disabled_at: null,
          owner: false,
          open_sessions: 3,
          queued_commands: 1,
          queued_messages: 1,
          answering_messages: 1,
          run_marks: 2,
          run_marked_requests: [
            { id: own.id, marked_at: ownMark },
            { id: theirs.id, marked_at: theirMark },
          ],
        },
        next: {
          open_sessions: 0,
          queued_commands: 0,
          queued_messages: 0,
          answering_messages: 0,
          run_marks: 0,
        },
      });
      expect(Date.parse(String(audit[0]!.next?.disabled_at))).not.toBeNaN();
      await expect(
        pool.query(`UPDATE console_audit SET reason = 'rewritten' WHERE target_id = $1`, [userId]),
      ).rejects.toThrow();

      // A second run changes nothing and writes nothing.
      const again = await cli(['disable-user', '--name', closed, '--by', BY, '--reason', 'again']);
      expect(again).toMatchObject({
        code: 0,
        out: `${closed} is disabled already. Nothing was changed.\n`,
      });
      expect(await auditOf('console.user_disabled')).toHaveLength(1);
    });

    it('enable-user opens it again; the ended sessions stay ended', async () => {
      const { rows: before } = await pool.query<{ disabled_at: Date }>(
        `SELECT disabled_at FROM console_user WHERE id = $1`,
        [userId],
      );
      const done = await cli([
        'enable-user',
        '--name',
        closed,
        '--by',
        BY,
        '--reason',
        'new password set',
      ]);
      expect(done).toMatchObject({ code: 0, out: `${closed} is enabled again and can sign in.\n` });
      const audit = await auditOf('console.user_enabled');
      expect(audit).toEqual([
        {
          actor_id: null,
          actor_name: `${BY} (server)`,
          reason: 'new password set',
          previous: { disabled_at: before[0]!.disabled_at.toISOString() },
          next: { disabled_at: null },
        },
      ]);
      const { rows: sessions } = await pool.query(
        `SELECT 1 FROM console_session WHERE user_id = $1 AND revoked_at IS NULL`,
        [userId],
      );
      expect(sessions).toEqual([]);
      expect((await get('me', await signIn())).statusCode).toBe(200);
      const again = await cli(['enable-user', '--name', closed, '--by', BY, '--reason', 'again']);
      expect(again.out).toBe(`${closed} is enabled already. Nothing was changed.\n`);
      expect(await auditOf('console.user_enabled')).toHaveLength(1);
    });

    it('end-sessions ends the sessions of an account that stays enabled', async () => {
      // One session is open from the test before.
      const second = await signIn();
      const done = await cli([
        'end-sessions',
        '--name',
        closed,
        '--by',
        BY,
        '--reason',
        'left a shared computer',
      ]);
      expect(done).toMatchObject({ code: 0, out: `2 session(s) of ${closed} ended.\n` });
      expect((await get('me', second)).statusCode).toBe(401);
      expect(await auditOf('console.sessions_ended')).toEqual([
        {
          actor_id: null,
          actor_name: `${BY} (server)`,
          reason: 'left a shared computer',
          previous: { open_sessions: 2 },
          next: { open_sessions: 0 },
        },
      ]);
      // Another person's session is not touched, and this one signs in again.
      expect((await get('me')).statusCode).toBe(200);
      const again = await cli(['end-sessions', '--name', closed, '--by', BY, '--reason', 'again']);
      expect(again.out).toBe(`${closed} has no open session. Nothing was changed.\n`);
      expect(await auditOf('console.sessions_ended')).toHaveLength(1);
      expect((await get('me', await signIn())).statusCode).toBe(200);
    });

    it('says so when there is no such account', async () => {
      for (const kind of ['disable-user', 'enable-user', 'end-sessions']) {
        const none = await cli([kind, '--name', `${closed}_none`, '--by', BY, '--reason', 'why']);
        expect(none).toMatchObject({
          code: 1,
          out: '',
          err: `No console account ${closed}_none.\n`,
        });
      }
    });
  });

  it('keeps the board, and audits every change', async () => {
    const created = await send('POST', 'board', {
      title: `Card ${RUN}`,
      column: 'next',
      labels: ['console'],
    });
    expect(created.statusCode).toBe(201);
    const card = created.json<ConsoleBoardCard>();

    const moved = await send('PATCH', `board/${card.id}`, {
      column: 'doing',
      assignee: 'teammate',
    });
    expect(moved.json<ConsoleBoardCard>()).toMatchObject({
      column: 'doing',
      assignee: 'teammate',
      title: `Card ${RUN}`,
    });
    expect((await send('PATCH', `board/${card.id}`, { column: 'nowhere' })).statusCode).toBe(400);

    expect((await send('DELETE', `board/${card.id}`)).statusCode).toBe(204);
    const cards = (await get('board')).json<{ cards: ConsoleBoardCard[] }>().cards;
    expect(cards.some((c) => c.id === card.id)).toBe(false);

    const actions = (await get('audit'))
      .json<{ entries: ConsoleAuditEntry[] }>()
      .entries.map((e) => e.action);
    for (const action of [
      'console.invitation_accepted',
      'console.sign_in',
      'console.sign_in_failed',
      'console.locked',
      'command.agent_pause',
      'command.decision_answer',
      'board.card_created',
      'board.card_changed',
      'board.card_archived',
    ]) {
      expect(actions).toContain(action);
    }
  });
});
