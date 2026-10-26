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

/**
 * Which image of which entity: crest (team), logo (competition), photo
 * (person), venue (a picture of the ground, T-1438), flag (country, T-1611,
 * D-282).
 */
export const MEDIA_KINDS = ['crest', 'logo', 'photo', 'venue', 'flag'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

/**
 * Where the web app answers for a stored image, on the site's own origin:
 * `${MEDIA_PATH_PREFIX}/<kind>/<entity uuid>/<version>.<extension>`. The web app hands the
 * request to the API's `GET /media/<kind>/<id>/<version>`.
 */
export const MEDIA_PATH_PREFIX = '/api/media';

export type EntityMedia =
  | {
      coverage: 'available';
      /** Our own relative address, e.g. `/api/media/crest/<uuid>/<version>.png`. */
      url: string;
    }
  | { coverage: 'not_supplied'; url: null };

/** The one value for "no image", so every surface says it the same way. */
export const NO_MEDIA: EntityMedia = { coverage: 'not_supplied', url: null };

/**
 * The file extension of each type we store (T-1461). The address ends in it
 * because Cloudflare keeps a response at the edge by the path's extension
 * unless a dashboard rule says otherwise: `/api/media/crest/<id>/<version>`,
 * with no extension, was fetched from the origin on every view despite being
 * `immutable`.
 */
export const MEDIA_EXTENSIONS = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
} as const;
export type MediaContentType = keyof typeof MEDIA_EXTENSIONS;

/**
 * Our own address for a stored image of `kind` for entity `id` at `version`,
 * ending in the extension of its type: `/api/media/crest/<uuid>/<version>.png`.
 */
export function mediaUrl(
  kind: MediaKind,
  id: string,
  version: string,
  contentType: MediaContentType,
): string {
  return `${MEDIA_PATH_PREFIX}/${kind}/${id}/${version}.${MEDIA_EXTENSIONS[contentType]}`;
}

/**
 * The widths a stored raster image is also served at, as WebP (T-1462,
 * D-242): `<version>-<width>.webp` beside `<version>.<extension>`. Few on
 * purpose, so the edge and the volume hold few copies: a surface takes the
 * smallest at least twice its box (`mediaSized`).
 */
export const MEDIA_WIDTHS = [48, 96, 192] as const;
export type MediaWidth = (typeof MEDIA_WIDTHS)[number];

/**
 * The version an address's last segment names: `abc123def456.png`,
 * `abc123def456-96.webp` and the addresses written before T-1461,
 * `abc123def456`, alike.
 */
export function mediaVersionOf(segment: string): string {
  return /^[^.-]*/.exec(segment)![0];
}

/** The width a variant's segment asks for (`abc123def456-96.webp`), or `null` for the stored file. */
export function mediaWidthOf(segment: string): number | null {
  const found = /^[^.-]+-([0-9]+)\.webp$/.exec(segment);
  return found === null ? null : Number(found[1]);
}

/**
 * The address of a stored image at the size a box of `cssPixels` draws it
 * (T-1462): the WebP variant at the smallest width in `MEDIA_WIDTHS` that is
 * at least twice the box, for a sharp image on a high-density screen. An SVG,
 * which has no pixels to save, and an address of another shape stay as they are.
 */
export function mediaSized(url: string, cssPixels: number): string {
  const found = /^(.*\/)([0-9a-f]+)\.(png|jpg|webp)$/.exec(url);
  if (found === null) return url;
  const width =
    MEDIA_WIDTHS.find((w) => w >= cssPixels * 2) ?? MEDIA_WIDTHS[MEDIA_WIDTHS.length - 1];
  return `${found[1]}${found[2]}-${width}.webp`;
}
