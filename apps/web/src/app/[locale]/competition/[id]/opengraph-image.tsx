import { ImageResponse } from 'next/og';
import { PlainCard, TableCardImage } from '@/components/share-card-image';
import { fetchCompetition } from '@/lib/api';
import { siteUrl } from '@/lib/seo';
import { cardImageMetadata, CARD_SIZE, tableCardText } from '@/lib/share-card';

/**
 * The card a chat app shows for a competition link (T-520): the top of the
 * current season's table, or the page's own sentence when there is none. A
 * link to an older season (`?season=`) shares the competition's card, since a
 * preview is fetched without the query and a card cannot claim a season the
 * link may not show.
 */

/** The alt text in the reader's language (T-1309); the picture itself stays English. */
export function generateImageMetadata({ params }: { params: { locale: string } }) {
  return cardImageMetadata('competition', params);
}

const size = CARD_SIZE;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function Image({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<ImageResponse> {
  const { locale, id } = await params;
  const host = new URL(siteUrl()).host;
  if (!UUID.test(id)) return new ImageResponse(<PlainCard />, size);

  const page = await fetchCompetition(id, '', locale);
  if (!page.ok) return new ImageResponse(<PlainCard />, size);
  return new ImageResponse(<TableCardImage text={tableCardText(page.data)} host={host} />, size);
}
