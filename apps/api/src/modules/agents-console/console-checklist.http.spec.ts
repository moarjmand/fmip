import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { ApiError, ConsoleChecklist, ConsoleChecklistItem } from '@fmip/contracts';
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
 * T-1840 (D-428) against the real schema: the pre-launch checklist's routes
 * refuse without a console session; the seed is both lists, every item not
 * started and unassigned; an item is added, changed (status, assignee, text,
 * section), moved, noted and removed, each with its history row and its
 * `console_audit` row with the previous value; a removal needs its reason;
 * an assignee must be an enabled console account or the agents; and a person
 * is held to the hourly ceiling. Everything it adds is removed afterwards,
 * and a seeded item it touched is put back as the seed left it.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const SECRET = 'console-checklist-secret-'.repeat(3);

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('console checklist', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let cookie = '';
  let other = '';
  const users: string[] = [];

  const call = async <T>(
    method: string,
    url: string,
    body?: unknown,
    who: string | null = cookie,
  ) => {
    const response = await app.inject({
      method: method as 'GET',
      url: `/console/checklist${url}`,
      headers: who === null ? {} : { cookie: `fmip_console=${who}` },
      ...(body === undefined ? {} : { payload: body as object }),
    });
    return {
      status: response.statusCode,
      headers: response.headers,
      body: (response.body === '' ? null : response.json()) as T,
    };
  };

  async function person(username: string): Promise<{ id: string; token: string }> {
    const store = app.get(PostgresConsoleStore);
    const invitation = newToken();
    await store.createInvitation(
      hashToken(consoleTokenText(invitation), SECRET),
      `Checklist ${RUN} ${username}`,
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
    cookie = (await person(`cl_${RUN}`)).token;
    other = (await person(`cl_${RUN}_b`)).id;
  }, 60_000);

  afterAll(async () => {
    await withTriggersOff(pool, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `SELECT id FROM console_checklist_item WHERE created_by = ANY($1::uuid[])`,
        [users],
      );
      const items = rows.map((r) => r.id);
      await client.query(
        `DELETE FROM console_checklist_event WHERE actor_id = ANY($1::uuid[]) OR item_id = ANY($2::uuid[])`,
        [users, items],
      );
      await client.query(
        `DELETE FROM console_checklist_note WHERE author_id = ANY($1::uuid[]) OR item_id = ANY($2::uuid[])`,
        [users, items],
      );
      // A seeded item a test touched goes back to how the seed left it.
      await client.query(
        `UPDATE console_checklist_item
            SET status = 'not_started', assignee_id = NULL, assigned_agents = false, updated_by = NULL
          WHERE updated_by = ANY($1::uuid[]) OR assignee_id = ANY($1::uuid[])`,
        [users],
      );
      await client.query(`DELETE FROM console_checklist_item WHERE id = ANY($1::uuid[])`, [items]);
      // A move numbers a section's items again; the seed's own order is its positions.
      await client.query(
        `UPDATE console_checklist_item i SET position = o.n
           FROM (SELECT id, row_number() OVER (PARTITION BY section_id ORDER BY position, created_at, id) AS n
                   FROM console_checklist_item WHERE created_by IS NULL) o
          WHERE i.id = o.id AND i.position <> o.n`,
      );
      await client.query(`DELETE FROM console_audit WHERE actor_id = ANY($1::uuid[])`, [users]);
      await client.query(
        `DELETE FROM console_invite WHERE used_by = ANY($1::uuid[]) OR display_name LIKE $2`,
        [users, `Checklist ${RUN}%`],
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
      call('POST', '/items', { section_id: id, title: 'x' }, null),
      call('PATCH', `/items/${id}`, { status: 'done' }, null),
      call('POST', `/items/${id}/move`, { direction: 'up' }, null),
      call('POST', `/items/${id}/notes`, { body: 'x' }, null),
      call('DELETE', `/items/${id}`, { reason: 'x' }, null),
      call('GET', '', undefined, 'not-a-session'),
    ]);
    for (const refused of refusals) {
      expect(refused.status).toBe(401);
      expect((refused.body as ApiError).error).toBe('unauthenticated');
    }
  });

  it('serves both seeded lists, every item not started and unassigned, and the people', async () => {
    const { status, body } = await call<ConsoleChecklist>('GET', '');
    expect(status).toBe(200);
    const friends = body.sections.filter((s) => s.list === 'friends');
    const pub = body.sections.filter((s) => s.list === 'public');
    expect(friends.map((s) => s.title)[0]).toBe('برند و راه‌اندازی وب‌سایت');
    expect(pub.at(-1)?.title).toBe('تأیید نهایی راه‌اندازی');
    // The seed: 28 and 31 rows nobody added (counted in the database, so a
    // local database someone has used still passes).
    const { rows: seed } = await pool.query<{ list: string; n: number }>(
      `SELECT s.list, count(*)::int AS n FROM console_checklist_item i
         JOIN console_checklist_section s ON s.id = i.section_id
        WHERE i.created_by IS NULL GROUP BY s.list ORDER BY s.list`,
    );
    expect(seed).toEqual([
      { list: 'friends', n: 28 },
      { list: 'public', n: 31 },
    ]);
    // An item nobody has changed is as the seed left it: not started, unassigned.
    const untouched = body.sections.flatMap((s) => s.items).filter((i) => i.history.length === 0);
    expect(untouched.length).toBeGreaterThan(0);
    for (const item of untouched)
      expect(item).toMatchObject({ status: 'not_started', assignee: null });
    expect(friends.flatMap((s) => s.items).map((i) => i.title)).toContain(
      'نهایی‌سازی و اضافه‌کردن لوگوی رسمی',
    );
    expect(body.people.some((p) => p.username === `cl_${RUN}` && p.enabled)).toBe(true);
  });

  it('adds, changes, moves, notes and removes an item, each with its history and audit row', async () => {
    const before = (await call<ConsoleChecklist>('GET', '')).body;
    const section = before.sections.find((s) => s.list === 'public')!;
    const target = before.sections.find((s) => s.list === 'friends')!;

    const added = await call<ConsoleChecklistItem>('POST', '/items', {
      section_id: section.id,
      title: `  مورد آزمایشی ${RUN}  `,
    });
    expect(added.status).toBe(201);
    const id = added.body.id;
    expect(added.body).toMatchObject({
      title: `مورد آزمایشی ${RUN}`,
      status: 'not_started',
      assignee: null,
      position: Math.max(0, ...section.items.map((i) => i.position)) + 1,
    });

    const changed = await call<ConsoleChecklistItem>('PATCH', `/items/${id}`, {
      status: 'blocked',
      assignee: 'agents',
    });
    expect(changed.status).toBe(200);
    expect(changed.body).toMatchObject({ status: 'blocked', assignee: 'agents' });
    expect(changed.body.history.map((e) => [e.kind, e.previous, e.next])).toEqual([
      ['created', null, `مورد آزمایشی ${RUN}`],
      ['status', 'not_started', 'blocked'],
      ['assigned', null, 'agents'],
    ]);

    const toPerson = await call<ConsoleChecklistItem>('PATCH', `/items/${id}`, {
      assignee: other,
      title: `مورد ویرایش‌شده ${RUN}`,
      section_id: target.id,
    });
    expect(toPerson.body).toMatchObject({
      assignee: other,
      section_id: target.id,
      position: Math.max(0, ...target.items.map((i) => i.position)) + 1,
    });

    // The same values again change nothing and write nothing.
    const same = await call<ConsoleChecklistItem>('PATCH', `/items/${id}`, { assignee: other });
    expect(same.body.history).toHaveLength(toPerson.body.history.length);

    const moved = await call<ConsoleChecklistItem>('POST', `/items/${id}/move`, {
      direction: 'up',
    });
    expect(moved.body.history.at(-1)).toMatchObject({
      kind: 'moved',
      previous: String(target.items.length + 1),
      next: String(target.items.length),
    });
    const listed = (await call<ConsoleChecklist>('GET', '')).body.sections.find(
      (s) => s.id === target.id,
    )!;
    expect(listed.items.at(-2)?.id).toBe(id);

    const noted = await call<ConsoleChecklistItem>('POST', `/items/${id}/notes`, {
      body: 'یادداشت اول',
    });
    expect(noted.status).toBe(201);
    expect(noted.body.notes).toEqual([
      expect.objectContaining({ body: 'یادداشت اول', author: `Checklist ${RUN} cl_${RUN}` }),
    ]);

    const noReason = await call('DELETE', `/items/${id}`, {});
    expect(noReason.status).toBe(400);
    const removed = await call('DELETE', `/items/${id}`, { reason: 'تکراری بود' });
    expect(removed.status).toBe(204);
    const after = (await call<ConsoleChecklist>('GET', '')).body;
    expect(after.sections.flatMap((s) => s.items).some((i) => i.id === id)).toBe(false);
    expect((await call('PATCH', `/items/${id}`, { status: 'done' })).status).toBe(404);

    const { rows: audit } = await pool.query<{
      action: string;
      reason: string;
      previous: Record<string, unknown> | null;
      next: Record<string, unknown> | null;
    }>(
      `SELECT action, reason, previous, next FROM console_audit
        WHERE target_type = 'checklist_item' AND target_id = $1 ORDER BY created_at, id`,
      [id],
    );
    expect(audit.map((a) => a.action)).toEqual([
      'checklist.item_created',
      'checklist.item_changed',
      'checklist.item_changed',
      'checklist.item_moved',
      'checklist.note_added',
      'checklist.item_removed',
    ]);
    expect(audit[1]!.previous).toMatchObject({ status: 'not_started', assignee: null });
    expect(audit[1]!.next).toMatchObject({ status: 'blocked', assignee: 'agents' });
    expect(audit[5]!.reason).toBe('تکراری بود');
    expect(audit[5]!.previous).toMatchObject({ title: `مورد ویرایش‌شده ${RUN}` });
    const { rows: kept } = await pool.query(
      `SELECT deleted_at FROM console_checklist_item WHERE id = $1`,
      [id],
    );
    expect(kept[0].deleted_at).not.toBeNull();
  });

  it('refuses an assignee that is no enabled console account, a section that is none, and bad input', async () => {
    const list = (await call<ConsoleChecklist>('GET', '')).body;
    const item = list.sections[0]!.items[0]!;
    const nobody = '00000000-0000-4000-8000-000000000000';
    expect((await call('PATCH', `/items/${item.id}`, { assignee: nobody })).status).toBe(409);
    expect((await call('PATCH', `/items/${item.id}`, { section_id: nobody })).status).toBe(409);
    expect((await call('PATCH', `/items/${item.id}`, { status: 'finished' })).status).toBe(400);
    expect((await call('PATCH', `/items/${item.id}`, { assignee: 'mostafa' })).status).toBe(400);
    expect((await call('POST', '/items', { section_id: nobody, title: 'x' })).status).toBe(404);
    expect((await call('PATCH', '/items/not-an-id', { status: 'done' })).status).toBe(404);
    // Nothing a refusal did reached the item.
    const again = (await call<ConsoleChecklist>('GET', '')).body.sections[0]!.items[0]!;
    expect(again).toMatchObject({ status: item.status, assignee: item.assignee });
  });

  it('holds a person to the hourly ceiling, with Retry-After', async () => {
    const list = (await call<ConsoleChecklist>('GET', '')).body;
    const item = list.sections[0]!.items[0]!;
    const { rows } = await pool.query<{ per_hour: number }>(
      `SELECT per_hour FROM rate_limit WHERE action = 'console_checklist'`,
    );
    expect(rows[0]?.per_hour).toBe(300);
    // The earlier tests' changes this hour are already past a ceiling of one.
    try {
      await pool.query(`UPDATE rate_limit SET per_hour = 1 WHERE action = 'console_checklist'`);
      const refused = await call<ApiError>('PATCH', `/items/${item.id}`, { status: 'in_progress' });
      expect(refused.status).toBe(429);
      expect(refused.body.error).toBe('rate_limited');
      expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
    } finally {
      await pool.query(`UPDATE rate_limit SET per_hour = 300 WHERE action = 'console_checklist'`);
    }
    const untouched = (await call<ConsoleChecklist>('GET', '')).body.sections[0]!.items[0]!;
    expect(untouched.status).toBe(item.status);
  });
});
