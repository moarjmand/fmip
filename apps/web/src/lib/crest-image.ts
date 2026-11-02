import { MEDIA_PATH_PREFIX, type EntityMedia } from '@fmip/contracts';

/**
 * A crest for a share card (T-1723), as a `data:` address the renderer can
 * draw without fetching anything itself. Read from the API over the internal
 * network -- the address the contracts name (`/api/media/...`) is the site's
 * own, behind Cloudflare, which a server should not go out and back through.
 *
 * `null` -- the card draws an empty ring, never a made-up badge (rule 3) --
 * when no crest is supplied, when it cannot be read within a second and a
 * half, or when it is a kind the renderer cannot draw (it reads PNG, JPEG and
 * SVG; a WebP variant is never asked for).
 */

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://127.0.0.1:3001';
const DRAWABLE = new Set(['image/png', 'image/jpeg', 'image/svg+xml']);
const TIMEOUT_MS = 1500;
/** A crest is a few kilobytes; anything far larger is not one worth inlining. */
const MAX_BYTES = 512 * 1024;

export async function crestDataUrl(
  media: EntityMedia | undefined,
  fetcher: typeof fetch = fetch,
): Promise<string | null> {
  if (media === undefined || media.coverage !== 'available') return null;
  if (!media.url.startsWith(`${MEDIA_PATH_PREFIX}/`)) return null;
  const path = media.url.slice('/api'.length);
  try {
    const response = await fetcher(`${API_BASE_URL}${path}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const type = (response.headers.get('content-type') ?? '').split(';')[0]?.trim() ?? '';
    if (!DRAWABLE.has(type)) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_BYTES) return null;
    return `data:${type};base64,${bytes.toString('base64')}`;
  } catch {
    return null;
  }
}
