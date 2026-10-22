import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { MatchCentre } from '@fmip/contracts';
import { Pool } from 'pg';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { FixturesModule } from '../fixtures/fixtures.module';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../identity/identity.service';
import { MediaFiles } from './internal/media-files';
import { MediaStore } from './internal/media-store';
import { sha256Of, versionOf } from './internal/image-check';
import { IMMUTABLE, SHORT } from './media.controller';
import {
  MEDIA_FETCH,
  MEDIA_FILES,
  MEDIA_PACE,
  MediaFetchService,
  type FetchedImage,
} from './media-fetch.service';
import { MediaModule } from './media.module';
import { MediaService } from './media.service';

/**
 * The media store end to end (T-1320, D-176): an address noted by ingestion is
 * fetched once onto the volume, served from our own route with a year's
 * cache and an ETag, 404 when absent; a photo many people share is taken for
 * the provider's silhouette and told `not_supplied`; and the match centre
 * carries our own address, never the provider's.
 */
const DATABASE_URL = process.env.DATABASE_URL;

// Seeded catalog (packages/db/seed/001_catalog.sql).
const PL_2024 = '00000000-0000-4000-8000-000000000301';
const REAL_MADRID = '00000000-0000-4000-8000-000000000603';
const PERSEPOLIS = '00000000-0000-4000-8000-000000000604';
const SALAH = '00000000-0000-4000-8000-000000000701';
const BRUNO = '00000000-0000-4000-8000-000000000702';

const png = (text: string) =>
  Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(text)]);
const CREST = png(`real madrid crest ${randomUUID()}`);
const SILHOUETTE = png(`silhouette ${randomUUID()}`);
const SOURCE = 'https://media.api-sports.io/football';

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('the entity media store', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let dir: string;
  let media: MediaService;
  let fetcher: MediaFetchService;
  const asked: string[] = [];
  const answers = new Map<string, FetchedImage>();
  const match = randomUUID();
  const people = [randomUUID(), randomUUID(), randomUUID()];

  const answer = (url: string, bytes: Buffer, status = 200, type = 'image/png') =>
    answers.set(url, { status, contentType: type, bytes, finalUrl: url });

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'fmip-media-'));
    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, MediaModule, FixturesModule],
    })
      .overrideProvider(IDENTITY_OPTIONS)
      .useValue({
        ...DEFAULT_IDENTITY_OPTIONS,
        sessionSecret: 'test-secret-'.repeat(4),
        webBaseUrl: 'http://web.test',
        cookieSecure: false,
      })
      .overrideProvider(MEDIA_FILES)
      .useValue(new MediaFiles(dir))
      .overrideProvider(MEDIA_PACE)
      .useValue({ perTick: 500, intervalMs: 0, sleep: async () => undefined })
      .overrideProvider(MEDIA_FETCH)
      .useValue(async (url: string) => {
        asked.push(url);
        return (
          answers.get(url) ?? {
            status: 404,
            contentType: 'text/html',
            bytes: Buffer.from('no'),
            finalUrl: url,
          }
        );
      })
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    pool = new Pool({ connectionString: DATABASE_URL });
    media = moduleRef.get(MediaService);
    fetcher = moduleRef.get(MediaFetchService);

    await pool.query(`DELETE FROM entity_media WHERE entity_id = ANY($1::uuid[])`, [
      [REAL_MADRID, PERSEPOLIS, SALAH, BRUNO, ...people],
    ]);
    await pool.query(
      `INSERT INTO fixture (id, season_id, round, kickoff_at, status)
       VALUES ($1, $2, 'Matchweek 1', TIMESTAMPTZ '2087-03-15 16:30:00+00', 'scheduled')`,
      [match, PL_2024],
    );
    await pool.query(
      `INSERT INTO fixture_participant (fixture_id, team_id, side) VALUES ($1, $2, 'home'), ($1, $3, 'away')`,
      [match, REAL_MADRID, PERSEPOLIS],
    );
    const { rows } = await pool.query<{ id: string; side: string }>(
      `SELECT id, side FROM fixture_participant WHERE fixture_id = $1`,
      [match],
    );
    await pool.query(
      `INSERT INTO lineup (participant_id, person_id, role, shirt_number, position, is_captain)
       VALUES ($1, $3, 'starter', 11, 'forward', false), ($2, $4, 'starter', 8, 'midfielder', false)`,
      [
        rows.find((r) => r.side === 'home')!.id,
        rows.find((r) => r.side === 'away')!.id,
        SALAH,
        BRUNO,
      ],
    );
  });

  afterAll(async () => {
    await pool?.query(`DELETE FROM fixture WHERE id = $1`, [match]);
    await pool?.query(`DELETE FROM entity_media WHERE entity_id = ANY($1::uuid[])`, [
      [REAL_MADRID, PERSEPOLIS, SALAH, BRUNO, ...people],
    ]);
    await pool?.end();
    await app?.close();
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  });

  const state = async (id: string) =>
    (
      await pool.query<{ state: string; sha256: string | null; attempts: number }>(
        `SELECT state, sha256, attempts FROM entity_media WHERE entity_id = $1`,
        [id],
      )
    ).rows[0];

  it('fetches a noted crest once, stores it, and serves it from our own route', async () => {
    answer(`${SOURCE}/teams/541.png`, CREST);
    await media.note('api_football', 'team', REAL_MADRID, `${SOURCE}/teams/541.png`);
    // Noting the same address again changes nothing: the same row version,
    // not even locked (T-1374).
    const rowVersion = async () =>
      (
        await pool.query<{ xmin: string; xmax: string }>(
          `SELECT xmin::text, xmax::text FROM entity_media WHERE entity_id = $1`,
          [REAL_MADRID],
        )
      ).rows[0];
    const noted = await rowVersion();
    await expect(
      new MediaStore(pool).note('api_football', 'team', REAL_MADRID, `${SOURCE}/teams/541.png`),
    ).resolves.toBe(false);
    expect(await rowVersion()).toEqual(noted);
    await fetcher.runDue(new Date());
    expect(asked.filter((u) => u.endsWith('/teams/541.png'))).toHaveLength(1);
    expect(await state(REAL_MADRID)).toMatchObject({ state: 'available', sha256: sha256Of(CREST) });

    // Not due again until the monthly re-check.
    await fetcher.runDue(new Date());
    expect(asked.filter((u) => u.endsWith('/teams/541.png'))).toHaveLength(1);

    const version = versionOf(sha256Of(CREST));
    const served = await app.inject({
      method: 'GET',
      url: `/media/crest/${REAL_MADRID}/${version}`,
    });
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toBe('image/png');
    expect(served.headers['cache-control']).toBe(IMMUTABLE);
    expect(served.headers.etag).toBe(`"${sha256Of(CREST)}"`);
    expect(served.headers['x-content-type-options']).toBe('nosniff');
    expect(served.rawPayload.equals(CREST)).toBe(true);

    const again = await app.inject({
      method: 'GET',
      url: `/media/crest/${REAL_MADRID}/${version}`,
      headers: { 'if-none-match': `"${sha256Of(CREST)}"` },
    });
    expect(again.statusCode).toBe(304);

    const old = await app.inject({
      method: 'GET',
      url: `/media/crest/${REAL_MADRID}/000000000000`,
    });
    expect(old.statusCode).toBe(200);
    expect(old.headers['cache-control']).toBe(SHORT);

    // T-1461: the address carries the type's extension, which the edge caches
    // by; the bare version written before stays valid.
    const named = await app.inject({
      method: 'GET',
      url: `/media/crest/${REAL_MADRID}/${version}.png`,
    });
    expect(named.statusCode).toBe(200);
    expect(named.headers['content-type']).toBe('image/png');
    expect(named.headers['cache-control']).toBe(IMMUTABLE);
    expect(named.rawPayload.equals(CREST)).toBe(true);
    const stale = await app.inject({
      method: 'GET',
      url: `/media/crest/${REAL_MADRID}/000000000000.png`,
    });
    expect(stale.headers['cache-control']).toBe(SHORT);
  });

  it('serves a raster image at the widths a surface draws, as WebP made once (T-1462)', async () => {
    // A real 150-pixel PNG, as the provider sends: the variants must decode it.
    const photo = await sharp({
      create: {
        width: 150,
        height: 150,
        channels: 4,
        background: { r: Math.floor(Math.random() * 255), g: 40, b: 90, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    answer(`${SOURCE}/players/702.png`, photo);
    await media.note('api_football', 'person', BRUNO, `${SOURCE}/players/702.png`);
    await fetcher.runDue(new Date());
    const version = versionOf(sha256Of(photo));
    expect((await media.index({ person: [BRUNO] })).photo(BRUNO)).toEqual({
      coverage: 'available',
      url: `/api/media/photo/${BRUNO}/${version}.png`,
    });

    for (const width of [48, 96, 192]) {
      const variant = await app.inject({
        method: 'GET',
        url: `/media/photo/${BRUNO}/${version}-${width}.webp`,
      });
      expect(variant.statusCode).toBe(200);
      expect(variant.headers['content-type']).toBe('image/webp');
      expect(variant.headers['cache-control']).toBe(IMMUTABLE);
      expect(variant.headers.etag).toBe(`"${sha256Of(photo)}-${width}"`);
      const meta = await sharp(variant.rawPayload).metadata();
      expect(meta.format).toBe('webp');
      // Fitted inside the width, never enlarged past the original's 150.
      expect(meta.width).toBe(Math.min(width, 150));
      expect(variant.rawPayload.length).toBeLessThan(photo.length);
      // The second ask reads the kept file: the same bytes.
      const again = await app.inject({
        method: 'GET',
        url: `/media/photo/${BRUNO}/${version}-${width}.webp`,
      });
      expect(again.rawPayload.equals(variant.rawPayload)).toBe(true);
    }
    // Only the widths we make.
    expect(
      (await app.inject({ method: 'GET', url: `/media/photo/${BRUNO}/${version}-50.webp` }))
        .statusCode,
    ).toBe(404);
    // A stored file the library cannot read is served as stored, briefly.
    const crest = await app.inject({
      method: 'GET',
      url: `/media/crest/${REAL_MADRID}/${versionOf(sha256Of(CREST))}-48.webp`,
    });
    expect(crest.statusCode).toBe(200);
    expect(crest.headers['content-type']).toBe('image/png');
    expect(crest.headers['cache-control']).toBe(SHORT);
    expect(crest.rawPayload.equals(CREST)).toBe(true);
  });

  it('answers 404 for an image nobody stored, a wrong kind and a malformed id', async () => {
    for (const url of [
      `/media/crest/${PERSEPOLIS}/abc`,
      `/media/logo/${REAL_MADRID}/abc`,
      `/media/banner/${REAL_MADRID}/abc`,
      `/media/crest/not-a-uuid/abc`,
    ]) {
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(404);
    }
  });

  it("takes a photo several people share for the provider's silhouette", async () => {
    for (const [i, person] of people.entries()) {
      answer(`${SOURCE}/players/${900000 + i}.png`, SILHOUETTE);
      await media.note('api_football', 'person', person, `${SOURCE}/players/${900000 + i}.png`);
    }
    await fetcher.runDue(new Date());
    for (const person of people) {
      expect(await state(person)).toMatchObject({ state: 'not_supplied', sha256: null });
    }
    const index = await media.index({ person: people });
    expect(index.photo(people[0]!)).toEqual({ coverage: 'not_supplied', url: null });
  });

  it('records a refused answer as a failure, and a 404 as not supplied', async () => {
    answer(`${SOURCE}/players/11.png`, Buffer.from('<html>'), 200, 'text/html');
    await media.note('api_football', 'person', SALAH, `${SOURCE}/players/11.png`);
    await fetcher.runDue(new Date());
    expect(await state(SALAH)).toMatchObject({ state: 'failed', attempts: 1 });

    await media.note('api_football', 'team', PERSEPOLIS, `${SOURCE}/teams/2742.png`);
    await fetcher.runDue(new Date());
    expect(await state(PERSEPOLIS)).toMatchObject({ state: 'not_supplied' });
  });

  it('puts our own address in the match centre, and says so where there is none', async () => {
    const response = await app.inject({ method: 'GET', url: `/fixtures/${match}` });
    expect(response.statusCode).toBe(200);
    const centre = response.json<MatchCentre>();
    expect(centre.fixture.home.crest).toEqual({
      coverage: 'available',
      url: `/api/media/crest/${REAL_MADRID}/${versionOf(sha256Of(CREST))}.png`,
    });
    expect(centre.fixture.away.crest).toEqual({ coverage: 'not_supplied', url: null });
    expect(centre.fixture.competition.logo).toEqual({ coverage: 'not_supplied', url: null });
    expect(centre.lineups.data?.home[0]?.photo).toEqual({ coverage: 'not_supplied', url: null });
    expect(response.body).not.toContain('api-sports.io');
    // The match centre's first read is slow on a cold pool.
  }, 30_000);

  it('rewrites a held image only when the provider gives it a new address (T-1374)', async () => {
    const team = randomUUID();
    const store = new MediaStore(pool);
    const row = async () =>
      (
        await pool.query<{ xmin: string; xmax: string; source_url: string; state: string }>(
          `SELECT xmin::text, xmax::text, source_url, state FROM entity_media WHERE entity_id = $1`,
          [team],
        )
      ).rows[0];
    try {
      await expect(
        store.note('api_football', 'team', team, `${SOURCE}/teams/9001.png`),
      ).resolves.toBe(true);
      await pool.query(
        `UPDATE entity_media SET state = 'failed', attempts = 3 WHERE entity_id = $1`,
        [team],
      );
      const held = await row();
      await expect(
        store.note('api_football', 'team', team, `${SOURCE}/teams/9001.png`),
      ).resolves.toBe(false);
      expect(await row()).toEqual(held);

      await expect(
        store.note('api_football', 'team', team, `${SOURCE}/teams/9002.png`),
      ).resolves.toBe(true);
      const moved = await row();
      expect(moved?.xmin).not.toBe(held?.xmin);
      expect(moved).toMatchObject({ source_url: `${SOURCE}/teams/9002.png`, state: 'pending' });
    } finally {
      await pool.query(`DELETE FROM entity_media WHERE entity_id = $1`, [team]);
    }
  });
});
