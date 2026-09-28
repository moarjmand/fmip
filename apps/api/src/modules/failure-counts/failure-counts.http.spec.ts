import { Controller, Get, Module, ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FailureCountsReport } from '@fmip/contracts';
import { Queue, QueueEvents, Worker } from 'bullmq';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import {
  AllExceptionsFilter,
  registerAccessLog,
  requestIdFrom,
} from '../../observability/http-observability';
import { JsonLogger } from '../../observability/json-logger';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../identity/identity.service';
import { FailureCountsModule } from './failure-counts.module';
import { FailureCountsService } from './failure-counts.service';
import { FailureCountsStore } from './internal/failure-counts-store';

// The counts against the real schema, wired as `main.ts` wires them: a 5xx
// goes through the access log's hook into its hour's row under the route
// template, a failed BullMQ job into its queue's, and the administrator reads
// both. Nothing but ids is stored.
const DATABASE_URL = process.env.DATABASE_URL;
const REDIS_URL = process.env.REDIS_URL;
const ENGLAND = '00000000-0000-4000-8000-000000000101';
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);

@Controller(`fc-${RUN}`)
class BrokenController {
  @Get('boom/:id')
  boom(): never {
    throw new Error('the database ate my homework, and here is a secret body');
  }
  @Get('busy')
  busy(): never {
    throw new ServiceUnavailableException({ error: 'unavailable', message: 'Busy.' });
  }
}

@Module({ controllers: [BrokenController] })
class BrokenModule {}

function cookieValue(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return /^fmip_session=([^;]*)/.exec(header ?? '')?.[1] ?? '';
}

/** Waits for the background upserts the response hook started. */
async function settle(pool: Pool, route: string, total: number): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    const { rows } = await pool.query<{ n: string }>(
      `SELECT COALESCE(sum(count), 0)::text AS n FROM http_error_count WHERE route = $1`,
      [route],
    );
    if (Number(rows[0]?.n) >= total) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('failure counts', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let admin = '';
  let member = '';
  const queueName = `fc-test-${RUN}`;

  const get = (url: string, cookie?: string, requestId?: string) =>
    app.inject({
      method: 'GET',
      url,
      headers: {
        ...(cookie === undefined ? {} : { cookie: `fmip_session=${cookie}` }),
        ...(requestId === undefined ? {} : { 'x-request-id': requestId }),
      },
    });

  async function register(username: string): Promise<{ id: string; cookie: string }> {
    const registered = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        username,
        display_name: 'Failure Tester',
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
    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, FailureCountsModule, BrokenModule],
    })
      .overrideProvider(IDENTITY_OPTIONS)
      .useValue({
        ...DEFAULT_IDENTITY_OPTIONS,
        sessionSecret: 'test-secret-'.repeat(4),
        webBaseUrl: 'http://web.test',
        cookieSecure: false,
      })
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({
        genReqId: (request: { headers: Record<string, string | string[] | undefined> }) =>
          requestIdFrom(request.headers['x-request-id']),
      }),
      { logger: false },
    );
    const logger = new JsonLogger('json', () => undefined);
    const failures = app.get(FailureCountsService);
    registerAccessLog(app.getHttpAdapter().getInstance(), logger, (seen) => {
      void failures.recordHttpError(seen);
    });
    app.useGlobalFilters(new AllExceptionsFilter(logger));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    pool = new Pool({ connectionString: DATABASE_URL });
    const a = await register(`fc_${RUN}a`);
    const m = await register(`fc_${RUN}m`);
    admin = a.cookie;
    member = m.cookie;
    await pool.query(
      `INSERT INTO user_role (user_id, role, granted_by, reason) VALUES ($1, 'admin', $1, 'failure counts test')`,
      [a.id],
    );
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM http_error_count WHERE route LIKE $1`, [`/fc-${RUN}/%`]);
    await pool.query(`DELETE FROM job_failure_count WHERE queue = $1`, [queueName]);
    await pool.query(`DELETE FROM user_account WHERE username LIKE $1`, [`fc_${RUN}%`]);
    await pool.end();
    await app.close();
  });

  it('is closed to guests and members, and refuses a window it does not keep', async () => {
    expect((await get('/admin/health/failures')).statusCode).toBe(401);
    expect((await get('/admin/health/failures', member)).statusCode).toBe(403);
    const bad = await get('/admin/health/failures?hours=721', admin);
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ fields: { hours: expect.any(String) as string } });
  });

  it('counts 5xx per route template and hour, keeping the newest request id and no body', async () => {
    const route = `/fc-${RUN}/boom/:id`;
    expect((await get(`/fc-${RUN}/boom/1`, undefined, 'fc-first-0001')).statusCode).toBe(500);
    expect((await get(`/fc-${RUN}/boom/2`, undefined, 'fc-second-0002')).statusCode).toBe(500);
    expect((await get(`/fc-${RUN}/busy`)).statusCode).toBe(503);
    // A 4xx is not an error of ours and is not counted.
    expect((await get(`/fc-${RUN}/nothing-here`)).statusCode).toBe(404);
    await settle(pool, route, 2);
    await settle(pool, `/fc-${RUN}/busy`, 1);

    const { rows } = await pool.query<Record<string, unknown>>(
      `SELECT * FROM http_error_count WHERE route = $1`,
      [route],
    );
    expect(rows).toHaveLength(1);
    // The row is ids and numbers: nothing of the error or the request travels.
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual([
      'count',
      'hour',
      'last_at',
      'last_request_id',
      'method',
      'route',
      'status',
    ]);

    const report = (
      await get('/admin/health/failures?hours=1', admin)
    ).json() as FailureCountsReport;
    expect(report.window_hours).toBe(1);
    expect(report.retention_days).toBe(30);
    const boom = report.http_errors.find((r) => r.route === route);
    expect(boom).toMatchObject({
      method: 'GET',
      total: 2,
      by_status: { '500': 2 },
      newest: { status: 500, request_id: 'fc-second-0002' },
    });
    expect(boom?.hours).toHaveLength(1);
    expect(report.http_errors.find((r) => r.route === `/fc-${RUN}/busy`)?.by_status).toEqual({
      '503': 1,
    });
    expect(report.http_errors.some((r) => r.route.includes('nothing-here'))).toBe(false);
  });

  it('deletes buckets older than thirty days', async () => {
    const old = new Date(Date.now() - 31 * 24 * 3600 * 1000);
    old.setUTCMinutes(0, 0, 0);
    await pool.query(
      `INSERT INTO http_error_count (hour, method, route, status, count, last_request_id, last_at)
       VALUES ($1, 'GET', $2, 500, 1, 'fc-old-00001', $1)`,
      [old, `/fc-${RUN}/old`],
    );
    // A fresh service prunes on its first use.
    await new FailureCountsService(app.get(FailureCountsStore)).report(24);
    const { rows } = await pool.query(`SELECT 1 FROM http_error_count WHERE route = $1`, [
      `/fc-${RUN}/old`,
    ]);
    expect(rows).toHaveLength(0);
  });

  describe.skipIf(REDIS_URL === undefined || REDIS_URL === '')('through BullMQ', () => {
    it('counts a failed job under its queue and name', async () => {
      const connection = { url: REDIS_URL, maxRetriesPerRequest: null };
      const queue = new Queue(queueName, { connection });
      const events = new QueueEvents(queueName, { connection });
      const worker = new Worker<unknown, unknown>(
        queueName,
        () => Promise.reject(new Error('provider down, with a stack')),
        { connection },
      );
      app.get(FailureCountsService).watch(worker, queueName);
      try {
        await events.waitUntilReady();
        const job = await queue.add('live', {});
        await expect(job.waitUntilFinished(events, 20_000)).rejects.toThrow('provider down');
        for (let i = 0; i < 50; i += 1) {
          const { rows } = await pool.query(`SELECT 1 FROM job_failure_count WHERE queue = $1`, [
            queueName,
          ]);
          if (rows.length > 0) break;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        const report = (await get('/admin/health/failures', admin)).json() as FailureCountsReport;
        expect(report.job_failures.find((q) => q.queue === queueName)).toMatchObject({
          total: 1,
          by_kind: { failed: 1, stalled: 0 },
          by_job: { live: 1 },
          newest: { kind: 'failed', job: 'live', job_id: job.id },
        });
      } finally {
        await worker.close();
        await events.close();
        await queue.obliterate({ force: true });
        await queue.close();
      }
    }, 60_000);
  });
});
