import { EventEmitter } from 'node:events';
import type { Worker } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';
import { FailureCountsService, UNNAMED_JOB } from './failure-counts.service';
import type { FailureCountsStore } from './internal/failure-counts-store';
import {
  DEFAULT_WINDOW_HOURS,
  type HttpErrorRow,
  type JobFailureRow,
  MAX_WINDOW_HOURS,
  hourOf,
  queueFailures,
  retentionCutoff,
  routeErrors,
  routeKey,
  windowHours,
  windowStart,
} from './internal/summarise';

const at = (iso: string): Date => new Date(iso);

describe('the buckets', () => {
  it('counts a failure in its UTC hour', () => {
    expect(hourOf(at('2026-09-28T13:59:59.999Z')).toISOString()).toBe('2026-09-28T13:00:00.000Z');
    expect(hourOf(at('2026-09-28T14:00:00.000Z')).toISOString()).toBe('2026-09-28T14:00:00.000Z');
    // An offset changes nothing: the bucket is the UTC hour.
    expect(hourOf(at('2026-09-28T17:45:00+03:30')).toISOString()).toBe('2026-09-28T14:00:00.000Z');
  });

  it('a window of n hours starts n - 1 hours before the current one', () => {
    const now = at('2026-09-28T13:20:00Z');
    expect(windowStart(now, 1).toISOString()).toBe('2026-09-28T13:00:00.000Z');
    expect(windowStart(now, 24).toISOString()).toBe('2026-09-27T14:00:00.000Z');
  });

  it('keeps thirty days', () => {
    expect(retentionCutoff(at('2026-09-28T13:20:00Z')).toISOString()).toBe(
      '2026-08-29T13:00:00.000Z',
    );
  });

  it('reads ?hours= as a whole number from 1 to the retention, 24 when absent', () => {
    expect(windowHours(undefined)).toBe(DEFAULT_WINDOW_HOURS);
    expect(windowHours('')).toBe(DEFAULT_WINDOW_HOURS);
    expect(windowHours('1')).toBe(1);
    expect(windowHours(['6', '12'])).toBe(6);
    expect(windowHours(String(MAX_WINDOW_HOURS))).toBe(720);
    for (const bad of ['0', '721', '-1', '1.5', 'day', '99999'])
      expect(windowHours(bad)).toBeNull();
  });

  it('counts under the route template, never a URL, and says when no route matched', () => {
    expect(routeKey('/fixtures/:fixtureId')).toBe('/fixtures/:fixtureId');
    expect(routeKey(undefined)).toBe('(no route)');
    expect(routeKey('x'.repeat(400))).toHaveLength(300);
  });
});

describe('routeErrors', () => {
  const row = (over: Partial<HttpErrorRow>): HttpErrorRow => ({
    hour: at('2026-09-28T10:00:00Z'),
    method: 'GET',
    route: '/scores',
    status: 500,
    count: 1,
    last_request_id: 'req-00000001',
    last_at: at('2026-09-28T10:05:00Z'),
    ...over,
  });

  it('adds statuses and hours per route, keeps the newest request id, most failures first', () => {
    const routes = routeErrors([
      row({ count: 2 }),
      row({
        status: 503,
        count: 1,
        last_request_id: 'req-00000002',
        last_at: at('2026-09-28T10:30:00Z'),
      }),
      row({
        hour: at('2026-09-28T11:00:00Z'),
        count: 4,
        last_request_id: 'req-00000003',
        last_at: at('2026-09-28T11:10:00Z'),
      }),
      row({ route: '/fixtures/:fixtureId', count: 1 }),
      row({ method: 'POST', count: 1 }),
    ]);
    expect(routes.map((r) => `${r.method} ${r.route}`)).toEqual([
      'GET /scores',
      'GET /fixtures/:fixtureId',
      'POST /scores',
    ]);
    expect(routes[0]).toEqual({
      method: 'GET',
      route: '/scores',
      total: 7,
      by_status: { '500': 6, '503': 1 },
      newest: { at: '2026-09-28T11:10:00.000Z', status: 500, request_id: 'req-00000003' },
      hours: [
        { hour: '2026-09-28T10:00:00.000Z', count: 3 },
        { hour: '2026-09-28T11:00:00.000Z', count: 4 },
      ],
    });
  });

  it('is empty when nothing was recorded', () => {
    expect(routeErrors([])).toEqual([]);
  });
});

describe('queueFailures', () => {
  const row = (over: Partial<JobFailureRow>): JobFailureRow => ({
    hour: at('2026-09-28T10:00:00Z'),
    queue: 'ingestion',
    job: 'live',
    kind: 'failed',
    count: 1,
    last_job_id: 'repeat:live:1',
    last_at: at('2026-09-28T10:01:00Z'),
    ...over,
  });

  it('adds kinds and job names per queue and keeps the newest', () => {
    const [ingestion, news] = queueFailures([
      row({ count: 3 }),
      row({ job: 'fixtures', count: 1, last_at: at('2026-09-28T10:07:00Z'), last_job_id: 'f-9' }),
      row({ job: UNNAMED_JOB, kind: 'stalled', count: 1, last_job_id: 's-1' }),
      row({ queue: 'news', job: 'fetch', count: 1 }),
    ]);
    expect(ingestion).toMatchObject({
      queue: 'ingestion',
      total: 5,
      by_kind: { failed: 4, stalled: 1 },
      by_job: { live: 3, fixtures: 1, '*': 1 },
      newest: { at: '2026-09-28T10:07:00.000Z', kind: 'failed', job: 'fixtures', job_id: 'f-9' },
      hours: [{ hour: '2026-09-28T10:00:00.000Z', count: 5 }],
    });
    expect(news?.total).toBe(1);
  });
});

describe('FailureCountsService', () => {
  const fakeStore = () => ({
    addHttpError: vi.fn(() => Promise.resolve()),
    addJobFailure: vi.fn((_e: { queue: string; job: string; kind: string; jobId: string | null }) =>
      Promise.resolve(),
    ),
    prune: vi.fn(() => Promise.resolve()),
    httpErrors: vi.fn(() => Promise.resolve([])),
    jobFailures: vi.fn(() => Promise.resolve([])),
  });

  it('records a 5xx in its hour, under the template, with the request id and nothing else', async () => {
    const store = fakeStore();
    const service = new FailureCountsService(store as unknown as FailureCountsStore);
    await service.recordHttpError({
      method: 'GET',
      route: '/fixtures/:fixtureId',
      status: 500,
      requestId: 'req-12345678',
      at: at('2026-09-28T10:42:00Z'),
    });
    expect(store.addHttpError).toHaveBeenCalledWith({
      hour: at('2026-09-28T10:00:00Z'),
      method: 'GET',
      route: '/fixtures/:fixtureId',
      status: 500,
      requestId: 'req-12345678',
      at: at('2026-09-28T10:42:00Z'),
    });
  });

  it('never throws when the count cannot be written: a warning, and the response is unaffected', async () => {
    const store = fakeStore();
    store.addHttpError.mockRejectedValueOnce(new Error('database gone'));
    const service = new FailureCountsService(store as unknown as FailureCountsStore);
    await expect(
      service.recordHttpError({
        method: 'GET',
        route: '/x',
        status: 500,
        requestId: 'req-12345678',
      }),
    ).resolves.toBeUndefined();
  });

  it('prunes past the retention at most once an hour', async () => {
    const store = fakeStore();
    const service = new FailureCountsService(store as unknown as FailureCountsStore);
    const base = at('2026-09-28T10:00:00Z').getTime();
    for (const minutes of [0, 10, 59, 61]) {
      await service.recordJobFailure({
        queue: 'news',
        job: 'fetch',
        jobId: '1',
        kind: 'failed',
        at: new Date(base + minutes * 60_000),
      });
    }
    // The prune runs on the wall clock, not the recorded time; two writes
    // within the same hour of wall clock are one prune.
    expect(store.prune).toHaveBeenCalledTimes(1);
  });

  it('counts a worker failed and stalled events under its queue', async () => {
    const store = fakeStore();
    const service = new FailureCountsService(store as unknown as FailureCountsStore);
    const worker = new EventEmitter();
    service.watch(worker as unknown as Pick<Worker, 'on'>, 'ingestion');
    worker.emit('failed', { name: 'live', id: 'repeat:live:9' }, new Error('boom'));
    worker.emit('stalled', 'repeat:lineups:3', 'active');
    worker.emit('failed', undefined, new Error('no job'));
    await new Promise((resolve) => setImmediate(resolve));
    expect(store.addJobFailure.mock.calls.map(([e]) => [e.queue, e.job, e.kind, e.jobId])).toEqual([
      ['ingestion', 'live', 'failed', 'repeat:live:9'],
      ['ingestion', UNNAMED_JOB, 'stalled', 'repeat:lineups:3'],
      ['ingestion', UNNAMED_JOB, 'failed', null],
    ]);
  });

  it('reports the window with the retention stated', async () => {
    const store = fakeStore();
    const service = new FailureCountsService(store as unknown as FailureCountsStore);
    const report = await service.report(6, at('2026-09-28T10:30:00Z'));
    expect(report).toEqual({
      generated_at: '2026-09-28T10:30:00.000Z',
      since: '2026-09-28T05:00:00.000Z',
      window_hours: 6,
      retention_days: 30,
      http_errors: [],
      job_failures: [],
    });
    expect(store.httpErrors).toHaveBeenCalledWith(at('2026-09-28T05:00:00Z'));
  });
});
