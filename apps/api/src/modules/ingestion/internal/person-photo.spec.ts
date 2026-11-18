import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MediaService } from '../../media/media.service';
import { PERSON_IDS_TTL_MS, PersonPhotos, type PersonPhotoSink } from './person-photo';

/**
 * A person's photo when he holds several provider ids (T-1869, D-452): one id
 * notes as before; several only fill an empty place (no address, or one whose
 * image the fetch found unusable a day ago or more). On a database with the
 * real media store: a merged person's address never goes back and forth
 * however his ids alternate, an available image is never touched, a kept row
 * with no image is filled from another id, and a person with one id is noted
 * exactly as before. Then, with no database, the memory of a person's ids.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const PROVIDER = 'api_football' as const;

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  'a person photo on the media store (T-1869)',
  () => {
    let pool: Pool;
    const merged = randomUUID();
    const single = randomUUID();
    const later = randomUUID();
    // Provider ids are numbers; a coach's is `coach:` and a number (D-230).
    const base = 8_000_000_000 + Math.floor(Math.random() * 1_000_000_000);
    const low = String(base);
    const high = String(base + 1);
    const coach = `coach:${base}`;
    const only = String(base + 2);
    const laterA = String(base + 3);
    const laterB = String(base + 4);
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
    /** The fetch job's verdict on the stored address, `hoursAgo` hours back. */
    const fetched = (
      personId: string,
      verdict: 'available' | 'not_supplied' | 'failed',
      hoursAgo: number,
    ) =>
      pool.query(
        verdict === 'available'
          ? `UPDATE entity_media SET state = 'available', sha256 = repeat('a', 64),
                    storage_key = 'aa/' || repeat('a', 64) || '.png', content_type = 'image/png',
                    byte_size = 100, source_fetched_at = now(),
                    last_checked_at = now() - make_interval(hours => $2)
              WHERE entity_type = 'person' AND entity_id = $1`
          : `UPDATE entity_media SET state = $3, last_checked_at = now() - make_interval(hours => $2)
              WHERE entity_type = 'person' AND entity_id = $1`,
        verdict === 'available' ? [personId, hoursAgo] : [personId, hoursAgo, verdict],
      );
    const map = (external: string, internal: string) =>
      pool.query(
        `INSERT INTO provider_mapping (provider, entity_type, external_id, internal_id)
         VALUES ($1, 'person', $2, $3)`,
        [PROVIDER, external, internal],
      );

    beforeAll(async () => {
      pool = new Pool({ connectionString: DATABASE_URL });
      await pool.query(
        `INSERT INTO person (id, full_name)
         VALUES ($1, 'T-1869 Merged'), ($2, 'T-1869 Single'), ($3, 'T-1869 Later')`,
        [merged, single, later],
      );
      for (const [external, internal] of [
        [low, merged],
        [high, merged],
        [coach, merged],
        [only, single],
        [laterA, later],
      ] as const) {
        await map(external, internal);
      }
    });

    afterAll(async () => {
      const persons = [merged, single, later];
      await pool?.query(`DELETE FROM entity_media WHERE entity_id = ANY($1::uuid[])`, [persons]);
      await pool?.query(`DELETE FROM provider_mapping WHERE internal_id = ANY($1::uuid[])`, [
        persons,
      ]);
      await pool?.query(`DELETE FROM person WHERE id = ANY($1::uuid[])`, [persons]);
      await pool?.end();
    });

    it('never switches a merged person back and forth, however his ids alternate', async () => {
      const order = [high, low, high, coach, low, high, coach, low];
      const seen: string[] = [];
      for (const id of order) {
        await mention(merged, id);
        seen.push((await stored(merged))!.source_url);
      }
      // The first mention filled the empty place; the pending address waits for its fetch.
      expect(seen).toEqual(order.map(() => url(high)));

      // Fetched and served: alternating mentions do not touch the row, so nothing is fetched again.
      await fetched(merged, 'available', 0);
      const before = (await stored(merged))!;
      for (const id of [low, coach, high, low, coach]) await mention(merged, id);
      expect(await stored(merged)).toEqual(before);
    });

    it('fills a kept row with no usable image from another id, and an available image stays', async () => {
      // As a merge keeps the survivor's row: the provider had no image for that id.
      await fetched(merged, 'not_supplied', 48);
      await mention(merged, low);
      expect(await stored(merged)).toMatchObject({ source_url: url(low), state: 'pending' });

      // A failed fetch is no image either.
      await fetched(merged, 'failed', 48);
      await mention(merged, coach);
      expect(await stored(merged)).toMatchObject({ source_url: url(coach), state: 'pending' });

      await fetched(merged, 'available', 48);
      const before = (await stored(merged))!;
      for (const id of [low, high]) await mention(merged, id);
      expect(await stored(merged)).toEqual(before);
    });

    it('tries the next address at most once a day when no id gives an image', async () => {
      await fetched(merged, 'not_supplied', 0);
      const before = (await stored(merged))!;
      for (const id of [low, high, low]) await mention(merged, id);
      expect(await stored(merged)).toEqual(before);
      await fetched(merged, 'not_supplied', 25);
      await mention(merged, high);
      expect(await stored(merged)).toMatchObject({ source_url: url(high), state: 'pending' });
    });

    it('holds within one process, where both services remember what they did', async () => {
      await pool.query(`DELETE FROM entity_media WHERE entity_id = $1`, [merged]);
      const photos = new PersonPhotos(pool, new MediaService(pool));
      const seen: string[] = [];
      for (const id of [coach, high, low, coach, high, low]) {
        await photos.notePhoto(PROVIDER, merged, id, url(id));
        seen.push((await stored(merged))!.source_url);
      }
      expect(seen).toEqual(Array<string>(6).fill(url(coach)));
    });

    it('notes a person with one id exactly as before: a new address replaces the stored one', async () => {
      await mention(single, only);
      expect(await stored(single)).toMatchObject({ source_url: url(only), state: 'pending' });
      const moved = 'https://media-2.api-sports.io/football/players/moved.png';
      await mention(single, only, moved);
      expect((await stored(single))!.source_url).toBe(moved);
      await fetched(single, 'available', 0);
      await mention(single, only);
      expect(await stored(single)).toMatchObject({ source_url: url(only), state: 'available' });
    });

    it('sees a merge at once: a new id is asked about, not taken from memory', async () => {
      const photos = new PersonPhotos(pool, new MediaService(pool));
      await photos.notePhoto(PROVIDER, later, laterA, url(laterA));
      await fetched(later, 'available', 0);
      // Merged: the person now holds a second id.
      await map(laterB, later);
      await photos.notePhoto(PROVIDER, later, laterB, url(laterB));
      await photos.notePhoto(PROVIDER, later, laterA, url(laterA));
      expect(await stored(later)).toMatchObject({ source_url: url(laterA), state: 'available' });
    });
  },
);

describe('the memory of a person’s ids (T-1869)', () => {
  function world(answer: { ids: string[] | null; fail?: boolean }) {
    const calls: string[] = [];
    let lookups = 0;
    const pool = {
      query: () => {
        lookups += 1;
        if (answer.fail === true) return Promise.reject(new Error('connection lost'));
        return Promise.resolve({ rows: [{ ids: answer.ids }], rowCount: 1 });
      },
    } as never;
    const sink: PersonPhotoSink = {
      note: async (_p, _t, _id, sourceUrl) => void calls.push(`note ${sourceUrl}`),
      noteIfEmpty: async (_p, _t, _id, sourceUrl) => void calls.push(`fill ${sourceUrl}`),
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

  it('notes one id as before, fills only for several, and asks once within its memory', async () => {
    const answer: { ids: string[] | null } = { ids: ['7'] };
    const w = world(answer);
    await w.photos.notePhoto('api_football', 'p', '7', 'u7');
    await w.photos.notePhoto('api_football', 'p', '7', 'u7');
    expect(w.lookups()).toBe(1);
    // Merged: an id the memory does not hold is asked about at once.
    answer.ids = ['100', '7'];
    await w.photos.notePhoto('api_football', 'p', '100', 'u100');
    await w.photos.notePhoto('api_football', 'p', '7', 'u7');
    expect(w.lookups()).toBe(2);
    expect(w.calls).toEqual(['note u7', 'note u7', 'fill u100', 'fill u7']);
  });

  it('asks again once its memory has passed', async () => {
    const w = world({ ids: ['7'] });
    await w.photos.notePhoto('api_football', 'p', '7', 'u7');
    w.advance(PERSON_IDS_TTL_MS);
    await w.photos.notePhoto('api_football', 'p', '7', 'u7');
    expect(w.lookups()).toBe(2);
  });

  it('only fills for an id no mapping names', async () => {
    const w = world({ ids: null });
    await w.photos.notePhoto('api_football', 'p', '7', 'u7');
    expect(w.calls).toEqual(['fill u7']);
  });

  it('never throws, and notes nothing, when the lookup fails', async () => {
    const w = world({ ids: ['1'], fail: true });
    await expect(w.photos.notePhoto('api_football', 'p', '1', 'u1')).resolves.toBeUndefined();
    expect(w.calls).toEqual([]);
  });
});
