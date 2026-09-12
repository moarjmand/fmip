import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { IngestionHealth } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { IngestRunsService } from './ingest-runs.service';
import { IngestionModule } from './ingestion.module';

// An ingest failure is visible without SSH (T-071): recorded in ingest_run,
// logged as a structured event, and answered by GET /health/ingestion.
const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('ingest runs', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let runs: IngestRunsService;
  const ids: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, IngestionModule],
    }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    pool = new Pool({ connectionString: DATABASE_URL });
    runs = app.get(IngestRunsService);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM ingest_run WHERE id = ANY($1::uuid[])`, [ids]);
    await pool.end();
    await app.close();
  });

  it('records a failed run, logs the failure as an event, and shows it on /health/ingestion', async () => {
    const errorLog = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const logLog = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    const ok = await runs.track('api_football', 'fixtures', 'season:test', async () => ({
      result: 'done',
      itemsSeen: 3,
      itemsWritten: 3,
    }));
    expect(ok).toBe('done');

    await expect(
      runs.track('api_football', 'live', 'fixture:test', async () => {
        throw new Error('provider answered 502');
      }),
    ).rejects.toThrow('provider answered 502');

    const partialId = await runs.start('football_data_org', 'standings', null);
    const partial = await runs.finish(partialId, {
      status: 'partial',
      itemsSeen: 10,
      itemsWritten: 7,
      error: 'three rows failed validation',
    });
    expect(partial).toMatchObject({ status: 'partial', items_seen: 10, items_written: 7 });

    // Every run above is ours: collect them for cleanup through the health view.
    const response = await app.inject({ method: 'GET', url: '/health/ingestion' });
    expect(response.statusCode).toBe(200);
    const health = response.json() as IngestionHealth;
    for (const run of health.recent) {
      if (run.scope === 'season:test' || run.scope === 'fixture:test' || run.id === partialId)
        ids.push(run.id);
    }
    expect(health.last_run).toMatchObject({ id: partialId, status: 'partial' });
    expect(health.last_failure).toMatchObject({ id: partialId, status: 'partial' });
    expect(health.failed_last_24h).toBeGreaterThanOrEqual(2);
    const failed = health.recent.find((r) => r.scope === 'fixture:test');
    expect(failed).toMatchObject({
      status: 'failed',
      job: 'live',
      error: 'provider answered 502',
      items_seen: 0,
    });
    expect(failed!.finished_at).not.toBeNull();
    const succeeded = health.recent.find((r) => r.scope === 'season:test');
    expect(succeeded).toMatchObject({ status: 'succeeded', items_written: 3, error: null });

    // The failure and the partial run were logged as structured events; the success as one too.
    const failedEvents = errorLog.mock.calls.map((c) => c[1] as { event: string; status: string });
    expect(failedEvents.map((e) => [e.event, e.status])).toEqual(
      expect.arrayContaining([
        ['ingest.failed', 'failed'],
        ['ingest.failed', 'partial'],
      ]),
    );
    expect(logLog.mock.calls.map((c) => (c[1] as { event: string }).event)).toContain(
      'ingest.succeeded',
    );

    // Finishing a run twice writes nothing and is warned about, not thrown.
    expect(
      await runs.finish(partialId, { status: 'succeeded', itemsSeen: 0, itemsWritten: 0 }),
    ).toBeNull();
    errorLog.mockRestore();
    logLog.mockRestore();
  });

  it('answers with an empty picture rather than an invented one when nothing ran', async () => {
    const health = (
      await app.inject({ method: 'GET', url: '/health/ingestion' })
    ).json() as IngestionHealth;
    expect(Object.keys(health).sort()).toEqual([
      'checked_at',
      'failed_last_24h',
      'last_failure',
      'last_run',
      'recent',
      'running',
    ]);
    expect(Array.isArray(health.recent)).toBe(true);
  });
});
