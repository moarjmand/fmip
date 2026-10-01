import { Inject, Injectable, Logger } from '@nestjs/common';
import type { EntityMedia, MediaKind } from '@fmip/contracts';
import { NO_MEDIA, mediaUrl } from '@fmip/contracts';
import { Pool } from 'pg';
import { PG_POOL } from '../../database/database.module';
import { versionOf } from './internal/image-check';
import {
  KIND_OF,
  MediaStore,
  type MediaEntityType,
  type ServedMedia,
} from './internal/media-store';

export type { MediaEntityType } from './internal/media-store';

/** Our own address and coverage for each entity's image, read in one query. */
export interface MediaIndex {
  crest(teamId: string): EntityMedia;
  logo(competitionId: string): EntityMedia;
  photo(personId: string): EntityMedia;
}

/** Entity ids to look up, by type. */
export type MediaRequest = Partial<Record<MediaEntityType, Iterable<string>>>;

/** An index that knows nothing: every image is `not_supplied`. */
export const EMPTY_MEDIA_INDEX: MediaIndex = {
  crest: () => NO_MEDIA,
  logo: () => NO_MEDIA,
  photo: () => NO_MEDIA,
};

/** How many noted addresses a process remembers, so an unchanged one costs no query. */
const NOTED_CAP = 50_000;

/**
 * The media boundary's public service (T-1320, D-176).
 *
 * Two callers: the ingestion writers `note` the provider's address for an
 * entity's image as they resolve it, and the read modules ask `index` for our
 * own address of each image a response shows. Neither ever sees the other's
 * half: `index` reads only stored files, never a provider address (rule 2).
 */
@Injectable()
export class MediaService {
  private readonly log = new Logger('Media');
  private readonly store: MediaStore;
  private readonly noted = new Map<string, string>();

  constructor(@Inject(PG_POOL) pool: Pool) {
    this.store = new MediaStore(pool);
  }

  /**
   * Records where the provider keeps an entity's image. Never throws: an image
   * is never a reason for a match write to fail, so a failure is logged and
   * the next sighting tries again.
   */
  async note(
    provider: string,
    entityType: MediaEntityType,
    entityId: string,
    sourceUrl: string,
  ): Promise<void> {
    const key = `${entityType}:${entityId}`;
    if (this.noted.get(key) === `${provider} ${sourceUrl}`) return;
    try {
      await this.store.note(provider, entityType, entityId, sourceUrl);
      if (this.noted.size >= NOTED_CAP) this.noted.clear();
      this.noted.set(key, `${provider} ${sourceUrl}`);
    } catch (error) {
      this.log.warn('could not note an image address', {
        event: 'media.note_failed',
        entity_type: entityType,
        entity_id: entityId,
        error: (error as Error).message,
      });
    }
  }

  /** Our own address for each requested image that is stored; `not_supplied` for the rest. */
  async index(request: MediaRequest): Promise<MediaIndex> {
    const ids = {
      team: [...new Set(request.team ?? [])],
      competition: [...new Set(request.competition ?? [])],
      person: [...new Set(request.person ?? [])],
    };
    const rows = await this.store.available(ids);
    if (rows.length === 0) return EMPTY_MEDIA_INDEX;
    const found = new Map<string, EntityMedia>();
    for (const row of rows) {
      const kind = KIND_OF[row.entityType];
      found.set(`${kind}:${row.entityId}`, {
        coverage: 'available',
        url: mediaUrl(kind, row.entityId, versionOf(row.sha256)),
      });
    }
    const of = (kind: MediaKind) => (id: string) => found.get(`${kind}:${id}`) ?? NO_MEDIA;
    return { crest: of('crest'), logo: of('logo'), photo: of('photo') };
  }

  /** The stored file behind one address, for the serving route. */
  served(kind: MediaKind, entityId: string): Promise<ServedMedia | null> {
    return this.store.served(kind, entityId);
  }

  /** The route found the row but not the file: the fetch job fetches it again. */
  async lost(id: string): Promise<void> {
    this.log.warn('a stored image is missing from the volume', { event: 'media.file_missing', id });
    await this.store.lost(id);
  }
}
