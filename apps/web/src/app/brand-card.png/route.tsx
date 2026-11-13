import { drawCard } from '@/components/draw-card';
import { BrandCardImage } from '@/components/share-card-image';
import { siteUrl } from '@/lib/seo';

/**
 * The brand card (T-1825, D-419; B10 "Typographic wall"): the `og:image` of
 * every page that has no card of its own -- the home page, news, the model
 * and its accuracy, the competitions, the leaderboard, About and the rest.
 * `pageMetadata` links it (`brandCardUrl`), with its alt text in the reader's
 * language; the words on it are English on every locale (T-1309, D-419), so
 * there is one picture and one address for all of them.
 *
 * It asks nothing of the API, so it can never be stale. Drawn once per
 * process, on the first request rather than at build time, so a face missing
 * at build time can never be baked into it, and answered from memory after
 * that. The address ends in `.png` so Cloudflare's edge keeps a copy (it
 * caches by extension; an extension-less path goes to the origin every time),
 * for the day `cache-control` allows, as does every chat app that fetches it.
 */
export const dynamic = 'force-dynamic';

const BRAND_CARD_CACHE = 'public, max-age=86400';

let drawn: Promise<{ body: ArrayBuffer; headers: Headers; status: number }> | null = null;

async function draw() {
  const host = new URL(siteUrl()).host;
  const response = await drawCard(<BrandCardImage host={host} />, {
    cacheControl: BRAND_CARD_CACHE,
  });
  return { body: await response.arrayBuffer(), headers: response.headers, status: response.status };
}

export async function GET(): Promise<Response> {
  drawn ??= draw().catch((error: unknown) => {
    // Never keep a failure: the next request draws again.
    drawn = null;
    throw error;
  });
  const { body, headers, status } = await drawn;
  return new Response(body.slice(0), { status, headers: new Headers(headers) });
}
