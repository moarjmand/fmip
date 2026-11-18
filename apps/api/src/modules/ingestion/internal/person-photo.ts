import type { Provider } from '@fmip/ingestion';
import type { Pool } from 'pg';

/**
 * A person's photo when he holds several provider ids (T-1869, D-452).
 *
 * A merged person (T-1863) holds several of a provider's ids, player and
 * `coach:` alike, and the provider's photo address carries the id it was
 * given under; both ids are often mentioned in the same match (D-446: one
 * holds the line-up, the other the statistics). Noting every mention's address
 * as it came would switch the stored address on each mention under the other
 * id, fetch again and alternate the photo shown. So one rule, for every place
 * that notes a person's photo (the match writes, the squads sweep, the coaches
 * job):
 *
 * - a person with **one id** is noted as he always was (`MediaService.note`):
 *   a new address replaces the stored one;
 * - a person with **several ids** only has an empty place filled
 *   (`MediaService.noteIfEmpty`): an address is written when he holds none,
 *   or when the one he holds was found to give no usable image (`not_supplied`
 *   or `failed`) more than a day ago. An available image, or an address still
 *   waiting for its fetch, is never replaced.
 *
 * So a merged person's photo, once fetched, stays; one his ids keep offering
 * in turn never alternates; a merged person whose kept row has no image (a
 * dead id's silhouette) takes the next id's address; and when no id gives an
 * image, the addresses are tried at most once a day. Which hosts are fetched,
 * and what is served, stays the media module's (D-176).
 *
 * The person's ids are remembered ten minutes; a mention under an id the
 * memory does not hold (a merge just made) asks again at once.
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
  /** Records the address only into an empty place (no address, or one with no usable image). */
  noteIfEmpty(
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

/** How long a person's ids are remembered. */
export const PERSON_IDS_TTL_MS = 10 * 60 * 1000;
/** How many persons' ids a process remembers. */
const PERSON_IDS_CAP = 50_000;

/**
 * The one instance a process uses (`IngestionJobsService` hands it to every
 * writer), so every writer sees the same memory of a person's ids.
 */
export class PersonPhotos implements PersonPhotoNoter {
  private readonly ids = new Map<string, { ids: string[]; at: number }>();

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
    let ids: string[];
    try {
      ids = await this.idsOf(provider, personId, externalId);
    } catch {
      return;
    }
    if (ids.length === 1 && ids[0] === externalId) {
      await this.sink.note(provider, 'person', personId, sourceUrl);
    } else {
      await this.sink.noteIfEmpty(provider, 'person', personId, sourceUrl);
    }
  }

  /** The person's ids at the provider, remembered; asked again for an id the memory lacks. */
  private async idsOf(provider: Provider, personId: string, externalId: string): Promise<string[]> {
    const key = `${provider} ${personId}`;
    const now = this.clock();
    const held = this.ids.get(key);
    if (held !== undefined && now - held.at < PERSON_IDS_TTL_MS && held.ids.includes(externalId)) {
      return held.ids;
    }
    const { rows } = await this.pool.query<{ ids: string[] | null }>(
      `SELECT array_agg(external_id ORDER BY external_id) AS ids FROM provider_mapping
        WHERE provider = $1 AND entity_type = 'person' AND internal_id = $2`,
      [provider, personId],
    );
    const ids = rows[0]?.ids ?? [];
    if (this.ids.size >= PERSON_IDS_CAP) this.ids.clear();
    this.ids.set(key, { ids, at: now });
    return ids;
  }
}
