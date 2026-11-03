import type { ReactElement } from 'react';
import { ImageResponse } from 'next/og';
import { PlainCard } from '@/components/share-card-image';
import { cardFonts } from '@/lib/card-fonts';
import { CARD_SIZE } from '@/lib/share-card';

/**
 * A share card drawn to the end before it is answered (T-1506). `next/og`
 * renders while it streams, so a failure inside the renderer -- a script it
 * fetches a font for and cannot parse, as Persian did ("lookupType: 5 -
 * substFormat: 3 is not yet supported") -- broke the response after its
 * status was sent, and the proxy answered 502. Drawn here first, a card that
 * cannot be drawn becomes the plain one: still a picture with the product's
 * name, and never a word about the page it could not draw.
 *
 * The card routes ask the API for English names besides (the words on a card
 * stay English, T-1309), so this is the net under a member's own display
 * name, which no locale changes.
 *
 * Every card is drawn in the bundled faces (T-1723, `lib/card-fonts.ts`).
 * `cacheControl` replaces `next/og`'s own year-long immutable header where a
 * card can change or be withdrawn (a revoked share link, D-351).
 */
export async function drawCard(
  card: ReactElement,
  options: { size?: { width: number; height: number }; cacheControl?: string } = {},
): Promise<Response> {
  const size = options.size ?? CARD_SIZE;
  const fonts = await cardFonts();
  const answer = (image: ImageResponse, body: ArrayBuffer | null): Response => {
    const headers = new Headers(image.headers);
    if (options.cacheControl !== undefined) headers.set('cache-control', options.cacheControl);
    return new Response(body ?? image.body, { status: image.status, headers });
  };
  try {
    const image = new ImageResponse(card, { ...size, fonts });
    return answer(image, await image.arrayBuffer());
  } catch {
    return answer(new ImageResponse(<PlainCard />, { ...size, fonts }), null);
  }
}
