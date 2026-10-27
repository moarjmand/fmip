import { ImageResponse } from 'next/og';
import { drawCard } from '@/components/draw-card';
import { DEFAULT_LOCALE } from '@/i18n/locales';
import { MemberCardImage, PlainCard } from '@/components/share-card-image';
import { fetchPredictionHistory, fetchProfile, fetchRating } from '@/lib/api';
import { siteUrl } from '@/lib/seo';
import { cardImageMetadata, CARD_SIZE, memberCardText } from '@/lib/share-card';

/**
 * The card a chat app shows for a member's profile link (T-520): their name,
 * their rating and their latest settled predictions, exactly as a signed-out
 * visitor would see them -- every request here is made without a session. A
 * profile that is friends-only or private gets the product's name and nothing
 * about the member.
 */

/** The alt text in the reader's language (T-1309); the picture itself stays English. */
export function generateImageMetadata({ params }: { params: { locale: string } }) {
  return cardImageMetadata('member', params);
}

/**
 * Drawn per request (T-1505). An image route is cached by default, so without
 * this Next.js renders it as a static route on first request; the API client
 * reads the request's headers (the reader's locale), which a static render may
 * not, and every card answered 500.
 */
export const dynamic = 'force-dynamic';

const size = CARD_SIZE;

export default async function Image({
  params,
}: {
  params: Promise<{ locale: string; username: string }>;
}): Promise<Response> {
  const { username } = await params;
  const name = decodeURIComponent(username);
  const host = new URL(siteUrl()).host;

  const profile = await fetchProfile(name, undefined);
  if (!profile.ok || profile.data.kind !== 'visible') {
    return new ImageResponse(<PlainCard />, size);
  }
  const [rating, history] = await Promise.all([
    fetchRating(name),
    // English team names, as on every card (T-1309, T-1506); the member's own
    // display name is theirs, and `drawCard` is the net under it.
    fetchPredictionHistory(name, `limit=20&offset=0&locale=${DEFAULT_LOCALE}`, undefined),
  ]);
  const items = history.ok && history.data.kind === 'visible' ? history.data.items : [];
  return drawCard(
    <MemberCardImage
      text={memberCardText(profile.data.profile, rating.ok ? rating.data.rating : null, items)}
      host={host}
    />,
  );
}
