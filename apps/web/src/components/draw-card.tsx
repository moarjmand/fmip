import type { ReactElement } from 'react';
import { ImageResponse } from 'next/og';
import { PlainCard } from '@/components/share-card-image';
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
 */
export async function drawCard(card: ReactElement): Promise<Response> {
  try {
    const image = new ImageResponse(card, CARD_SIZE);
    const body = await image.arrayBuffer();
    return new Response(body, { status: image.status, headers: image.headers });
  } catch {
    return new ImageResponse(<PlainCard />, CARD_SIZE);
  }
}
