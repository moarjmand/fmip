import type { SearchEntityType, SearchResult } from '@fmip/contracts';
import type { MediaIndex, MediaRequest } from '../../media/media.service';

/**
 * Each entity result's image (T-1617): a team's crest, a competition's logo,
 * a person's photo, from our own origin (D-176) in one media read for the
 * whole page of results; `not_supplied` where none is held (rule 3).
 */

/** The ids of a page of results, by the media store's entity type. */
export function imageRequest(results: readonly SearchResult[]): MediaRequest {
  const of = (type: SearchEntityType) => results.filter((r) => r.type === type).map((r) => r.id);
  return { team: of('team'), competition: of('competition'), person: of('person') };
}

/** The results with their images. */
export function withImages(
  results: readonly SearchResult[],
  media: Pick<MediaIndex, 'crest' | 'logo' | 'photo'>,
): SearchResult[] {
  return results.map((r) => ({
    ...r,
    image:
      r.type === 'team'
        ? media.crest(r.id)
        : r.type === 'competition'
          ? media.logo(r.id)
          : media.photo(r.id),
  }));
}
