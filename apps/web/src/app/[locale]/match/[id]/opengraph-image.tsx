import { ImageResponse } from 'next/og';
import { MatchCardImage, PlainCard } from '@/components/share-card-image';
import { fetchForecasts, fetchMatchCentre } from '@/lib/api';
import { siteUrl } from '@/lib/seo';
import { CARD_SIZE, matchCardText } from '@/lib/share-card';

/**
 * The card a chat app shows for a match link (T-520): the teams, the score or
 * the kick-off, and the statistical model's forecast when the page shows one.
 * Built from the same answers the page is; when those cannot be read the card
 * says only the product's name rather than anything about the match.
 */

export const alt = 'The match, its score or kick-off, and the model’s forecast';
export const size = CARD_SIZE;
export const contentType = 'image/png';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function Image({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<ImageResponse> {
  const { id } = await params;
  const host = new URL(siteUrl()).host;
  if (!UUID.test(id)) return new ImageResponse(<PlainCard />, size);

  const [match, forecasts] = await Promise.all([fetchMatchCentre(id), fetchForecasts(id)]);
  if (!match.ok) return new ImageResponse(<PlainCard />, size);

  const latest = forecasts.ok ? forecasts.data.latest : null;
  return new ImageResponse(
    <MatchCardImage text={matchCardText(match.data.fixture, latest)} host={host} />,
    size,
  );
}
