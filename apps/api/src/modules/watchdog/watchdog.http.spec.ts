import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type {
  AdminAlertsReport,
  NotificationSettings,
  NotificationsResponse,
  WatchdogReport,
} from '@fmip/contracts';
import { QueueEvents } from 'bullmq';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { withTriggersOff } from '../../testing/cleanup';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../identity/identity.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AdminAlertsService, alertDedupeKey } from './admin-alerts.service';
import { PostgresAlertCursor } from './internal/alert-cursor';
import {
  LiveProbes,
  WATCHED_QUEUES,
  WATCHDOG_PROBES,
  type WatchdogProbes,
} from './internal/probes';
import type { Observations } from './internal/readings';
import { WatchdogSchedulerService } from './watchdog-scheduler.service';
import { WatchdogModule } from './watchdog.module';
import { WatchdogService } from './watchdog.service';

// The watchdog against the real schema: the endpoint is the administrator's,
// a tick writes each condition's state, and a transition -- not a tick -- is
// an event. The second half runs the ticks through BullMQ, as production does.
const DATABASE_URL = process.env.DATABASE_URL;
const REDIS_URL = process.env.REDIS_URL;
const ENGLAND = '00000000-0000-4000-8000-000000000101';
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);

function cookieValue(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return /^fmip_session=([^;]*)/.exec(header ?? '')?.[1] ?? '';
}

/** Observations a test sets; the probes answer whatever is current. */
let seen: Observations;
const quiet = (now: Date): Observations => ({
  ingest: [
    {
      job: 'live',
      provider: 'api_football',
      reason: null,
      lastCompletedAt: new Date(now.getTime() - 30_000),
      lastStartedAt: new Date(now.getTime() - 30_000),
    },
  ],
  live: { inProgress: 0, oldestChangeAt: null, behind: 0 },
  budget: { requestsToday: 10, budget: 100 },
  queues: [{ queue: 'ingestion', failedLastHour: 0 }],
  model: { configured: false },
  delivery: { email: { configured: false }, push: { configured: false } },
  dataQuality: { open: 0, sweptAt: new Date(now.getTime() - 60_000) },
  backups: {
    backup: { lastSucceededAt: null, newest: null },
    drill: { lastSucceededAt: null, newest: null },
  },
});
const probes: WatchdogProbes = { observe: () => Promise.resolve(seen) };

async function clearWatchdog(pool: Pool): Promise<void> {
  await pool.query('DELETE FROM watchdog_condition');
  await withTriggersOff(pool, async (client) => {
    await client.query('DELETE FROM watchdog_event');
  });
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('the watchdog', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let watchdog: WatchdogService;
  let admin = '';
  let member = '';
  let adminId = '';
  let memberId = '';

  const get = (cookie?: string) =>
    app.inject({
      method: 'GET',
      url: '/admin/health/watchdog',
      headers: cookie === undefined ? {} : { cookie: `fmip_session=${cookie}` },
    });

  async function register(username: string): Promise<{ id: string; cookie: string }> {
    const registered = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        username,
        display_name: 'Watchdog Tester',
        email: `${username}@example.test`,
        password: 'correct horse battery staple',
        country_id: ENGLAND,
        preferred_language: 'en',
        timezone: 'Europe/London',
        accept_rules: true,
      },
    });
    const id = (registered.json() as { user: { id: string } }).user.id;
    return { id, cookie: cookieValue(registered.headers['set-cookie']) };
  }

  beforeAll(async () => {
    process.env.MODEL_SERVICE_URL ??= 'off';
    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, WatchdogModule],
    })
      .overrideProvider(IDENTITY_OPTIONS)
      .useValue({
        ...DEFAULT_IDENTITY_OPTIONS,
        sessionSecret: 'test-secret-'.repeat(4),
        webBaseUrl: 'http://web.test',
        cookieSecure: false,
      })
      .overrideProvider(WATCHDOG_PROBES)
      .useValue(probes)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    watchdog = app.get(WatchdogService);
    pool = new Pool({ connectionString: DATABASE_URL });
    await clearWatchdog(pool);
    const a = await register(`wd_${RUN}a`);
    const m = await register(`wd_${RUN}m`);
    admin = a.cookie;
    member = m.cookie;
    adminId = a.id;
    memberId = m.id;
    await pool.query(
      `INSERT INTO user_role (user_id, role, granted_by, reason) VALUES ($1, 'admin', $1, 'watchdog test')`,
      [a.id],
    );
  });

  afterAll(async () => {
    await clearWatchdog(pool);
    await pool.query(`DELETE FROM user_account WHERE username LIKE $1`, [`wd_${RUN}%`]);
    await pool.end();
    await app.close();
  });

  it('is closed to guests and to members without the admin role', async () => {
    expect((await get()).statusCode).toBe(401);
    expect((await get(member)).statusCode).toBe(403);
  });

  it('says it has never run before the first tick, rather than listing nothing as fine', async () => {
    const report = (await get(admin)).json() as WatchdogReport;
    expect(report).toMatchObject({ checked_at: null, freshness: 'never_run', conditions: [] });
  });

  it('a tick states every condition with its threshold, and a bad first reading is raised once', async () => {
    const now = new Date();
    seen = {
      ...quiet(now),
      live: { inProgress: 2, oldestChangeAt: new Date(now.getTime() - 45 * 60_000), behind: 1 },
    };
    const first = await watchdog.tick(now);
    expect(first?.events.map((e) => [e.condition, e.kind])).toEqual([['live_feed', 'raised']]);
    // The same state a minute later is not news.
    const second = await watchdog.tick(new Date(now.getTime() + 60_000));
    expect(second?.events).toEqual([]);

    const report = (await get(admin)).json() as WatchdogReport;
    expect(report.freshness).toBe('current');
    const live = report.conditions.find((c) => c.key === 'live_feed');
    const raised = report.events.find((e) => e.kind === 'raised');
    expect(live).toMatchObject({
      level: 'failing',
      since: now.toISOString(),
      threshold: { unit: 'seconds', degraded: 1200, failing: 2400 },
      incident: raised?.id,
    });
    expect(raised).toMatchObject({
      alert: true,
      incident: raised?.id,
      from: 'unknown',
      to: 'failing',
    });
    expect(report.conditions.find((c) => c.key === 'model_service')).toMatchObject({
      level: 'unknown',
      note: 'no model service is configured for this deployment',
    });
    expect(report.conditions.find((c) => c.key === 'backup')?.level).toBe('unknown');
    expect(report.events).toHaveLength(1);
  });

  it('the real probes read the schema: every statement they run is valid SQL', async () => {
    const observed = await app.get(LiveProbes).observe(new Date());
    expect(observed.live).toMatchObject({ inProgress: expect.any(Number) as number });
    expect(observed.delivery).not.toHaveProperty('unreadable');
    expect(observed.ingest).not.toHaveProperty('unreadable');
    expect(observed.dataQuality).not.toHaveProperty('unreadable');
    expect(observed.backups).not.toHaveProperty('unreadable');
    expect(observed.queues.map((q) => q.queue)).toEqual(WATCHED_QUEUES);
  });

  it('a raised event cannot be rewritten', async () => {
    await expect(pool.query(`UPDATE watchdog_event SET note = 'x'`)).rejects.toThrow(/immutable/);
  });

  describe.skipIf(REDIS_URL === undefined || REDIS_URL === '')('through the queue', () => {
    const queueName = `watchdog-test-${RUN}`;
    let events: QueueEvents;

    beforeAll(async () => {
      events = new QueueEvents(queueName, { connection: { url: REDIS_URL } });
      await events.waitUntilReady();
    });

    afterAll(async () => {
      await events.close();
    });

    it('ticks from the queue: a recovery closes the incident, and the alerts are one pair', async () => {
      const queue = await app
        .get(WatchdogSchedulerService)
        .start(REDIS_URL as string, { queueName, schedule: false });
      const tickOnce = async (): Promise<void> => {
        const job = await queue.add('watch', {});
        await job.waitUntilFinished(events, 20_000);
      };

      const [before] = await watchdog.alertsAfter(0);
      // Still failing: no event.
      await tickOnce();
      // Recovered.
      seen = quiet(new Date());
      await tickOnce();
      // And quiet again: no event.
      await tickOnce();

      const alerts = await watchdog.alertsAfter(0);
      expect(alerts.map((a) => [a.condition, a.kind])).toEqual([
        ['live_feed', 'raised'],
        ['live_feed', 'recovered'],
      ]);
      expect(alerts[1]?.incident).toBe(before?.id);
      expect(await watchdog.alertsAfter(alerts[1]?.id ?? 0)).toEqual([]);

      const report = (await get(admin)).json() as WatchdogReport;
      expect(report.conditions.find((c) => c.key === 'live_feed')).toMatchObject({
        level: 'ok',
        incident: null,
      });
      // The worker delivered both alerts to the administrator (T-802).
      const delivered = await pool.query<{ subject_id: string }>(
        `SELECT subject_id FROM notification WHERE user_id = $1 AND kind = 'system_alert'`,
        [adminId],
      );
      expect(delivered.rows.map((r) => Number(r.subject_id)).sort((x, y) => x - y)).toEqual(
        expect.arrayContaining(alerts.map((a) => a.id)),
      );
      await queue.obliterate({ force: true });
    }, 60_000);
  });

  describe('alerts to administrators (T-802)', () => {
    const alertsOf = (userId: string) =>
      pool
        .query<{ subject_id: string; n: string }>(
          `SELECT subject_id, count(*)::text AS n FROM notification
            WHERE user_id = $1 AND kind = 'system_alert' GROUP BY subject_id`,
          [userId],
        )
        .then(({ rows }) => new Map(rows.map((r) => [Number(r.subject_id), Number(r.n)])));

    /** A clock that only moves forward, ahead of the ticks above. */
    let clock = Date.now() + 10 * 60_000;
    const later = (): Date => {
      clock += 60_000;
      return new Date(clock);
    };

    /** One incident: a raised and a recovered event, written by real ticks. */
    async function incident(): Promise<number[]> {
      // Quiet first, whatever the tests above left open.
      let now = later();
      seen = quiet(now);
      await watchdog.tick(now);
      now = later();
      seen = {
        ...quiet(now),
        live: { inProgress: 1, oldestChangeAt: new Date(now.getTime() - 50 * 60_000), behind: 1 },
      };
      const raised = await watchdog.tick(now);
      now = later();
      seen = quiet(now);
      const recovered = await watchdog.tick(now);
      return [...(raised?.events ?? []), ...(recovered?.events ?? [])]
        .filter((e) => e.alert)
        .map((e) => e.id);
    }

    it('the alerts report is closed to guests and members', async () => {
      const at = (cookie?: string) =>
        app.inject({
          method: 'GET',
          url: '/admin/health/alerts',
          headers: cookie === undefined ? {} : { cookie: `fmip_session=${cookie}` },
        });
      expect((await at()).statusCode).toBe(401);
      expect((await at(member)).statusCode).toBe(403);
      expect((await at(admin)).statusCode).toBe(200);
    });

    it('concurrent deliveries write each alert once for every administrator', async () => {
      const ids = await incident();
      expect(ids).toHaveLength(2);
      const alerts = app.get(AdminAlertsService);
      const runs = await Promise.all([alerts.deliver(), alerts.deliver(), alerts.deliver()]);
      // Whoever ran, the two events were delivered once between them.
      expect(runs.reduce((sum, run) => sum + (run?.delivered ?? 0), 0)).toBe(2);
      const got = await alertsOf(adminId);
      for (const id of ids) expect(got.get(id)).toBe(1);
      // A member without the role is told nothing.
      expect((await alertsOf(memberId)).size).toBe(0);
      // Again: nothing new.
      expect((await alerts.deliver())?.delivered).toBe(0);
    });

    it('a second delivery holding the lock skips rather than reading the same cursor', async () => {
      const cursor = app.get(PostgresAlertCursor);
      let release: () => void = () => undefined;
      const held = cursor.withCursor(
        () =>
          new Promise<string>((resolve) => {
            release = () => resolve('first');
          }),
      );
      // Give the first transaction time to take the lock.
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(await cursor.withCursor(() => Promise.resolve('second'))).toBeNull();
      release();
      expect(await held).toBe('first');
    });

    it('a delivery interrupted before its commit is repeated without a second notification', async () => {
      const ids = await incident();
      // As if a run wrote the first alert and died before moving the cursor.
      await app.get(NotificationsService).emit({
        userId: adminId,
        kind: 'system_alert',
        subjectType: 'watchdog_event',
        subjectId: String(ids[0]),
        dedupeKey: alertDedupeKey(ids[0] ?? 0),
      });
      await app.get(AdminAlertsService).deliver();
      const got = await alertsOf(adminId);
      for (const id of ids) expect(got.get(id)).toBe(1);
    });

    it('ignores quiet hours, says what changed, and opens the System page', async () => {
      await pool.query(
        `INSERT INTO quiet_hours (user_id, starts_at, ends_at)
         SELECT $1, ((now() AT TIME ZONE 'Europe/London') - interval '1 hour')::time,
                    ((now() AT TIME ZONE 'Europe/London') + interval '1 hour')::time
         ON CONFLICT (user_id) DO UPDATE SET starts_at = EXCLUDED.starts_at, ends_at = EXCLUDED.ends_at`,
        [adminId],
      );
      const [raised] = await incident();
      await app.get(AdminAlertsService).deliver();
      const inbox = await app.inject({
        method: 'GET',
        url: '/me/notifications',
        headers: { cookie: `fmip_session=${admin}` },
      });
      const found = (inbox.json() as NotificationsResponse).notifications.find(
        (n) => n.kind === 'system_alert' && n.subject_id === String(raised),
      );
      expect(found).toMatchObject({
        subject_type: 'watchdog_event',
        held_reason: null,
        headline: expect.stringMatching(/^System alert: live_feed is failing/) as string,
      });
      await pool.query(`DELETE FROM quiet_hours WHERE user_id = $1`, [adminId]);
    });

    it('the kind is in an administrator’s settings and nobody else’s', async () => {
      const kinds = async (cookie: string) =>
        (
          (
            await app.inject({
              method: 'GET',
              url: '/me/notification-settings',
              headers: { cookie: `fmip_session=${cookie}` },
            })
          ).json() as NotificationSettings
        ).preferences.map((p) => p.kind);
      expect(await kinds(admin)).toContain('system_alert');
      expect(await kinds(member)).not.toContain('system_alert');
    });

    it('the report says the inbox is the only channel, and never counts a send that was not', async () => {
      const report = (
        await app.inject({
          method: 'GET',
          url: '/admin/health/alerts',
          headers: { cookie: `fmip_session=${admin}` },
        })
      ).json() as AdminAlertsReport;
      expect(report.channels).toEqual({ push: 'absent', email: 'absent', in_product_only: true });
      expect(report.administrators).toBeGreaterThanOrEqual(1);
      expect(report.pending).toBe(0);
      expect(report.alerts.length).toBeGreaterThanOrEqual(2);
      const newest = report.alerts[0];
      expect(newest?.inbox).toBeGreaterThanOrEqual(1);
      // With no channel nothing is claimed, so nothing is sent: it is pending in the inbox only.
      expect(newest?.push.sent).toBe(0);
      expect(newest?.email.sent).toBe(0);
      expect(report.cursor.last_event_id).toBe(newest?.event.id);
      expect(report.cursor.advanced_at).not.toBeNull();
    });
  });

  it('reads what the backup scripts recorded in backup_run (T-805)', async () => {
    // Stamped ahead of now, so they are the newest rows whatever else a shared
    // database holds (a developer's own backup runs, say).
    const base = Date.now();
    const ahead = (hours: number): Date => new Date(base + hours * 3600_000);
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO backup_run (kind, started_at, finished_at, ok, subject, detail) VALUES
         ('backup', $1, $1, true, 'fmip-a.dump', 'local only'),
         ('backup', $2, $2, false, 'fmip-b.dump', 'backup.sh stopped with status 1 during: pg_dump'),
         ('restore_drill', $1, $1, true, 'fmip-a.dump', 'offsite; 1 migrations'),
         ('restore_drill', $2, $2, false, 'fmip-b.dump', 'offsite; row counts differ from the manifest')
       RETURNING id`,
      [ahead(1), ahead(2)],
    );
    try {
      const observed = await app.get(LiveProbes).observe(new Date());
      if ('unreadable' in observed.backups) throw new Error(observed.backups.unreadable);
      expect(observed.backups.backup.lastSucceededAt?.getTime()).toBe(ahead(1).getTime());
      expect(observed.backups.backup.newest).toMatchObject({
        ok: false,
        detail: expect.stringMatching(/pg_dump/) as string,
      });
      expect(observed.backups.drill.lastSucceededAt?.getTime()).toBe(ahead(1).getTime());
      expect(observed.backups.drill.newest?.ok).toBe(false);

      seen = { ...quiet(new Date()), backups: observed.backups };
      await clearWatchdog(pool);
      await watchdog.tick(new Date());
      const report = await watchdog.report(new Date());
      // The newest backup failed: degraded at once. The newest drill failed: failing.
      expect(report.conditions.find((c) => c.key === 'backup')).toMatchObject({
        level: 'degraded',
      });
      expect(report.conditions.find((c) => c.key === 'restore_drill')).toMatchObject({
        level: 'failing',
        threshold: { unit: 'seconds', degraded: 35 * 86400, failing: 70 * 86400 },
      });
      expect(report.events.find((e) => e.condition === 'restore_drill')).toMatchObject({
        kind: 'raised',
        alert: true,
      });
    } finally {
      await pool.query('DELETE FROM backup_run WHERE id = ANY($1::bigint[])', [
        rows.map((r) => r.id),
      ]);
      await clearWatchdog(pool);
    }
  }, 20_000);
});
