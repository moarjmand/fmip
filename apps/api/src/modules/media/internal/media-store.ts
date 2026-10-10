/**
 * The SQL of the media store (T-1320, D-176), over `entity_media`.
 *
 * `source_url` is selected in exactly one place, `due()`, which only the fetch
 * job calls. The reads that feed a response (`available`, `served`) never
 * select it, so a provider's address cannot reach a contract by accident
 * (rule 2).
 */

import type { Pool } from 'pg';
import type { MediaKind } from '@fmip/contracts';
import type { MediaContentType } from './image-check';

export type MediaEntityType = 'team' | 'competition' | 'person';

export const KIND_OF: Record<MediaEntityType, MediaKind> = {
  team: 'crest',
  competition: 'logo',
  person: 'photo',
};

export const ENTITY_OF: Record<MediaKind, MediaEntityType> = {
  crest: 'team',
  logo: 'competition',
  photo: 'person',
};

export type MediaState = 'pending' | 'available' | 'not_supplied' | 'failed';

/** One row the fetch job should ask for. */
export interface DueMedia {
  id: string;
  entityType: MediaEntityType;
  entityId: string;
  kind: MediaKind;
  sourceUrl: string;
  state: MediaState;
  sha256: string | null;
  attempts: number;
}

/** What the serving route needs, and nothing else. */
export interface ServedMedia {
  id: string;
  storageKey: string;
  contentType: MediaContentType;
  sha256: string;
}

/** A stored image is re-checked after this long (D-176: monthly). */
export const REFRESH_DAYS = 30;

export class MediaStore {
  constructor(private readonly pool: Pool) {}

  /**
   * Records the provider's address for an entity's image. A new address makes
   * the row due at once; an unchanged one writes nothing. A stored file stays
   * served until its replacement has been fetched.
   */
  async note(
    provider: string,
    entityType: MediaEntityType,
    entityId: string,
    sourceUrl: string,
  ): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      // An address already held is left out before the conflict, which would
      // lock the row even when nothing changes (T-1374, D-192).
      `INSERT INTO entity_media (entity_type, entity_id, kind, source_provider, source_url)
       SELECT $1::text, $2::uuid, $3::text, $4::text, $5::text
        WHERE NOT EXISTS (
                SELECT 1 FROM entity_media
                 WHERE entity_type = $1::text AND entity_id = $2::uuid AND kind = $3::text
                   AND (source_url, source_provider) IS NOT DISTINCT FROM ($5::text, $4::text))
       ON CONFLICT (entity_type, entity_id, kind) DO UPDATE
         SET source_provider = EXCLUDED.source_provider,
             source_url = EXCLUDED.source_url,
             state = CASE WHEN entity_media.state = 'available' THEN 'available' ELSE 'pending' END,
             last_checked_at = NULL,
             attempts = 0,
             failure = NULL
       WHERE entity_media.source_url IS DISTINCT FROM EXCLUDED.source_url
          OR entity_media.source_provider IS DISTINCT FROM EXCLUDED.source_provider`,
      [entityType, entityId, KIND_OF[entityType], provider, sourceUrl],
    );
    return (rowCount ?? 0) > 0;
  }

  /**
   * What the fetch job should ask for now, at most `limit`: never fetched
   * first (competitions, then teams, then people -- the few that every page
   * shows before the many), then those due a monthly re-check, then failures
   * whose back-off has passed (2^attempts hours, at most the refresh period).
   */
  async due(now: Date, limit: number): Promise<DueMedia[]> {
    const { rows } = await this.pool.query<{
      id: string;
      entity_type: MediaEntityType;
      entity_id: string;
      kind: MediaKind;
      source_url: string;
      state: MediaState;
      sha256: string | null;
      attempts: number;
    }>(
      `SELECT id, entity_type, entity_id, kind, source_url, state, sha256, attempts
         FROM entity_media
        WHERE (state = 'pending' AND last_checked_at IS NULL)
           OR (state IN ('available', 'not_supplied')
               AND (last_checked_at IS NULL
                    OR last_checked_at < $1::timestamptz - make_interval(days => $3)))
           OR (state IN ('failed', 'pending') AND last_checked_at IS NOT NULL
               AND last_checked_at < $1::timestamptz
                 - make_interval(hours => LEAST($3 * 24, power(2, LEAST(attempts, 10))::int)))
        ORDER BY (last_checked_at IS NULL) DESC,
                 CASE entity_type WHEN 'competition' THEN 0 WHEN 'team' THEN 1 ELSE 2 END,
                 last_checked_at NULLS FIRST, created_at
        LIMIT $2`,
      [now.toISOString(), limit, REFRESH_DAYS],
    );
    return rows.map((r) => ({
      id: r.id,
      entityType: r.entity_type,
      entityId: r.entity_id,
      kind: r.kind,
      sourceUrl: r.source_url,
      state: r.state,
      sha256: r.sha256,
      attempts: r.attempts,
    }));
  }

  /** A file was stored (or confirmed unchanged) for this row. */
  async stored(
    id: string,
    file: { storageKey: string; contentType: MediaContentType; byteSize: number; sha256: string },
    now: Date,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE entity_media
          SET state = 'available', storage_key = $2, content_type = $3, byte_size = $4,
              sha256 = $5, source_fetched_at = $6, last_checked_at = $6, attempts = 0,
              failure = NULL
        WHERE id = $1`,
      [id, file.storageKey, file.contentType, file.byteSize, file.sha256, now.toISOString()],
    );
  }

  /** The provider has no image for this row: the file columns are cleared. */
  async notSupplied(id: string, reason: string, now: Date): Promise<void> {
    await this.pool.query(
      `UPDATE entity_media
          SET state = 'not_supplied', storage_key = NULL, content_type = NULL, byte_size = NULL,
              sha256 = NULL, source_fetched_at = $3, last_checked_at = $3, attempts = 0,
              failure = $2
        WHERE id = $1`,
      [id, reason, now.toISOString()],
    );
  }

  /**
   * An attempt failed. A row that had a file keeps it and stays `available`
   * (the old crest is still the crest); one that had none becomes `failed`.
   */
  async failed(id: string, reason: string, now: Date): Promise<void> {
    await this.pool.query(
      `UPDATE entity_media
          SET state = CASE WHEN state = 'available' THEN 'available' ELSE 'failed' END,
              last_checked_at = $3, attempts = attempts + 1, failure = left($2, 500)
        WHERE id = $1`,
      [id, reason, now.toISOString()],
    );
  }

  /**
   * How many different people already have this exact photo stored. The
   * provider's silhouette is the one photo many people share (PLACEHOLDER_REPEATS).
   */
  async photoSharers(sha256: string, exceptId: string): Promise<number> {
    const { rows } = await this.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM entity_media
        WHERE kind = 'photo' AND sha256 = $1 AND id <> $2`,
      [sha256, exceptId],
    );
    return rows[0]?.n ?? 0;
  }

  /** Every person whose stored photo is this placeholder is told `not_supplied` instead. */
  async retirePlaceholder(sha256: string, now: Date): Promise<number> {
    const { rowCount } = await this.pool.query(
      `UPDATE entity_media
          SET state = 'not_supplied', storage_key = NULL, content_type = NULL, byte_size = NULL,
              sha256 = NULL, last_checked_at = $2, failure = 'provider placeholder'
        WHERE kind = 'photo' AND sha256 = $1`,
      [sha256, now.toISOString()],
    );
    return rowCount ?? 0;
  }

  /** The stored-image hashes of these entities, for building our own addresses. */
  async available(
    ids: Partial<Record<MediaEntityType, readonly string[]>>,
  ): Promise<{ entityType: MediaEntityType; entityId: string; sha256: string }[]> {
    const team = [...(ids.team ?? [])];
    const competition = [...(ids.competition ?? [])];
    const person = [...(ids.person ?? [])];
    if (team.length + competition.length + person.length === 0) return [];
    const { rows } = await this.pool.query<{
      entity_type: MediaEntityType;
      entity_id: string;
      sha256: string;
    }>(
      `SELECT entity_type, entity_id, sha256 FROM entity_media
        WHERE state = 'available'
          AND ((entity_type = 'team' AND entity_id = ANY($1::uuid[]))
            OR (entity_type = 'competition' AND entity_id = ANY($2::uuid[]))
            OR (entity_type = 'person' AND entity_id = ANY($3::uuid[])))`,
      [team, competition, person],
    );
    return rows.map((r) => ({
      entityType: r.entity_type,
      entityId: r.entity_id,
      sha256: r.sha256,
    }));
  }

  /** The stored file for one image, or `null` when there is none to serve. */
  async served(kind: MediaKind, entityId: string): Promise<ServedMedia | null> {
    const { rows } = await this.pool.query<{
      id: string;
      storage_key: string;
      content_type: MediaContentType;
      sha256: string;
    }>(
      `SELECT id, storage_key, content_type, sha256 FROM entity_media
        WHERE kind = $1 AND entity_type = $2 AND entity_id = $3 AND state = 'available'`,
      [kind, ENTITY_OF[kind], entityId],
    );
    const row = rows[0];
    return row === undefined
      ? null
      : {
          id: row.id,
          storageKey: row.storage_key,
          contentType: row.content_type,
          sha256: row.sha256,
        };
  }

  /** The row says available but the file is gone (a lost volume): fetch it again. */
  async lost(id: string): Promise<void> {
    await this.pool.query(
      `UPDATE entity_media
          SET state = 'pending', storage_key = NULL, content_type = NULL, byte_size = NULL,
              sha256 = NULL, last_checked_at = NULL, failure = 'file missing from the volume'
        WHERE id = $1 AND state = 'available'`,
      [id],
    );
  }
}
