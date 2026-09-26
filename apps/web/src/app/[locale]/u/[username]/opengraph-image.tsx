import { ImageResponse } from 'next/og';
import { MemberCardImage, PlainCard } from '@/components/share-card-image';
import { fetchPredictionHistory, fetchProfile, fetchRating } from '@/lib/api';
import { siteUrl } from '@/lib/seo';
import { CARD_SIZE, memberCardText } from '@/lib/share-card';

/**
 * The card a chat app shows for a member's profile link (T-520): their name,
 * their rating and their latest settled predictions, exactly as a signed-out
 * visitor would see them -- every request here is made without a session. A
 * profile that is friends-only or private gets the product's name and nothing
 * about the member.
 */

export const alt = 'A member of FMIP, their rating and latest settled predictions';
export const size = CARD_SIZE;
export const contentType = 'image/png';

export default async function Image({
  params,
}: {
  params: Promise<{ locale: string; username: string }>;
}): Promise<ImageResponse> {
  const { username } = await params;
  const name = decodeURIComponent(username);
  const host = new URL(siteUrl()).host;

  const profile = await fetchProfile(name, undefined);
  if (!profile.ok || profile.data.kind !== 'visible') {
    return new ImageResponse(<PlainCard />, size);
  }
  const [rating, history] = await Promise.all([
    fetchRating(name),
    fetchPredictionHistory(name, 'limit=20&offset=0', undefined),
  ]);
  const items = history.ok && history.data.kind === 'visible' ? history.data.items : [];
  return new ImageResponse(
    <MemberCardImage
      text={memberCardText(profile.data.profile, rating.ok ? rating.data.rating : null, items)}
      host={host}
    />,
    size,
  );
}
