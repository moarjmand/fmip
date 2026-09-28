import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { WatchdogReport } from '@fmip/contracts';
import { QueueEvents } from 'bullmq';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { withTriggersOff } from '../../testing/cleanup';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../identity/identity.service';
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
  backup: undefined,
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
      await queue.obliterate({ force: true });
    }, 60_000);
  });
});
