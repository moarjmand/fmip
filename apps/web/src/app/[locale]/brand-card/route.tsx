import { drawCard } from '@/components/draw-card';
import { BrandCardImage } from '@/components/share-card-image';
import { siteUrl } from '@/lib/seo';

/**
 * The brand card (T-1825, D-419; B10 "Typographic wall"): the `og:image` of
 * every page that has no card of its own -- the home page, news, the model
 * and its accuracy, the competitions, the leaderboard, About and the rest.
 * `pageMetadata` links it (`brandCardUrl`), with its alt text in the reader's
 * language; the words on it are English on every locale (T-1309, D-419).
 *
 * It asks nothing of the API, so it can never be stale. Drawn per request
 * like the other cards (T-1505), so a face missing at build time can never be
 * baked into it; shared caches keep it a day, so a later design reaches chat
 * apps within one rather than after next/og's year-long default.
 */
export const dynamic = 'force-dynamic';

const BRAND_CARD_CACHE = 'public, max-age=86400';

export async function GET(): Promise<Response> {
  const host = new URL(siteUrl()).host;
  return drawCard(<BrandCardImage host={host} />, { cacheControl: BRAND_CARD_CACHE });
}
