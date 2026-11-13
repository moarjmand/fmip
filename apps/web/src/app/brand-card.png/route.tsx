import { FAILED_CARD_CACHE, drawCard } from '@/components/draw-card';
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
 * It asks nothing of the API, so it can never be stale. Drawn on the first
 * request rather than at build time, so a face missing at build time can
 * never be baked into it, and answered from memory after that -- once a real
 * drawing exists; a failed one is never kept. The address ends in `.png` so Cloudflare's edge keeps a copy (it
 * caches by extension; an extension-less path goes to the origin every time),
 * for the day `cache-control` allows, as does every chat app that fetches it.
 */
export const dynamic = 'force-dynamic';

const BRAND_CARD_CACHE = 'public, max-age=86400';

interface Drawn {
  body: ArrayBuffer;
  headers: Headers;
  status: number;
}

/** The real drawing, once it has been made; never the plain card a failure gave. */
let kept: Drawn | null = null;

async function draw(): Promise<Drawn> {
  const host = new URL(siteUrl()).host;
  const response = await drawCard(<BrandCardImage host={host} />, {
    cacheControl: BRAND_CARD_CACHE,
  });
  return { body: await response.arrayBuffer(), headers: response.headers, status: response.status };
}

export async function GET(): Promise<Response> {
  const card = kept ?? (await draw());
  // `drawCard` answers a renderer failure as the plain card marked
  // `no-store`: that one is answered once and drawn again next time (PR 888
  // review), so a passing fault never sticks for the life of the process.
  if (kept === null && card.headers.get('cache-control') !== FAILED_CARD_CACHE) kept = card;
  return new Response(card.body.slice(0), {
    status: card.status,
    headers: new Headers(card.headers),
  });
}
