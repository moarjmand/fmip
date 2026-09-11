import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { MatchCentre, ScoresResponse } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../identity/identity.service';
import { FixturesModule } from './fixtures.module';
import { STREAM_OPTIONS } from './stream.controller';

// A stream never ends, so `app.inject` cannot test it: the app listens on a
// real port and a real fetch reads events off the wire. The change comes
// from Postgres itself (the NOTIFY triggers of migration 1758700000000), so
// this runs only with DATABASE_URL.
const DATABASE_URL = process.env.DATABASE_URL;

const PL_2024 = '00000000-0000-4000-8000-000000000301';
const LIVERPOOL = '00000000-0000-4000-8000-000000000602';
const MAN_UNITED = '00000000-0000-4000-8000-000000000601';

// 2085-06-01 12:00 UTC: a day nothing else populates.
const FIXTURE = randomUUID();
const DAY = 'from=2085-06-01&to=2085-06-01&tz=UTC';

interface Event {
  name: string;
  id: string | null;
  data: unknown;
}

/**
 * Reads SSE events off a fetch body. One reader for the life of the
 * connection; `collect` returns once `until` is satisfied or the deadline
 * passes, keeping what it has read so a second call continues the stream.
 */
class SseReader {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private readonly decoder = new TextDecoder();
  private buffer = '';
  readonly events: Event[] = [];

  constructor(body: ReadableStream<Uint8Array>) {
    this.reader = body.getReader();
  }

  async collect(until: (events: Event[]) => boolean, deadlineMs = 8_000): Promise<Event[]> {
    const deadline = Date.now() + deadlineMs;
    while (Date.now() < deadline && !until(this.events)) {
      const chunk = await Promise.race([
        this.reader.read(),
        new Promise<{ done: true; value: undefined }>((resolve) =>
          setTimeout(() => resolve({ done: true, value: undefined }), deadline - Date.now()),
        ),
      ]);
      if (chunk.done) break;
      this.buffer += this.decoder.decode(chunk.value, { stream: true });
      let index: number;
      while ((index = this.buffer.indexOf('\n\n')) >= 0) {
        const block = this.buffer.slice(0, index);
        this.buffer = this.buffer.slice(index + 2);
        if (block.startsWith(':')) continue;
        const event: Event = { name: 'message', id: null, data: null };
        for (const line of block.split('\n')) {
          if (line.startsWith('event: ')) event.name = line.slice(7);
          else if (line.startsWith('id: ')) event.id = line.slice(4);
          else if (line.startsWith('data: ')) event.data = JSON.parse(line.slice(6)) as unknown;
        }
        this.events.push(event);
      }
    }
    return this.events;
  }

  async close(): Promise<void> {
    await this.reader.cancel().catch(() => undefined);
  }
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('SSE gateway', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let base = '';
  const open: AbortController[] = [];
  const connect = (): AbortController => {
    const controller = new AbortController();
    open.push(controller);
    return controller;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [DatabaseModule, FixturesModule] })
      .overrideProvider(IDENTITY_OPTIONS)
      .useValue({
        ...DEFAULT_IDENTITY_OPTIONS,
        sessionSecret: 'test-secret-'.repeat(4),
        webBaseUrl: 'http://web.test',
        cookieSecure: false,
      })
      .overrideProvider(STREAM_OPTIONS)
      .useValue({ debounceMs: 50, heartbeatMs: 300 })
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address();
    base =
      typeof address === 'object' && address !== null ? `http://127.0.0.1:${address.port}` : '';
    pool = new Pool({ connectionString: DATABASE_URL });

    await pool.query(
      `INSERT INTO fixture (id, season_id, kickoff_at, status, minute) VALUES ($1, $2, TIMESTAMPTZ '2085-06-01 12:00:00+00', 'live', 10)`,
      [FIXTURE, PL_2024],
    );
    await pool.query(
      `INSERT INTO fixture_participant (fixture_id, team_id, side) VALUES ($1, $2, 'home'), ($1, $3, 'away')`,
      [FIXTURE, LIVERPOOL, MAN_UNITED],
    );
    await pool.query(
      `INSERT INTO fixture_score (fixture_id, kind, home, away) VALUES ($1, 'current', 0, 0)`,
      [FIXTURE],
    );
  });

  afterAll(async () => {
    for (const controller of open) controller.abort();
    await pool.query(`DELETE FROM fixture WHERE id = $1`, [FIXTURE]);
    await pool.end();
    await app.close();
  }, 20_000);

  it('opens with a full snapshot, then pushes a new one when a score changes, and heartbeats in between', async () => {
    const controller = connect();
    const response = await fetch(`${base}/scores/stream?${DAY}`, {
      headers: { accept: 'text/event-stream' },
      signal: controller.signal,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(response.body).not.toBeNull();

    const sse = new SseReader(response.body as ReadableStream<Uint8Array>);

    let events = await sse.collect((list) => list.some((e) => e.name === 'snapshot'), 5_000);
    const first = events.find((e) => e.name === 'snapshot');
    expect(first).toBeDefined();
    expect(first?.id).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const snap = first?.data as ScoresResponse;
    expect(snap.total).toBe(1);
    expect(snap.groups[0]?.fixtures[0]?.scores.current).toEqual({ home: 0, away: 0 });

    // A goal: score and minute change inside one burst.
    await pool.query(
      `UPDATE fixture_score SET home = 1 WHERE fixture_id = $1 AND kind = 'current'`,
      [FIXTURE],
    );
    await pool.query(`UPDATE fixture SET minute = 23 WHERE id = $1`, [FIXTURE]);

    events = await sse.collect(
      (list) =>
        list.some(
          (e) =>
            e.name === 'snapshot' &&
            (e.data as ScoresResponse).groups[0]?.fixtures[0]?.scores.current?.home === 1,
        ) && list.some((e) => e.name === 'heartbeat'),
      6_000,
    );
    const updated = events.filter((e) => e.name === 'snapshot');
    expect(updated.length).toBeGreaterThanOrEqual(2);
    const card = (updated.at(-1)?.data as ScoresResponse).groups[0]?.fixtures[0];
    expect(card?.scores.current).toEqual({ home: 1, away: 0 });
    expect(card?.minute).toBe(23);
    expect(events.filter((e) => e.name === 'heartbeat').length).toBeGreaterThanOrEqual(1);
    await sse.close();
    controller.abort();
  }, 20_000);

  it('streams one fixture for the match centre and refuses an unknown one', async () => {
    const missing = await fetch(`${base}/fixtures/${randomUUID()}/stream`);
    expect(missing.status).toBe(404);

    const controller = connect();
    const response = await fetch(`${base}/fixtures/${FIXTURE}/stream`, {
      signal: controller.signal,
    });
    expect(response.status).toBe(200);
    const sse = new SseReader(response.body as ReadableStream<Uint8Array>);
    const events = await sse.collect((list) => list.some((e) => e.name === 'snapshot'), 5_000);
    const centre = events.find((e) => e.name === 'snapshot')?.data as MatchCentre;
    expect(centre.fixture.id).toBe(FIXTURE);
    expect(centre.fixture.status).toBe('live');
    await sse.close();
    controller.abort();
  }, 20_000);

  it('validates the query like the plain endpoint', async () => {
    const bad = await fetch(`${base}/scores/stream?tz=Mars/Olympus`);
    expect(bad.status).toBe(400);
    const needsSession = await fetch(`${base}/scores/stream?favourites=1`);
    expect(needsSession.status).toBe(401);
  });
});
