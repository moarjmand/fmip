import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { IngestionHealth } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { IngestRunsService } from './ingest-runs.service';
import { IngestionModule } from './ingestion.module';
import { PostgresRunStore } from './internal/run-store';

// An ingest failure is visible without SSH (T-071): recorded in ingest_run,
// logged as a structured event, and answered by GET /health/ingestion.
const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('ingest runs', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let runs: IngestRunsService;
  const ids: string[] = [];
  /** Competitions this file created, removed with everything hanging off them. */
  const competitions: string[] = [];

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
    // In reverse dependency order and by id: no trigger is ever disabled here,
    // because a cleanup that leaves an orphan behind is what makes a backup
    // unrestorable (docs/07-backups.md).
    await pool.query(`DELETE FROM season WHERE competition_id = ANY($1::uuid[])`, [competitions]);
    await pool.query(
      `DELETE FROM provider_mapping WHERE entity_type = 'competition' AND internal_id = ANY($1::uuid[])`,
      [competitions],
    );
    await pool.query(`DELETE FROM competition WHERE id = ANY($1::uuid[])`, [competitions]);
    await pool.end();
    await app.close();
  });

  it('records a failed run, logs the failure as an event, and shows it on /health/ingestion', async () => {
    const errorLog = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const logLog = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    // `highlightly` and `football_data_org`, never `api_football`: the running
    // lock is a partial unique index on `(provider, job)`, and the jobs spec
    // opens real runs for `api_football` at the same time in another worker.
    const ok = await runs.track('highlightly', 'fixtures', 'season:test', async () => ({
      result: 'done',
      itemsSeen: 3,
      itemsWritten: 3,
    }));
    expect(ok).toBe('done');

    await expect(
      runs.track('highlightly', 'live', 'fixture:test', async () => {
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
      'pollable',
      'recent',
      'running',
    ]);
    expect(Array.isArray(health.recent)).toBe(true);
    // What there is to poll travels with the runs, so an empty run list can be
    // read. The numbers themselves belong to whatever `INGESTION_SOURCE` this
    // process was given and to what the database holds, so what is asserted
    // here is the shape and the one invariant that must hold everywhere: with
    // no provider to ask, nothing is pollable.
    expect(Object.keys(health.pollable).sort()).toEqual([
      'competitions',
      'provider',
      'with_current_season',
    ]);
    expect(health.pollable.with_current_season).toBeLessThanOrEqual(health.pollable.competitions);
    if (health.pollable.provider === null) expect(health.pollable.competitions).toBe(0);
  });

  /**
   * A schedule that is on and a catalogue that is empty are opposite states
   * that look identical from the environment alone: the second fetches
   * nothing. A freshly migrated database holds no competition at all, so this
   * is what a first deployment is in until somebody adds one, and the count is
   * how `deploy/check-setup.sh` tells `ON` from `IDLE`.
   */
  it('separates a competition that is merely mapped from one that is polled', async () => {
    const store = app.get(PostgresRunStore);
    expect(await store.pollableCatalogue(null)).toEqual({
      competitions: 0,
      withCurrentSeason: 0,
    });

    const before = await store.pollableCatalogue('highlightly');

    // Mapped, with no season yet: the state between `--add-competition` and
    // `--add-season`, where the job still asks for nothing.
    const {
      rows: [competition],
    } = await pool.query<{ id: string }>(
      `INSERT INTO competition (name, kind, scope, gender)
       VALUES ($1, 'cup', 'continental', 'men') RETURNING id`,
      [`Pollable probe ${Date.now()}`],
    );
    competitions.push(competition!.id);
    await pool.query(
      `INSERT INTO provider_mapping (provider, entity_type, external_id, internal_id)
       VALUES ('highlightly', 'competition', $1, $2)`,
      [`probe-${Date.now()}`, competition!.id],
    );
    const mappedOnly = await store.pollableCatalogue('highlightly');
    expect(mappedOnly.competitions).toBe(before.competitions + 1);
    expect(mappedOnly.withCurrentSeason).toBe(before.withCurrentSeason);

    // A current season is what makes it something the fixtures job asks for.
    await pool.query(
      `INSERT INTO season (competition_id, label, start_date, end_date, is_current)
       VALUES ($1, '2026/27', '2026-08-01', '2027-05-31', true)`,
      [competition!.id],
    );
    const polled = await store.pollableCatalogue('highlightly');
    expect(polled.competitions).toBe(before.competitions + 1);
    expect(polled.withCurrentSeason).toBe(before.withCurrentSeason + 1);
  });
});
