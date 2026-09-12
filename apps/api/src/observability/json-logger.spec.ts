import { describe, expect, it } from 'vitest';
import { JsonLogger, logFormatFromEnv, renderRecord } from './json-logger';

const NOW = new Date('2026-09-12T10:00:00.000Z');

function capture(format: 'json' | 'pretty' = 'json') {
  const lines: string[] = [];
  const logger = new JsonLogger(
    format,
    (line) => lines.push(line),
    () => NOW,
  );
  return { logger, lines };
}

describe('logFormatFromEnv', () => {
  it('is json in production, pretty elsewhere, and obeys LOG_FORMAT', () => {
    expect(logFormatFromEnv({})).toBe('pretty');
    expect(logFormatFromEnv({ NODE_ENV: 'production' })).toBe('json');
    expect(logFormatFromEnv({ NODE_ENV: 'production', LOG_FORMAT: 'pretty' })).toBe('pretty');
    expect(logFormatFromEnv({ LOG_FORMAT: 'JSON' })).toBe('json');
    expect(logFormatFromEnv({ LOG_FORMAT: 'xml' })).toBe('pretty');
  });
});

describe('JsonLogger', () => {
  it('writes one JSON object per line with time, level, context and message', () => {
    const { logger, lines } = capture();
    logger.log('Nest application successfully started', 'NestApplication');
    expect(JSON.parse(lines[0]!)).toEqual({
      time: '2026-09-12T10:00:00.000Z',
      level: 'log',
      context: 'NestApplication',
      message: 'Nest application successfully started',
    });
  });

  it('turns an Error and plain objects into fields', () => {
    const { logger, lines } = capture();
    const boom = new Error('boom');
    logger.error('request failed', boom, { request_id: 'r1', status: 500 }, 'Http');
    const record = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(record).toMatchObject({
      level: 'error',
      context: 'Http',
      message: 'request failed',
      request_id: 'r1',
      status: 500,
    });
    expect(record.err).toMatchObject({ name: 'Error', message: 'boom' });
    expect((record.err as { stack: string }).stack).toContain('boom');
  });

  it('emits named events and respects the level filter', () => {
    const { logger, lines } = capture();
    logger.setLogLevels(['error', 'warn']);
    logger.log('quiet');
    logger.event('warn', 'Ingestion', 'ingest run failed', {
      event: 'ingest.failed',
      provider: 'api_football',
    });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      event: 'ingest.failed',
      provider: 'api_football',
    });
  });

  it('renders a readable line in pretty mode', () => {
    expect(
      renderRecord(
        {
          time: '2026-09-12T10:00:00.000Z',
          level: 'warn',
          context: 'Http',
          message: 'slow',
          ms: 1200,
        },
        'pretty',
      ),
    ).toBe('2026-09-12T10:00:00.000Z WARN    [Http] slow {"ms":1200}');
  });
});
