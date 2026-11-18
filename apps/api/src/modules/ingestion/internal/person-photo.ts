import type { Provider } from '@fmip/ingestion';
import type { Pool } from 'pg';

/**
 * Which of a person's provider ids his photo comes from (T-1869, D-452).
 *
 * A merged person (T-1863) holds several of a provider's ids, player and
 * `coach:` alike, and the provider's photo address carries the id it was
 * given under. Noting every mention's address as it came would switch the
 * stored address on each mention under the other id, fetch again and
 * alternate the photo shown. So one rule, for every place that notes a
 * person's photo (the match writes, the squads sweep, the coaches job):
 *
 * - the person's **photo id** is his lowest id at that provider,
 *   `min(external_id)` over all his mappings, the order the per-person jobs
 *   ask in (`person-ids.ts`);
 * - a mention under the photo id notes its address as it always did, so a new
 *   address there replaces the stored one;
 * - a mention under any other id only fills an empty place: it is noted when
 *   the person has no photo address at all, and never replaces one.
 *
 * Once an address is held, only the photo id can change it, so mentions under
 * two ids in any order switch it at most once (to the photo id's) and never
 * back. A person with one id is always at his photo id: unchanged. Which
 * hosts are fetched, and what is served, stays the media module's (D-176).
 */

/** Where a person's photo address goes. `MediaService`; neither ever throws. */
export interface PersonPhotoSink {
  /** Records the address, replacing a different one already held. */
  note(
    provider: Provider,
    entityType: 'person',
    entityId: string,
    sourceUrl: string,
  ): Promise<void>;
  /** Records the address only when the person holds none. */
  noteFirst(
    provider: Provider,
    entityType: 'person',
    entityId: string,
    sourceUrl: string,
  ): Promise<void>;
}

/** What the three writers call: one mention of a person's photo, under one provider id. */
export interface PersonPhotoNoter {
  notePhoto(
    provider: Provider,
    personId: string,
    externalId: string,
    sourceUrl: string,
  ): Promise<void>;
}

/** How long a person's photo id is remembered: a merge is seen within this. */
export const PHOTO_ID_TTL_MS = 10 * 60 * 1000;
/** How many persons' photo ids a process remembers. */
const PHOTO_ID_CAP = 50_000;

export class PersonPhotos implements PersonPhotoNoter {
  private readonly photoIds = new Map<string, { id: string | null; at: number }>();

  constructor(
    private readonly pool: Pool,
    private readonly sink: PersonPhotoSink,
    private readonly clock: () => number = Date.now,
  ) {}

  /** Never throws: a photo is never a reason for a write to fail; the next mention tries again. */
  async notePhoto(
    provider: Provider,
    personId: string,
    externalId: string,
    sourceUrl: string,
  ): Promise<void> {
    let photoId: string | null;
    try {
      photoId = await this.photoId(provider, personId);
    } catch {
      return;
    }
    if (photoId === externalId) {
      await this.sink.note(provider, 'person', personId, sourceUrl);
    } else {
      await this.sink.noteFirst(provider, 'person', personId, sourceUrl);
    }
  }

  /** The person's lowest id at the provider, remembered for `PHOTO_ID_TTL_MS`. */
  private async photoId(provider: Provider, personId: string): Promise<string | null> {
    const key = `${provider} ${personId}`;
    const now = this.clock();
    const held = this.photoIds.get(key);
    if (held !== undefined && now - held.at < PHOTO_ID_TTL_MS) return held.id;
    const { rows } = await this.pool.query<{ photo_id: string | null }>(
      `SELECT min(external_id) AS photo_id FROM provider_mapping
        WHERE provider = $1 AND entity_type = 'person' AND internal_id = $2`,
      [provider, personId],
    );
    const id = rows[0]?.photo_id ?? null;
    if (this.photoIds.size >= PHOTO_ID_CAP) this.photoIds.clear();
    this.photoIds.set(key, { id, at: now });
    return id;
  }
}
