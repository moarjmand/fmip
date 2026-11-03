import type { CalledItCard } from '@fmip/contracts';
import { CalledItImage } from '@/components/called-it-image';
import { drawCard } from '@/components/draw-card';
import { DEFAULT_LOCALE } from '@/i18n/locales';
import { type ApiResult, fetchMatchCentre } from '@/lib/api';
import { crestDataUrl } from '@/lib/crest-image';
import { siteUrl } from '@/lib/seo';
import { calledItText, CARD_SIZE, STORY_SIZE } from '@/lib/share-card';

/**
 * How long a public card may be kept (T-1723): a minute, so a revoked link
 * stops drawing within one, at the edge and in a browser alike. (A chat app
 * that already fetched the preview keeps its own copy; nothing reaches that.)
 */
export const PUBLIC_CARD_CACHE = 'public, max-age=60';

/** The owner's preview, before anything is public: never stored anywhere shared. */
export const PRIVATE_CARD_CACHE = 'private, no-store';

/**
 * A "called it" card as a PNG answer (T-1723, D-351), for the public link's
 * two image routes and the owner's preview. The card's words come from the
 * API's card alone (`calledItText`); the match page is read only for the two
 * crests, which are public, and a crest that cannot be read is an empty ring.
 */
export async function drawCalledIt(
  card: CalledItCard,
  variant: 'card' | 'story',
  cacheControl: string,
): Promise<Response> {
  const match = await fetchMatchCentre(card.fixture_id, DEFAULT_LOCALE);
  const [home, away] = match.ok
    ? await Promise.all([
        crestDataUrl(match.data.fixture.home.crest),
        crestDataUrl(match.data.fixture.away.crest),
      ])
    : [null, null];
  return drawCard(
    <CalledItImage
      text={calledItText(card)}
      host={new URL(siteUrl()).host}
      crests={{ home, away }}
      variant={variant}
    />,
    { size: variant === 'story' ? STORY_SIZE : CARD_SIZE, cacheControl },
  );
}

/**
 * The answer when there is no card to draw: 404 for a link that opens nothing
 * (unknown, revoked, no longer a correct pick, or not the reader's own), 503
 * when the API could not be asked. Never a picture saying anything about it.
 */
export function noCard(result: Extract<ApiResult<unknown>, { ok: false }>): Response {
  return new Response(null, {
    status: result.status === 0 || result.status >= 500 ? 503 : 404,
    headers: { 'cache-control': 'no-store' },
  });
}
