import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MediaService } from '../../media/media.service';
import { PHOTO_ID_TTL_MS, PersonPhotos, type PersonPhotoSink } from './person-photo';

/**
 * The one photo rule for a person with several provider ids (T-1869, D-452):
 * the photo id (the lowest) notes as before, any other id only fills an empty
 * place. On a database with the real media store, a merged person's stored
 * address never switches back and forth however his ids alternate, and a
 * person with one id is noted exactly as before. Then, with no database, a
 * merge seen within the photo id's memory and a failed lookup.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const PROVIDER = 'api_football' as const;

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  'a person photo on the media store (T-1869)',
  () => {
    let pool: Pool;
    const merged = randomUUID();
    const single = randomUUID();
    // Provider ids are numbers; a coach's is `coach:` and a number (D-230).
    const base = 8_000_000_000 + Math.floor(Math.random() * 1_000_000_000);
    const low = String(base);
    const high = String(base + 1);
    const coach = `coach:${base}`;
    const only = String(base + 2);
    const url = (id: string) => `https://media.api-sports.io/football/players/${id}.png`;

    /** One mention, through a fresh process's services, so nothing is remembered between them. */
    const mention = (personId: string, externalId: string, address = url(externalId)) =>
      new PersonPhotos(pool, new MediaService(pool)).notePhoto(
        PROVIDER,
        personId,
        externalId,
        address,
      );
    const stored = async (personId: string) =>
      (
        await pool.query<{ source_url: string; state: string; xmin: string }>(
          `SELECT source_url, state, xmin::text FROM entity_media
            WHERE entity_type = 'person' AND entity_id = $1 AND kind = 'photo'`,
          [personId],
        )
      ).rows[0];

    beforeAll(async () => {
      pool = new Pool({ connectionString: DATABASE_URL });
      await pool.query(
        `INSERT INTO person (id, full_name) VALUES ($1, 'T-1869 Merged'), ($2, 'T-1869 Single')`,
        [merged, single],
      );
      for (const [external, internal] of [
        [low, merged],
        [high, merged],
        [coach, merged],
        [only, single],
      ] as const) {
        await pool.query(
          `INSERT INTO provider_mapping (provider, entity_type, external_id, internal_id)
           VALUES ($1, 'person', $2, $3)`,
          [PROVIDER, external, internal],
        );
      }
    });

    afterAll(async () => {
      await pool?.query(`DELETE FROM entity_media WHERE entity_id = ANY($1::uuid[])`, [
        [merged, single],
      ]);
      await pool?.query(`DELETE FROM provider_mapping WHERE internal_id = ANY($1::uuid[])`, [
        [merged, single],
      ]);
      await pool?.query(`DELETE FROM person WHERE id = ANY($1::uuid[])`, [[merged, single]]);
      await pool?.end();
    });

    it('switches a merged person at most once, to the lowest id, however his ids alternate', async () => {
      const seen: string[] = [];
      for (const id of [high, low, high, coach, low, high, coach, low]) {
        await mention(merged, id);
        seen.push((await stored(merged))!.source_url);
      }
      // The other id filled the empty place; the lowest replaced it once; then nothing moved.
      expect(seen).toEqual([url(high), ...Array<string>(7).fill(url(low))]);

      // Fetched and served: alternating mentions do not touch the row, so nothing is fetched again.
      await pool.query(
        `UPDATE entity_media SET state = 'available', sha256 = repeat('a', 64),
                storage_key = 'aa/' || repeat('a', 64) || '.png', content_type = 'image/png',
                byte_size = 100, source_fetched_at = now()
          WHERE entity_type = 'person' AND entity_id = $1`,
        [merged],
      );
      const before = (await stored(merged))!;
      for (const id of [high, coach, low, high, low, coach]) await mention(merged, id);
      expect(await stored(merged)).toEqual(before);
    });

    it('keeps the lowest id first noted, whatever comes after', async () => {
      await pool.query(`DELETE FROM entity_media WHERE entity_id = $1`, [merged]);
      for (const id of [low, high, coach, high]) {
        await mention(merged, id);
        expect((await stored(merged))!.source_url).toBe(url(low));
      }
    });

    it('holds within one process too, where both services remember what they noted', async () => {
      await pool.query(`DELETE FROM entity_media WHERE entity_id = $1`, [merged]);
      const photos = new PersonPhotos(pool, new MediaService(pool));
      const seen: string[] = [];
      for (const id of [coach, high, low, coach, high, low]) {
        await photos.notePhoto(PROVIDER, merged, id, url(id));
        seen.push((await stored(merged))!.source_url);
      }
      // The coach id filled the empty place, the higher player id could not
      // replace it, the lowest did, once.
      expect(seen).toEqual([url(coach), url(coach), ...Array<string>(4).fill(url(low))]);
    });

    it('notes a person with one id exactly as before: a new address replaces the stored one', async () => {
      await mention(single, only);
      expect(await stored(single)).toMatchObject({ source_url: url(only), state: 'pending' });
      const moved = 'https://media-2.api-sports.io/football/players/moved.png';
      await mention(single, only, moved);
      expect((await stored(single))!.source_url).toBe(moved);
      await mention(single, only);
      expect((await stored(single))!.source_url).toBe(url(only));
    });
  },
);

describe('the photo id remembered (T-1869)', () => {
  function world(lowest: { id: string | null; fail?: boolean }) {
    const calls: string[] = [];
    let lookups = 0;
    const pool = {
      query: () => {
        lookups += 1;
        if (lowest.fail === true) return Promise.reject(new Error('connection lost'));
        return Promise.resolve({ rows: [{ photo_id: lowest.id }], rowCount: 1 });
      },
    } as never;
    const sink: PersonPhotoSink = {
      note: async (_p, _t, _id, sourceUrl) => void calls.push(`note ${sourceUrl}`),
      noteFirst: async (_p, _t, _id, sourceUrl) => void calls.push(`first ${sourceUrl}`),
    };
    let now = 0;
    const photos = new PersonPhotos(pool, sink, () => now);
    return {
      photos,
      calls,
      lookups: () => lookups,
      advance: (ms: number) => {
        now += ms;
      },
    };
  }

  it('asks once within its memory, and sees a merge once that has passed', async () => {
    const lowest: { id: string | null } = { id: '200' };
    const w = world(lowest);
    await w.photos.notePhoto('api_football', 'p', '200', 'u200');
    // Merged: the person now holds 100 too, the new lowest.
    lowest.id = '100';
    await w.photos.notePhoto('api_football', 'p', '100', 'u100');
    await w.photos.notePhoto('api_football', 'p', '200', 'u200');
    expect(w.lookups()).toBe(1);
    w.advance(PHOTO_ID_TTL_MS);
    await w.photos.notePhoto('api_football', 'p', '100', 'u100');
    await w.photos.notePhoto('api_football', 'p', '200', 'u200');
    expect(w.lookups()).toBe(2);
    // Before the memory passed, 200 was the photo id; after, 100 is: one change, never back.
    expect(w.calls).toEqual(['note u200', 'first u100', 'note u200', 'note u100', 'first u200']);
  });

  it('notes only an empty place for an id no mapping names', async () => {
    const w = world({ id: null });
    await w.photos.notePhoto('api_football', 'p', '7', 'u7');
    expect(w.calls).toEqual(['first u7']);
  });

  it('never throws, and notes nothing, when the lookup fails', async () => {
    const w = world({ id: '1', fail: true });
    await expect(w.photos.notePhoto('api_football', 'p', '1', 'u1')).resolves.toBeUndefined();
    expect(w.calls).toEqual([]);
  });
});
