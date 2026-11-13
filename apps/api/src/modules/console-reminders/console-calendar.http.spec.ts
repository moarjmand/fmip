import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type {
  ConsoleCalendar,
  ConsoleCalendarEvent,
  ConsoleCalendarPush,
  ConsoleRequestDetail,
} from '@fmip/contracts';
import { isoToDay, wallClock } from '@fmip/contracts/console';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { withTriggersOff } from '../../testing/cleanup';
import { CONSOLE_OPTIONS } from '../agents-console/agents-console.controller';
import { ConsoleRequestEvents } from '../agents-console/console-request-events.service';
import { PostgresCalendarStore } from '../agents-console/internal/calendar-store';
import { consoleTokenText } from '../agents-console/internal/console-rules';
import { PostgresConsoleStore } from '../agents-console/internal/console-store';
import { OUTBOUND_DELIVERY } from '../delivery/delivery.port';
import { PushServiceError, WebPushChannel } from '../delivery/internal/webpush';
import { hashPassword, hashToken, newToken } from '../identity/identity.service';
import { ConsoleRemindersModule } from './console-reminders.module';
import { ConsoleReminders } from './console-reminders.service';
import { ConsoleRequestAlerts } from './console-request-alerts.service';

/**
 * T-1788 (D-391) against the real schema: the calendar's routes refuse
 * without a console session, write each change with its audit row and the
 * previous value, keep a removed event out of the page; the import adds an
 * event once and a subscription by key; a browser is switched on; and the
 * minute run sends a due reminder once, by a scripted push service, and
 * removes a device the service says is gone.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const SECRET = 'console-calendar-secret-'.repeat(3);
const SUB = `cal-${RUN}`;
const GOOD = `https://push.example/${RUN}/good`;
const GONE = `https://push.example/${RUN}/gone`;
const KEYS = { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) };

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('console calendar', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let cookie = '';
  let userId = '';
  const username = `cal_${RUN}`;
  const pushed: { endpoint: string; payload: { title: string; body: string; url: string } }[] = [];

  const call = async <T>(
    method: string,
    url: string,
    body?: unknown,
    who: string | null = cookie,
  ) => {
    const response = await app.inject({
      method: method as 'GET',
      url,
      headers: who === null ? {} : { cookie: `fmip_console=${who}` },
      ...(body === undefined ? {} : { payload: body as object }),
    });
    return {
      status: response.statusCode,
      body: (response.body === '' ? null : response.json()) as T,
    };
  };

  beforeAll(async () => {
    const channel = new WebPushChannel(
      'BPUBLICKEY',
      null as never,
      async (subscription, payload) => {
        if (subscription.endpoint === GONE) throw new PushServiceError(410, 'gone');
        pushed.push({ endpoint: subscription.endpoint, payload: JSON.parse(payload) });
      },
    );
    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, ConsoleRemindersModule],
    })
      .overrideProvider(CONSOLE_OPTIONS)
      .useValue({ secret: SECRET, cookieSecure: false })
      .overrideProvider(OUTBOUND_DELIVERY)
      .useValue({ email: null, push: channel })
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    pool = new Pool({ connectionString: DATABASE_URL });

    const store = app.get(PostgresConsoleStore);
    const invitation = newToken();
    await store.createInvitation(
      hashToken(consoleTokenText(invitation), SECRET),
      `Cal ${RUN}`,
      new Date(Date.now() + 3_600_000),
    );
    const accepted = await store.acceptInvitation(
      hashToken(consoleTokenText(invitation), SECRET),
      username,
      await hashPassword('a perfectly fine passphrase'),
    );
    if (accepted.kind !== 'ok') throw new Error(`invitation: ${accepted.kind}`);
    userId = accepted.user.id;
    cookie = newToken();
    await store.createSession(userId, hashToken(consoleTokenText(cookie), SECRET));
  }, 60_000);

  afterAll(async () => {
    await withTriggersOff(pool, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `SELECT id FROM console_event WHERE created_by = $1`,
        [userId],
      );
      const events = rows.map((r) => r.id);
      await client.query(
        `DELETE FROM console_audit WHERE actor_id = $1 OR target_id = ANY($2::text[]) OR target_id = $3`,
        [userId, events, SUB],
      );
      await client.query(`DELETE FROM console_event WHERE id = ANY($1::uuid[])`, [events]);
      await client.query(`DELETE FROM console_subscription WHERE key = $1`, [SUB]);
      await client.query(`DELETE FROM console_invite WHERE used_by = $1 OR display_name = $2`, [
        userId,
        `Cal ${RUN}`,
      ]);
    });
    await pool.query(`DELETE FROM console_user WHERE id = $1`, [userId]);
    await pool.end();
    await app.close();
  });

  it('refuses without a console session', async () => {
    expect((await call('GET', '/console/calendar', undefined, null)).status).toBe(401);
    expect(
      (await call('POST', '/console/calendar/events', { title: 'x', date: '2026-11-09' }, null))
        .status,
    ).toBe(401);
    expect((await call('GET', '/console/calendar/push', undefined, null)).status).toBe(401);
  });

  it('adds, edits and removes an event, each audited with what it was', async () => {
    expect(
      (await call('POST', '/console/calendar/events', { title: '', date: '2026-11-09' })).status,
    ).toBe(400);
    const created = await call<ConsoleCalendarEvent>('POST', '/console/calendar/events', {
      title: `Weekly ${RUN}`,
      date: '2026-11-09',
      time: '18:30',
      repeat: 'weekly',
      remind_minutes: 60,
      color: 'teal',
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      title: `Weekly ${RUN}`,
      date: '2026-11-09',
      time: '18:30',
      repeat: 'weekly',
      basis: 'j',
      remind_minutes: 60,
      color: 'teal',
      updated_by: `Cal ${RUN}`,
    });
    const id = created.body.id;

    const changed = await call<ConsoleCalendarEvent>('PATCH', `/console/calendar/events/${id}`, {
      title: `Weekly ${RUN}`,
      date: '2026-11-10',
      time: null,
      repeat: 'weekly',
      repeat_until: '2026-12-31',
      remind_minutes: null,
      color: 'teal',
      note: 'moved to Tuesday',
    });
    expect(changed.status).toBe(200);
    expect(changed.body).toMatchObject({
      date: '2026-11-10',
      time: null,
      repeat_until: '2026-12-31',
      note: 'moved to Tuesday',
    });

    const page = await call<ConsoleCalendar>('GET', '/console/calendar');
    expect(page.body.events.map((e) => e.id)).toContain(id);
    expect(page.body.time_zone).toBe('Asia/Tehran');
    expect(isoToDay(page.body.today)).not.toBeNull();

    expect((await call('DELETE', `/console/calendar/events/${id}`)).status).toBe(204);
    const after = await call<ConsoleCalendar>('GET', '/console/calendar');
    expect(after.body.events.map((e) => e.id)).not.toContain(id);
    expect(
      (await call('PATCH', `/console/calendar/events/${id}`, { title: 'x', date: '2026-11-09' }))
        .status,
    ).toBe(404);
    expect((await call('DELETE', '/console/calendar/events/not-an-id')).status).toBe(404);

    const { rows } = await pool.query<{ action: string; previous: { date: string } | null }>(
      `SELECT action, previous FROM console_audit WHERE target_id = $1 ORDER BY created_at`,
      [id],
    );
    expect(rows.map((r) => r.action)).toEqual([
      'calendar.event_created',
      'calendar.event_changed',
      'calendar.event_deleted',
    ]);
    expect(rows[1]?.previous?.date).toBe('2026-11-09');
    expect(rows[2]?.previous?.date).toBe('2026-11-10');
  });

  it('refuses an event for a subscription that does not exist', async () => {
    const refused = await call('POST', '/console/calendar/events', {
      title: 'x',
      date: '2026-11-09',
      subscription_key: `none-${RUN}`,
    });
    expect(refused.status).toBe(409);
  });

  it('imports an event once and a subscription by key', async () => {
    const store = app.get(PostgresCalendarStore);
    const me = { id: userId, username, display_name: `Cal ${RUN}` };
    const sub = {
      key: SUB,
      position: 1,
      name: 'Test service',
      purpose: '',
      plan: 'Pro',
      price: '',
      started: '',
      renewal: '',
      renew_on: '2026-11-21',
      status: 'active' as const,
      status_note: '',
      limits: '',
      payer: '',
      manage_url: 'https://example.com',
      manage_label: '',
      manage_note: '',
      source: '',
      paid: true,
    };
    const event = {
      source_ref: `claude-board:events/${RUN}`,
      title: `Renew ${RUN}`,
      date: '2026-11-21',
      time: '09:00',
      repeat: 'monthly' as const,
      basis: 'g' as const,
      repeat_until: null,
      remind_minutes: 1440,
      note: '',
      color: 'pink' as const,
      subscription_key: SUB,
    };
    expect(await store.importCalendar([sub], [event], me)).toEqual({
      subscriptions: { added: 1, changed: 0, same: 0 },
      events: { added: 1, skipped: 0 },
    });
    expect(await store.importCalendar([sub], [event], me)).toEqual({
      subscriptions: { added: 0, changed: 0, same: 1 },
      events: { added: 0, skipped: 1 },
    });
    expect(await store.importCalendar([{ ...sub, plan: 'Ultra' }], [], me)).toEqual({
      subscriptions: { added: 0, changed: 1, same: 0 },
      events: { added: 0, skipped: 0 },
    });
    const page = await call<ConsoleCalendar>('GET', '/console/calendar');
    expect(page.body.subscriptions.find((s) => s.key === SUB)).toMatchObject({
      plan: 'Ultra',
      renew_on: '2026-11-21',
      paid: true,
    });
    expect(page.body.events.filter((e) => e.title === `Renew ${RUN}`)).toHaveLength(1);
  });

  it('switches a browser on, and sends a due reminder once', async () => {
    const state = await call<ConsoleCalendarPush>('GET', '/console/calendar/push');
    expect(state.body).toEqual({
      state: 'configured',
      public_key: 'BPUBLICKEY',
      devices: 0,
      request_alerts: false,
    });
    expect(
      (await call('POST', '/console/calendar/push', { endpoint: 'http://x', keys: KEYS })).status,
    ).toBe(400);
    expect(
      (await call('POST', '/console/calendar/push', { endpoint: GOOD, keys: KEYS })).status,
    ).toBe(204);
    expect(
      (await call('POST', '/console/calendar/push', { endpoint: GONE, keys: KEYS })).status,
    ).toBe(204);
    expect((await call<ConsoleCalendarPush>('GET', '/console/calendar/push')).body.devices).toBe(2);

    // An event a quarter of an hour after "now", reminded fifteen minutes before: due two minutes ago.
    const now = new Date();
    const at = wallClock(new Date(now.getTime() + 13 * 60000));
    const time = `${String(Math.floor(at.minutes / 60)).padStart(2, '0')}:${String(at.minutes % 60).padStart(2, '0')}`;
    const created = await call<ConsoleCalendarEvent>('POST', '/console/calendar/events', {
      title: `Due ${RUN}`,
      date: at.date,
      time,
      remind_minutes: 15,
    });
    // Written before its reminder time, as it would have been.
    await withTriggersOff(pool, async (client) => {
      await client.query(
        `UPDATE console_event SET updated_at = now() - interval '1 hour' WHERE id = $1`,
        [created.body.id],
      );
    });

    const reminders = app.get(ConsoleReminders);
    await reminders.run(now);
    const mine = pushed.filter((p) => p.payload.title === `Due ${RUN}`);
    expect(mine.map((p) => p.endpoint)).toEqual([GOOD]);
    expect(mine[0]?.payload.url).toBe(`calendar?day=${at.date}`);
    // Claimed: the next minute sends nothing again; the gone device was removed.
    await reminders.run(new Date(now.getTime() + 60000));
    expect(pushed.filter((p) => p.payload.title === `Due ${RUN}`)).toHaveLength(1);
    expect((await call<ConsoleCalendarPush>('GET', '/console/calendar/push')).body.devices).toBe(1);

    const page = await call<ConsoleCalendar>('GET', '/console/calendar');
    expect(page.body.recent_reminders.find((r) => r.event_id === created.body.id)).toMatchObject({
      occurs_on: at.date,
      delivered: 1,
    });

    const test = await call<{ devices: number; delivered: number }>(
      'POST',
      '/console/calendar/push/test',
    );
    expect(test.body).toEqual({ devices: 1, delivered: 1 });
    expect((await call('DELETE', '/console/calendar/push', { endpoint: GOOD })).status).toBe(204);
    expect((await call('DELETE', '/console/calendar/push', { endpoint: GOOD })).status).toBe(404);
  });
});

// --- New teammate requests by browser notification (T-1832, D-425) ---------------
//
// In this file, not its own: the reminder run above sends to every console
// browser in the database, so the two must not run side by side.

/**
 * New teammate requests by browser notification, against Postgres (T-1832,
 * D-425): the opt-in route (session, validation, the state, the audit with
 * the value before), and a request filed over HTTP reaching every other
 * person who switched it on, never the filer, never one who did not, with
 * a gone browser removed; the request is answered whatever the push does.
 */

const ARUN = `a${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const ASECRET = 'console-alerts-secret-'.repeat(3);
const endpoint = (who: string) => `https://push.example/${ARUN}/${who}`;

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('new-request alerts', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  const people: Record<'filer' | 'mate' | 'quiet' | 'gone', { id: string; cookie: string }> =
    {} as never;
  const pushed: { endpoint: string; payload: { title: string; body: string; url: string } }[] = [];
  let failPush = false;

  const call = async <T>(method: string, url: string, body: unknown, who: string | null) => {
    const response = await app.inject({
      method: method as 'GET',
      url,
      headers: who === null ? {} : { cookie: `fmip_console=${who}` },
      ...(body === undefined ? {} : { payload: body as object }),
    });
    return {
      status: response.statusCode,
      body: (response.body === '' ? null : response.json()) as T,
    };
  };

  /** The asynchronous send has settled: the pushed list stops growing. */
  /**
   * Files a request over HTTP. The agents console's spec lowers the shared
   * hourly ceiling to 1 for a moment while it runs beside this one, so a 429
   * here is that moment, waited out, never this feature's answer.
   */
  const file = async (body: Record<string, unknown>, who: string) => {
    for (let tries = 0; ; tries += 1) {
      const answer = await call<ConsoleRequestDetail>('POST', '/console/requests', body, who);
      if (answer.status !== 429 || tries >= 40) return answer;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  };

  /** The last request's notifications, sent apart from its answer: the test waits for them. */
  let lastSend: Promise<unknown> = Promise.resolve();
  const settled = () => lastSend;

  beforeAll(async () => {
    const channel = new WebPushChannel(
      'BPUBLICKEY',
      null as never,
      async (subscription, payload) => {
        if (failPush) throw new Error('push service down');
        if (subscription.endpoint === endpoint('gone')) throw new PushServiceError(410, 'gone');
        pushed.push({ endpoint: subscription.endpoint, payload: JSON.parse(payload) });
      },
    );
    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, ConsoleRemindersModule],
    })
      .overrideProvider(CONSOLE_OPTIONS)
      .useValue({ secret: ASECRET, cookieSecure: false })
      .overrideProvider(OUTBOUND_DELIVERY)
      .useValue({ email: null, push: channel })
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    pool = new Pool({ connectionString: DATABASE_URL });
    // The real sender, behind a listener that keeps its promise for `settled`.
    const alerts = app.get(ConsoleRequestAlerts);
    app.get(ConsoleRequestEvents).listen((request) => {
      lastSend = alerts.send(request);
      return lastSend;
    });

    const store = app.get(PostgresConsoleStore);
    for (const who of ['filer', 'mate', 'quiet', 'gone'] as const) {
      const invitation = newToken();
      await store.createInvitation(
        hashToken(consoleTokenText(invitation), ASECRET),
        `Alert ${who} ${ARUN}`,
        new Date(Date.now() + 3_600_000),
      );
      const accepted = await store.acceptInvitation(
        hashToken(consoleTokenText(invitation), ASECRET),
        `al_${who}_${ARUN}`,
        await hashPassword('a perfectly fine passphrase'),
      );
      if (accepted.kind !== 'ok') throw new Error(`invitation: ${accepted.kind}`);
      const cookie = newToken();
      await store.createSession(accepted.user.id, hashToken(consoleTokenText(cookie), ASECRET));
      people[who] = { id: accepted.user.id, cookie };
      // Every one of them has a browser switched on for the calendar's reminders.
      const added = await call(
        'POST',
        '/console/calendar/push',
        { endpoint: endpoint(who), keys: KEYS },
        cookie,
      );
      if (added.status !== 204) throw new Error(`device: ${added.status}`);
    }
  }, 60_000);

  afterAll(async () => {
    const ids = Object.values(people).map((p) => p.id);
    await withTriggersOff(pool, async (client) => {
      await client.query(
        `DELETE FROM console_request_event WHERE request_id IN
           (SELECT id FROM console_request WHERE created_by = ANY($1::uuid[]))`,
        [ids],
      );
      await client.query(`DELETE FROM console_request WHERE created_by = ANY($1::uuid[])`, [ids]);
      await client.query(`DELETE FROM console_audit WHERE actor_id = ANY($1::uuid[])`, [ids]);
      await client.query(`DELETE FROM console_invite WHERE used_by = ANY($1::uuid[])`, [ids]);
    });
    await pool.query(`DELETE FROM console_user WHERE id = ANY($1::uuid[])`, [ids]);
    await pool.end();
    await app.close();
  });

  it('switches only with a session and a true or false', async () => {
    expect((await call('POST', '/console/calendar/push/requests', { on: true }, null)).status).toBe(
      401,
    );
    for (const body of [{}, { on: 'yes' }, { on: 1 }])
      expect(
        (await call('POST', '/console/calendar/push/requests', body, people.mate.cookie)).status,
      ).toBe(400);
  });

  it('is off until a person switches it on, and the switch is audited with the value before', async () => {
    const state = await call<ConsoleCalendarPush>(
      'GET',
      '/console/calendar/push',
      undefined,
      people.mate.cookie,
    );
    expect(state.body.request_alerts).toBe(false);
    for (const who of ['filer', 'mate', 'gone'] as const)
      expect(
        (await call('POST', '/console/calendar/push/requests', { on: true }, people[who].cookie))
          .status,
      ).toBe(204);
    expect(
      (
        await call<ConsoleCalendarPush>(
          'GET',
          '/console/calendar/push',
          undefined,
          people.mate.cookie,
        )
      ).body.request_alerts,
    ).toBe(true);
    const { rows } = await pool.query<{ action: string; previous: unknown; next: unknown }>(
      `SELECT action, previous, next FROM console_audit WHERE actor_id = $1 AND action LIKE 'requests.%'`,
      [people.mate.id],
    );
    expect(rows).toEqual([
      {
        action: 'requests.alerts_on',
        previous: { request_alerts: false },
        next: { request_alerts: true },
      },
    ]);
    // Switching on again changes nothing and writes nothing.
    await call('POST', '/console/calendar/push/requests', { on: true }, people.mate.cookie);
    const again = await pool.query(
      `SELECT 1 FROM console_audit WHERE actor_id = $1 AND action LIKE 'requests.%'`,
      [people.mate.id],
    );
    expect(again.rowCount).toBe(1);
  });

  it('tells everyone else who switched it on, never the filer, and drops a gone browser', async () => {
    pushed.length = 0;
    const created = await file(
      { title: `Two conferences ${ARUN}\nsecond line`, body: 'private detail' },
      people.filer.cookie,
    );
    expect(created.status).toBe(201);
    await settled();
    expect(pushed.map((p) => p.endpoint)).toEqual([endpoint('mate')]);
    expect(pushed[0]!.payload).toMatchObject({
      title: `درخواست تازه از Alert filer ${ARUN}`,
      body: `Two conferences ${ARUN}`,
      url: `requests#r-${created.body.id}`,
    });
    expect(JSON.stringify(pushed[0]!.payload)).not.toContain('private detail');
    // The gone browser (410) was removed; the others stay.
    const { rows } = await pool.query<{ endpoint: string }>(
      `SELECT endpoint FROM console_push_device WHERE user_id = ANY($1::uuid[]) ORDER BY endpoint`,
      [Object.values(people).map((p) => p.id)],
    );
    expect(rows.map((r) => r.endpoint)).toEqual(
      [endpoint('filer'), endpoint('mate'), endpoint('quiet')].sort(),
    );
  });

  it('stops after a person switches it off, and keeps their browser for reminders', async () => {
    await call('POST', '/console/calendar/push/requests', { on: false }, people.mate.cookie);
    pushed.length = 0;
    await file({ title: `Another ${ARUN}` }, people.filer.cookie);
    await settled();
    expect(pushed).toEqual([]);
    expect(
      (
        await call<ConsoleCalendarPush>(
          'GET',
          '/console/calendar/push',
          undefined,
          people.mate.cookie,
        )
      ).body.devices,
    ).toBe(1);
  });

  it('answers the request even when every push fails', async () => {
    await call('POST', '/console/calendar/push/requests', { on: true }, people.mate.cookie);
    failPush = true;
    try {
      const created = await file({ title: `Push down ${ARUN}` }, people.filer.cookie);
      expect(created.status).toBe(201);
      await settled();
    } finally {
      failPush = false;
    }
  });
});
