import { Controller, Get, Module, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AllExceptionsFilter, registerAccessLog, requestIdFrom } from './http-observability';
import { JsonLogger } from './json-logger';

// A throwaway controller: one route that works, one that throws an
// HttpException, one that throws a plain Error.
@Controller('probe')
class ProbeController {
  @Get('ok')
  ok(): { ok: true } {
    return { ok: true };
  }
  @Get('missing')
  missing(): never {
    throw new NotFoundException({ error: 'not_found', message: 'No such probe.' });
  }
  @Get('boom')
  boom(): never {
    throw new Error('the database ate my homework');
  }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

describe('HTTP observability', () => {
  let app: NestFastifyApplication;
  const lines: string[] = [];
  const logger = new JsonLogger('json', (line) => lines.push(line));

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ProbeModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({
        genReqId: (request: { headers: Record<string, string | string[] | undefined> }) =>
          requestIdFrom(request.headers['x-request-id']),
      }),
      { logger: false },
    );
    registerAccessLog(app.getHttpAdapter().getInstance(), logger);
    app.useGlobalFilters(new AllExceptionsFilter(logger));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  const records = () => lines.map((l) => JSON.parse(l) as Record<string, unknown>);

  it('echoes a sane caller request id and mints one otherwise', async () => {
    const given = await app.inject({
      method: 'GET',
      url: '/probe/ok',
      headers: { 'x-request-id': 'web-abc123456' },
    });
    expect(given.statusCode).toBe(200);
    expect(given.headers['x-request-id']).toBe('web-abc123456');

    const bad = await app.inject({
      method: 'GET',
      url: '/probe/ok',
      headers: { 'x-request-id': 'not ok; drop table' },
    });
    expect(bad.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);

    const none = await app.inject({ method: 'GET', url: '/probe/ok' });
    expect(none.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(requestIdFrom(['first-id-0001', 'second'])).toBe('first-id-0001');
  });

  it('writes an access record per request with the id, status and duration', async () => {
    lines.length = 0;
    await app.inject({
      method: 'GET',
      url: '/probe/ok',
      headers: { 'x-request-id': 'trace-0001' },
    });
    const access = records().find((r) => r.event === 'http.request');
    expect(access).toMatchObject({
      level: 'log',
      context: 'Http',
      request_id: 'trace-0001',
      method: 'GET',
      url: '/probe/ok',
      status: 200,
    });
    expect(typeof access!.duration_ms).toBe('number');
  });

  it('lets an HttpException keep its body and turns an unhandled error into a 500 with the id', async () => {
    lines.length = 0;
    const missing = await app.inject({ method: 'GET', url: '/probe/missing' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: 'not_found', message: 'No such probe.' });
    expect(records().filter((r) => r.event === 'http.error')).toHaveLength(0);

    const boom = await app.inject({
      method: 'GET',
      url: '/probe/boom',
      headers: { 'x-request-id': 'trace-boom-01' },
    });
    expect(boom.statusCode).toBe(500);
    expect(boom.json()).toEqual({
      error: 'internal',
      message: 'Something went wrong on our side. Quote the request id when reporting it.',
      request_id: 'trace-boom-01',
    });
    const error = records().find((r) => r.event === 'http.error');
    expect(error).toMatchObject({ level: 'error', request_id: 'trace-boom-01', status: 500 });
    expect((error!.err as { message: string; stack: string }).message).toBe(
      'the database ate my homework',
    );
    expect((error!.err as { stack: string }).stack).toContain('ProbeController');
    // The stack never reaches the client.
    expect(boom.body).not.toContain('ProbeController');
  });
});
