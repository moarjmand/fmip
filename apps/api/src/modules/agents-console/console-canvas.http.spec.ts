import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { ApiError, ConsoleCanvas, ConsoleCanvasCard } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { withTriggersOff } from '../../testing/cleanup';
import { hashPassword, hashToken, newToken } from '../identity/identity.service';
import { CONSOLE_OPTIONS } from './agents-console.controller';
import { AgentsConsoleModule } from './agents-console.module';
import { consoleTokenText } from './internal/console-rules';
import { PostgresConsoleStore } from './internal/console-store';

/**
 * T-1856 (D-441) against the real schema: the business model canvas's routes
 * refuse without a console session; the seed is the artifact's 55 cards in
 * the nine blocks, with no history; a card is added, edited in both
 * languages, tagged, moved to another block and inside one, removed into the
 * bin and restored to its place, each change with its event row(s) and its
 * `console_audit` row carrying the whole card before and after; nothing
 * deletes a row; bad input changes nothing; and a person is held to the
 * hourly ceiling. Everything it adds is removed afterwards, and the seed's
 * places it touched are put back.
 *
 * T-1872 (D-448): two canvases. The migration put every existing card and
 * event on Claude's (`claude`); every route takes `?canvas=`, none is
 * Claude's; the teammate's canvas has its own cards, places, bin and history;
 * a card route on the other canvas's card is 404; a key that is no canvas is
 * 400; the audit row names the canvas; the ceiling is one across both.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const SECRET = 'console-canvas-secret-'.repeat(3);

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('console canvas', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let cookie = '';
  const users: string[] = [];

  const call = async <T>(
    method: string,
    url: string,
    body?: unknown,
    who: string | null = cookie,
  ) => {
    const response = await app.inject({
      method: method as 'GET',
      url: `/console/canvas${url}`,
      headers: who === null ? {} : { cookie: `fmip_console=${who}` },
      ...(body === undefined ? {} : { payload: body as object }),
    });
    return {
      status: response.statusCode,
      headers: response.headers,
      body: (response.body === '' ? null : response.json()) as T,
    };
  };
  const read = async () => (await call<ConsoleCanvas>('GET', '')).body;

  async function person(username: string): Promise<{ id: string; token: string }> {
    const store = app.get(PostgresConsoleStore);
    const invitation = newToken();
    await store.createInvitation(
      hashToken(consoleTokenText(invitation), SECRET),
      `Canvas ${RUN} ${username}`,
      new Date(Date.now() + 3_600_000),
    );
    const accepted = await store.acceptInvitation(
      hashToken(consoleTokenText(invitation), SECRET),
      username,
      await hashPassword('a perfectly fine passphrase'),
    );
    if (accepted.kind !== 'ok') throw new Error(`invitation: ${accepted.kind}`);
    const token = newToken();
    await store.createSession(accepted.user.id, hashToken(consoleTokenText(token), SECRET));
    users.push(accepted.user.id);
    return { id: accepted.user.id, token };
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
    cookie = (await person(`cv_${RUN}`)).token;
  }, 60_000);

  afterAll(async () => {
    await withTriggersOff(pool, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `SELECT id FROM console_canvas_card WHERE created_by = ANY($1::uuid[])`,
        [users],
      );
      const cards = rows.map((r) => r.id);
      await client.query(
        `DELETE FROM console_canvas_event WHERE actor_id = ANY($1::uuid[]) OR card_id = ANY($2::uuid[])`,
        [users, cards],
      );
      // A seed card a test touched goes back to how the seed left it (only
      // its place and who changed it; the tests change no seed text).
      await client.query(
        `UPDATE console_canvas_card SET updated_by = NULL WHERE updated_by = ANY($1::uuid[])`,
        [users],
      );
      await client.query(`DELETE FROM console_canvas_card WHERE id = ANY($1::uuid[])`, [cards]);
      // A move or a restore numbers a block's cards again; the seed's own order is its places.
      await client.query(
        `UPDATE console_canvas_card c SET position = o.n
           FROM (SELECT id, row_number() OVER (PARTITION BY block ORDER BY position, created_at, id) AS n
                   FROM console_canvas_card WHERE created_by IS NULL) o
          WHERE c.id = o.id AND c.position <> o.n`,
      );
      await client.query(`DELETE FROM console_audit WHERE actor_id = ANY($1::uuid[])`, [users]);
      // An invitation's own audit row has the server as its actor (T-1880).
      await client.query(
        `DELETE FROM console_audit WHERE action = 'console.invitation_created' AND target_id IN
           (SELECT id::text FROM console_invite WHERE used_by = ANY($1::uuid[]) OR display_name LIKE $2)`,
        [users, `Canvas ${RUN}%`],
      );
      await client.query(
        `DELETE FROM console_invite WHERE used_by = ANY($1::uuid[]) OR display_name LIKE $2`,
        [users, `Canvas ${RUN}%`],
      );
    });
    await pool.query(`DELETE FROM console_session WHERE user_id = ANY($1::uuid[])`, [users]);
    await pool.query(`DELETE FROM console_user WHERE id = ANY($1::uuid[])`, [users]);
    await pool.end();
    await app.close();
  });

  it('refuses every route without a console session', async () => {
    const id = '00000000-0000-4000-8000-000000000000';
    const refusals = await Promise.all([
      call('GET', '', undefined, null),
      call('POST', '/cards', { block: 'channels', text_en: 'x' }, null),
      call('PATCH', `/cards/${id}`, { tag: 'risk' }, null),
      call('POST', `/cards/${id}/move`, { direction: 'up' }, null),
      call('POST', `/cards/${id}/remove`, {}, null),
      call('POST', `/cards/${id}/restore`, {}, null),
      call('GET', '', undefined, 'not-a-session'),
      call('POST', `/cards/${id}/remove`, {}, 'not-a-session'),
    ]);
    for (const refused of refusals) {
      expect(refused.status).toBe(401);
      expect((refused.body as ApiError).error).toBe('unauthenticated');
    }
  });

  it('serves the seed: the artifact’s 55 cards in the nine blocks, verbatim, with no history', async () => {
    // Counted in the database, so a local database someone has used still passes.
    const { rows: seed } = await pool.query<{ block: string; n: number }>(
      `SELECT block, count(*)::int AS n FROM console_canvas_card
        WHERE created_by IS NULL GROUP BY block ORDER BY block`,
    );
    expect(Object.fromEntries(seed.map((r) => [r.block, r.n]))).toEqual({
      channels: 6,
      cost_structure: 8,
      customer_relationships: 5,
      customer_segments: 5,
      key_activities: 6,
      key_partners: 7,
      key_resources: 6,
      revenue_streams: 6,
      value_propositions: 6,
    });
    const { rows: tags } = await pool.query<{ tag: string; n: number }>(
      `SELECT tag, count(*)::int AS n FROM console_canvas_card
        WHERE created_by IS NULL GROUP BY tag ORDER BY tag`,
    );
    expect(tags).toEqual([
      { tag: 'assumption', n: 16 },
      { tag: 'question', n: 9 },
      { tag: 'risk', n: 8 },
      { tag: 'validated', n: 22 },
    ]);

    const { status, body } = await call<ConsoleCanvas>('GET', '');
    expect(status).toBe(200);
    // Block order is the fill order: segments first, costs last.
    expect(body.cards[0]?.block).toBe('customer_segments');
    expect(body.cards.at(-1)?.block).toBe('cost_structure');
    const first = body.cards.find((c) => c.block === 'customer_segments' && c.position === 1);
    expect(first).toMatchObject({
      tag: 'assumption',
      text_fa: 'هواداران فارسی‌زبان فوتبال که کانال تلگرام را می‌خوانند (ایران و خارج از ایران)',
      text_en: 'Persian-speaking football fans who read the Telegram channel (in Iran and abroad)',
      source: 'ops/reports/marketing-manager/2026-11-09.md (Audience)',
    });
    const partner = body.cards.find((c) => c.block === 'key_partners' && c.position === 1);
    expect(partner).toMatchObject({
      tag: 'validated',
      note_fa: '۷۵٬۰۰۰ درخواست در روز. فروش دوبارهٔ داده ممنوع.',
      note_en: '75,000 requests a day. Data resale forbidden.',
      source: 'D-014 · D-076 · D-197 · ops/licences.md §1',
    });
    const last = body.cards.find((c) => c.block === 'cost_structure' && c.position === 8);
    expect(last?.text_en).toBe("The founder's time and the AI tooling subscription: not costed");
    // A card nobody has changed is the first fill: no history, nobody named.
    const { rows: events } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM console_canvas_event e
         JOIN console_canvas_card c ON c.id = e.card_id WHERE c.created_by IS NULL`,
    );
    if (events[0]!.n === 0) expect(body.cards.every((c) => c.last_change === null)).toBe(true);
    expect(body.people.some((p) => p.username === `cv_${RUN}`)).toBe(true);
  });

  it('adds, edits, tags, moves, removes and restores a card, each with its events and audit row', async () => {
    const before = await read();
    const channels = before.cards.filter((c) => c.block === 'channels');
    const partners = before.cards.filter((c) => c.block === 'key_partners');

    const added = await call<ConsoleCanvasCard>('POST', '/cards', {
      block: 'channels',
      text_fa: `  کارت آزمایشی ${RUN}  `,
      source: 'T-1856',
    });
    expect(added.status).toBe(201);
    const id = added.body.id;
    expect(added.body).toMatchObject({
      block: 'channels',
      tag: 'assumption',
      text_fa: `کارت آزمایشی ${RUN}`,
      text_en: '',
      position: Math.max(0, ...channels.map((c) => c.position)) + 1,
      last_change: { actor: `Canvas ${RUN} cv_${RUN}` },
      removed_at: null,
    });

    const edited = await call<ConsoleCanvasCard>('PATCH', `/cards/${id}`, {
      text_en: `Test card ${RUN}`,
      note_fa: 'یادداشت',
      tag: 'risk',
    });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({
      tag: 'risk',
      text_en: `Test card ${RUN}`,
      note_fa: 'یادداشت',
    });

    // The same values again change nothing and write nothing.
    const same = await call<ConsoleCanvasCard>('PATCH', `/cards/${id}`, {
      tag: 'risk',
      text_fa: `کارت آزمایشی ${RUN}`,
    });
    expect(same.status).toBe(200);
    // Emptying both texts is refused, and changes nothing.
    const empty = await call<ApiError>('PATCH', `/cards/${id}`, { text_fa: '', text_en: ' ' });
    expect(empty.status).toBe(400);
    expect(empty.body.message).toBe('A card needs its text in Persian or English.');

    const moved = await call<ConsoleCanvasCard>('PATCH', `/cards/${id}`, { block: 'key_partners' });
    expect(moved.body).toMatchObject({
      block: 'key_partners',
      position: Math.max(0, ...partners.map((c) => c.position)) + 1,
    });
    const up = await call<ConsoleCanvasCard>('POST', `/cards/${id}/move`, { direction: 'up' });
    expect(up.status).toBe(200);
    let live = (await read()).cards.filter((c) => c.block === 'key_partners');
    expect(live.at(-2)?.id).toBe(id);
    const place = live.findIndex((c) => c.id === id);

    const removed = await call<ConsoleCanvasCard>('POST', `/cards/${id}/remove`, {});
    expect(removed.status).toBe(200);
    expect(removed.body.removed_by).toBe(`Canvas ${RUN} cv_${RUN}`);
    let canvas = await read();
    expect(canvas.cards.some((c) => c.id === id)).toBe(false);
    expect(canvas.removed[0]?.id).toBe(id);
    expect((await call('PATCH', `/cards/${id}`, { tag: 'validated' })).status).toBe(404);
    expect((await call('POST', `/cards/${id}/remove`, {})).status).toBe(404);

    const restored = await call<ConsoleCanvasCard>('POST', `/cards/${id}/restore`, {});
    expect(restored.status).toBe(200);
    expect(restored.body.removed_at).toBeNull();
    canvas = await read();
    live = canvas.cards.filter((c) => c.block === 'key_partners');
    // Back where it was, not at the end.
    expect(live.findIndex((c) => c.id === id)).toBe(place);
    expect(canvas.removed.some((c) => c.id === id)).toBe(false);
    expect((await call('POST', `/cards/${id}/restore`, {})).status).toBe(409);

    // The canvas's history, newest first, says every change with its field.
    const mine = canvas.history.filter((e) => e.card_id === id);
    expect(mine.map((e) => [e.kind, e.field, e.previous, e.next]).reverse()).toEqual([
      ['created', null, null, `کارت آزمایشی ${RUN}`],
      ['tagged', null, 'assumption', 'risk'],
      ['edited', 'text_en', '', `Test card ${RUN}`],
      ['edited', 'note_fa', '', 'یادداشت'],
      ['moved', null, 'channels', 'key_partners'],
      ['moved', null, String(live.length), String(live.length - 1)],
      ['removed', null, null, null],
      ['restored', null, null, null],
    ]);
    expect(mine[0]).toMatchObject({ card_text_en: `Test card ${RUN}` });

    const { rows: audit } = await pool.query<{
      action: string;
      reason: string;
      previous: Record<string, unknown> | null;
      next: Record<string, unknown> | null;
    }>(
      `SELECT action, reason, previous, next FROM console_audit
        WHERE target_type = 'canvas_card' AND target_id = $1 ORDER BY created_at, id`,
      [id],
    );
    expect(audit.map((a) => [a.action, a.reason])).toEqual([
      ['canvas.card_created', 'card added'],
      ['canvas.card_changed', 'changed tag, text_en, note_fa'],
      ['canvas.card_changed', 'changed block'],
      ['canvas.card_moved', 'moved up'],
      ['canvas.card_removed', 'card removed'],
      ['canvas.card_restored', 'card restored'],
    ]);
    // The whole card, before and after.
    expect(audit[1]!.previous).toEqual({
      canvas: 'claude',
      block: 'channels',
      tag: 'assumption',
      text_fa: `کارت آزمایشی ${RUN}`,
      text_en: '',
      note_fa: '',
      note_en: '',
      source: 'T-1856',
      position: added.body.position,
      removed: false,
    });
    expect(audit[1]!.next).toMatchObject({
      tag: 'risk',
      text_en: `Test card ${RUN}`,
      removed: false,
    });
    expect(audit[4]!.previous).toMatchObject({ block: 'key_partners', removed: false });
    expect(audit[4]!.next).toMatchObject({ block: 'key_partners', removed: true });

    // Nothing deleted a row.
    const { rows: kept } = await pool.query(`SELECT 1 FROM console_canvas_card WHERE id = $1`, [
      id,
    ]);
    expect(kept).toHaveLength(1);
    // Twenty calls, each a transaction: more than five seconds beside the other specs.
  }, 30_000);

  it('backfilled every card and event to Claude’s canvas, and keeps an event on its card’s canvas', async () => {
    // The seed (and anything written before the migration) is Claude's.
    const { rows: seed } = await pool.query<{ canvas: string; n: number }>(
      `SELECT canvas, count(*)::int AS n FROM console_canvas_card
        WHERE created_by IS NULL GROUP BY canvas`,
    );
    expect(seed).toEqual([{ canvas: 'claude', n: 55 }]);
    // Old writers (the API before T-1872, during a rollout) land on Claude's canvas.
    const { rows: defaults } = await pool.query<{ table_name: string; column_default: string }>(
      `SELECT table_name, column_default FROM information_schema.columns
        WHERE column_name = 'canvas'
          AND table_name IN ('console_canvas_card', 'console_canvas_event')
        ORDER BY table_name`,
    );
    expect(defaults).toEqual([
      { table_name: 'console_canvas_card', column_default: "'claude'::text" },
      { table_name: 'console_canvas_event', column_default: "'claude'::text" },
    ]);
    // No event names another canvas than its card's: the foreign key refuses one.
    const { rows: astray } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM console_canvas_event e
         JOIN console_canvas_card c ON c.id = e.card_id WHERE e.canvas <> c.canvas`,
    );
    expect(astray[0]!.n).toBe(0);
    const card = (await read()).cards[0]!;
    await expect(
      pool.query(
        `INSERT INTO console_canvas_event (canvas, card_id, actor_id, kind)
         VALUES ('teammate', $1, $2, 'removed')`,
        [card.id, users[0]],
      ),
    ).rejects.toThrow(/console_canvas_event_card_canvas/);
    await expect(
      pool.query(`UPDATE console_canvas_card SET canvas = 'mine' WHERE id = $1`, [card.id]),
    ).rejects.toThrow(/console_canvas_card_canvas/);
  });

  it('keeps the teammate’s canvas apart: its own cards, places, bin and history, on every route', async () => {
    const claudeBefore = await read();
    expect(claudeBefore.canvas).toBe('claude');
    expect(claudeBefore.cards.every((c) => c.canvas === 'claude')).toBe(true);
    // `?canvas=claude` is the same canvas as none.
    expect((await call<ConsoleCanvas>('GET', '?canvas=claude')).body.cards).toEqual(
      claudeBefore.cards,
    );

    const teammate = await call<ConsoleCanvas>('GET', '?canvas=teammate');
    expect(teammate.status).toBe(200);
    expect(teammate.body.canvas).toBe('teammate');
    // None of Claude's seed is on it.
    expect(teammate.body.cards.every((c) => c.canvas === 'teammate')).toBe(true);
    expect(teammate.body.cards.some((c) => claudeBefore.cards.some((k) => k.id === c.id))).toBe(
      false,
    );
    const channels = teammate.body.cards.filter((c) => c.block === 'channels');

    const first = await call<ConsoleCanvasCard>('POST', '/cards?canvas=teammate', {
      block: 'channels',
      text_en: `Teammate one ${RUN}`,
    });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({
      canvas: 'teammate',
      block: 'channels',
      // Its place counts the teammate's channels only, not Claude's six.
      position: Math.max(0, ...channels.map((c) => c.position)) + 1,
    });
    const second = await call<ConsoleCanvasCard>('POST', '/cards?canvas=teammate', {
      block: 'channels',
      text_fa: `کارت دوم ${RUN}`,
    });
    expect(second.body.position).toBe(first.body.position + 1);
    const id = second.body.id;

    // A card route on the other canvas's card is no card, and changes nothing.
    const claudeCard = claudeBefore.cards[0]!;
    expect((await call('PATCH', `/cards/${id}`, { tag: 'risk' })).status).toBe(404);
    expect((await call('POST', `/cards/${id}/move`, { direction: 'up' })).status).toBe(404);
    expect((await call('POST', `/cards/${id}/remove`, {})).status).toBe(404);
    expect(
      (await call('PATCH', `/cards/${claudeCard.id}?canvas=teammate`, { tag: 'risk' })).status,
    ).toBe(404);
    expect((await call('POST', `/cards/${claudeCard.id}/remove?canvas=teammate`, {})).status).toBe(
      404,
    );

    const edited = await call<ConsoleCanvasCard>('PATCH', `/cards/${id}?canvas=teammate`, {
      tag: 'risk',
    });
    expect(edited.body).toMatchObject({ canvas: 'teammate', tag: 'risk' });
    const up = await call<ConsoleCanvasCard>('POST', `/cards/${id}/move?canvas=teammate`, {
      direction: 'up',
    });
    expect(up.body.position).toBe(first.body.position);
    const removed = await call<ConsoleCanvasCard>(
      'POST',
      `/cards/${id}/remove?canvas=teammate`,
      {},
    );
    expect(removed.status).toBe(200);
    // The bin is the canvas's own.
    const binned = (await call<ConsoleCanvas>('GET', '?canvas=teammate')).body;
    expect(binned.removed.some((c) => c.id === id)).toBe(true);
    expect((await read()).removed.some((c) => c.id === id)).toBe(false);
    expect((await call('POST', `/cards/${id}/restore`, {})).status).toBe(404);
    const restored = await call<ConsoleCanvasCard>(
      'POST',
      `/cards/${id}/restore?canvas=teammate`,
      {},
    );
    expect(restored.status).toBe(200);
    expect(restored.body).toMatchObject({ canvas: 'teammate', removed_at: null });

    // The history is the canvas's own; Claude's says nothing of the teammate's cards.
    const after = (await call<ConsoleCanvas>('GET', '?canvas=teammate')).body;
    expect(
      after.history
        .filter((e) => e.card_id === id)
        .map((e) => e.kind)
        .reverse(),
    ).toEqual(['created', 'tagged', 'moved', 'removed', 'restored']);
    const claudeAfter = await read();
    expect(claudeAfter.history.some((e) => e.card_id === id || e.card_id === first.body.id)).toBe(
      false,
    );
    // Claude's canvas is as it was.
    expect(claudeAfter.cards.map((c) => [c.id, c.position])).toEqual(
      claudeBefore.cards.map((c) => [c.id, c.position]),
    );
    const { rows: events } = await pool.query<{ canvas: string }>(
      `SELECT DISTINCT canvas FROM console_canvas_event WHERE card_id = $1`,
      [id],
    );
    expect(events).toEqual([{ canvas: 'teammate' }]);

    // The audit row names the canvas, before and after.
    const { rows: audit } = await pool.query<{
      action: string;
      previous: Record<string, unknown> | null;
      next: Record<string, unknown> | null;
    }>(
      `SELECT action, previous, next FROM console_audit
        WHERE target_type = 'canvas_card' AND target_id = $1 ORDER BY created_at, id`,
      [id],
    );
    expect(audit.map((a) => a.action)).toEqual([
      'canvas.card_created',
      'canvas.card_changed',
      'canvas.card_moved',
      'canvas.card_removed',
      'canvas.card_restored',
    ]);
    expect(audit[0]!.next).toMatchObject({ canvas: 'teammate', block: 'channels' });
    expect(audit[1]!.previous).toMatchObject({ canvas: 'teammate', tag: 'assumption' });
    expect(audit[1]!.next).toMatchObject({ canvas: 'teammate', tag: 'risk' });
  }, 30_000);

  it('refuses a key that is no canvas on every route, before anything is written', async () => {
    const card = (await read()).cards[0]!;
    for (const q of ['?canvas=mine', '?canvas=teammate&canvas=claude', '?canvas=Claude']) {
      const refusals = await Promise.all([
        call<ApiError>('GET', q),
        call<ApiError>('POST', `/cards${q}`, { block: 'channels', text_en: `Never ${RUN}` }),
        call<ApiError>('PATCH', `/cards/${card.id}${q}`, { tag: 'risk' }),
        call<ApiError>('POST', `/cards/${card.id}/move${q}`, { direction: 'down' }),
        call<ApiError>('POST', `/cards/${card.id}/remove${q}`, {}),
        call<ApiError>('POST', `/cards/${card.id}/restore${q}`, {}),
      ]);
      for (const refused of refusals) {
        expect(refused.status).toBe(400);
        expect(refused.body.message).toBe('canvas is one of claude, teammate.');
      }
    }
    // Without a session the answer is still 401, whatever the key.
    expect((await call('GET', '?canvas=mine', undefined, null)).status).toBe(401);
    expect((await call('GET', '?canvas=teammate', undefined, null)).status).toBe(401);
    expect(
      (await call('POST', '/cards?canvas=teammate', { block: 'channels', text_en: 'x' }, null))
        .status,
    ).toBe(401);
    expect((await read()).cards.find((c) => c.id === card.id)).toEqual(card);
    const { rows } = await pool.query(`SELECT 1 FROM console_canvas_card WHERE text_en = $1`, [
      `Never ${RUN}`,
    ]);
    expect(rows).toHaveLength(0);
  });

  it('refuses bad input and a card that is none, changing nothing', async () => {
    const card = (await read()).cards[0]!;
    const nobody = '00000000-0000-4000-8000-000000000000';
    expect((await call('PATCH', `/cards/${card.id}`, { block: 'kp' })).status).toBe(400);
    expect((await call('PATCH', `/cards/${card.id}`, { tag: 'maybe' })).status).toBe(400);
    expect((await call('PATCH', `/cards/${card.id}`, {})).status).toBe(400);
    expect((await call('PATCH', `/cards/${card.id}`, { text_en: 'x'.repeat(501) })).status).toBe(
      400,
    );
    expect((await call('POST', `/cards/${card.id}/move`, { direction: 'left' })).status).toBe(400);
    expect((await call('POST', '/cards', { block: 'channels' })).status).toBe(400);
    expect((await call('PATCH', `/cards/${nobody}`, { tag: 'risk' })).status).toBe(404);
    expect((await call('POST', '/cards/not-an-id/remove', {})).status).toBe(404);
    const again = (await read()).cards.find((c) => c.id === card.id)!;
    expect(again).toEqual(card);
  });

  it('holds a person to the hourly ceiling, with Retry-After', async () => {
    const { rows } = await pool.query<{ per_hour: number }>(
      `SELECT per_hour FROM rate_limit WHERE action = 'console_canvas'`,
    );
    expect(rows[0]?.per_hour).toBe(300);
    // One change written just now, so a ceiling of one is reached in this
    // clock hour whatever the earlier tests did or when the hour turned.
    const added = await call<ConsoleCanvasCard>('POST', '/cards', {
      block: 'revenue_streams',
      tag: 'question',
      text_en: `Ceiling ${RUN}`,
    });
    expect(added.status).toBe(201);
    try {
      await pool.query(`UPDATE rate_limit SET per_hour = 1 WHERE action = 'console_canvas'`);
      const refused = await call<ApiError>('PATCH', `/cards/${added.body.id}`, { tag: 'risk' });
      expect(refused.status).toBe(429);
      expect(refused.body.error).toBe('rate_limited');
      expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
      // One ceiling across both canvases (T-1872).
      const elsewhere = await call<ApiError>('POST', '/cards?canvas=teammate', {
        block: 'channels',
        text_en: `Ceiling ${RUN}`,
      });
      expect(elsewhere.status).toBe(429);
    } finally {
      await pool.query(`UPDATE rate_limit SET per_hour = 300 WHERE action = 'console_canvas'`);
    }
    const untouched = (await read()).cards.find((c) => c.id === added.body.id)!;
    expect(untouched.tag).toBe('question');
  });
});
