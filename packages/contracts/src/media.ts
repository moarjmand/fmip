/**
 * Entity media (T-1320, D-176): a team's crest, a competition's logo, a
 * person's photo, served from our own origin.
 *
 * The provider's image is copied once onto our own volume; a response carries
 * only our own relative address, never the provider's (rule 2), so a reader's
 * browser asks nothing of anyone but this site (the rule D-089 applied to
 * fonts). The address carries a short hash of the file, so a new crest is a
 * new address and a cached copy can be kept for a year.
 *
 * Missing media is a state, not an empty string (rule 3): `not_supplied` when
 * the provider has no real image (a player it shows only as a silhouette) or
 * we have not stored one yet. A surface draws its own neutral mark then, and
 * never the provider's silhouette.
 */

/** Which image of which entity: crest (team), logo (competition), photo (person). */
export const MEDIA_KINDS = ['crest', 'logo', 'photo'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

/**
 * Where the web app answers for a stored image, on the site's own origin:
 * `${MEDIA_PATH_PREFIX}/<kind>/<entity uuid>/<version>`. The web app hands the
 * request to the API's `GET /media/<kind>/<id>/<version>`.
 */
export const MEDIA_PATH_PREFIX = '/api/media';

export type EntityMedia =
  | {
      coverage: 'available';
      /** Our own relative address, e.g. `/api/media/crest/<uuid>/<version>`. */
      url: string;
    }
  | { coverage: 'not_supplied'; url: null };

/** The one value for "no image", so every surface says it the same way. */
export const NO_MEDIA: EntityMedia = { coverage: 'not_supplied', url: null };

/** Our own address for a stored image of `kind` for entity `id` at `version`. */
export function mediaUrl(kind: MediaKind, id: string, version: string): string {
  return `${MEDIA_PATH_PREFIX}/${kind}/${id}/${version}`;
}
