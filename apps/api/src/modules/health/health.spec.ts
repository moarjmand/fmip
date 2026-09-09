import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { HealthModule } from './health.module';
import { HealthService } from './health.service';

describe('HealthService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports uptime measured from construction', () => {
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const service = new HealthService();

    vi.setSystemTime(new Date('2026-01-01T00:00:12.500Z'));
    const report = service.report();

    expect(report.uptime_seconds).toBe(12.5);
    expect(report.started_at).toBe('2026-01-01T00:00:00.000Z');
    expect(report.checked_at).toBe('2026-01-01T00:00:12.500Z');
    expect(report.status).toBe('ok');
  });

  it('claims nothing about Postgres or Redis', () => {
    // Liveness must not grow into a dependency check by accident: a health
    // endpoint that appears to cover a dependency it never checks is worse than
    // one that never claimed to.
    const report = new HealthService().report();

    expect(Object.keys(report).sort()).toEqual([
      'checked_at',
      'service',
      'started_at',
      'status',
      'uptime_seconds',
    ]);
  });
});

describe('GET /health', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [HealthModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 with a live report', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok', service: 'api' });
  });
});
