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
  type ConsoleSnapshot,
  type ConsoleSnapshotResponse,
} from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { withTriggersOff } from '../../testing/cleanup';
import { hashToken, newToken } from '../identity/identity.service';
import { CONSOLE_OPTIONS } from './agents-console.controller';
import { AgentsConsoleModule } from './agents-console.module';
import { LOCK_AFTER_FAILURES, checkSnapshot, consoleTokenText } from './internal/console-rules';
import { PostgresConsoleStore } from './internal/console-store';

/**
 * The agents console (T-1696, T-1697, D-340): an account opens only from a
 * one-time invitation; a session is the console's own cookie; wrong
 * passwords lock a name; nothing but signing in answers without a session;
 * the snapshot keeps an open security finding to its title; a command is
 * queued, taken and finished; board changes and sign-ins are audited.
 *
 * Its names start `ac_<run>` and its snapshot is dated 2099, so it is the
 * newest while the spec runs; everything is removed afterwards.
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
      await client.query(
        `DELETE FROM console_audit WHERE actor_id = ANY($1::uuid[]) OR actor_name LIKE $2`,
        [ids, `ac_${RUN}%`],
      );
    });
    await pool.query(
      `DELETE FROM console_invite WHERE used_by = ANY($1::uuid[]) OR display_name LIKE $2`,
      [ids, `AC ${RUN}%`],
    );
    await pool.query(`DELETE FROM console_user WHERE id = ANY($1::uuid[])`, [ids]);
    await pool.end();
    await app.close();
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
