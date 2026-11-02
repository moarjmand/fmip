import { drawCard } from '@/components/draw-card';
import { MatchCardImage, PlainCard } from '@/components/share-card-image';
import { DEFAULT_LOCALE } from '@/i18n/locales';
import { fetchForecastSummaries, fetchMatchCentre } from '@/lib/api';
import { crestDataUrl } from '@/lib/crest-image';
import { siteUrl } from '@/lib/seo';
import { cardImageMetadata, matchCardText } from '@/lib/share-card';

/**
 * The card a chat app shows for a match link (T-520; A10 "Matchday poster",
 * T-1723): the crests and teams, the score or the kick-off, and the
 * statistical model's forecast from before kick-off. Built from the same
 * answers the page is; when those cannot be read the card says only the
 * product's name rather than anything about the match.
 */

/** The alt text in the reader's language (T-1309); the picture itself stays English. */
export function generateImageMetadata({ params }: { params: { locale: string } }) {
  return cardImageMetadata('match', params);
}

/**
 * Drawn per request (T-1505). An image route is cached by default, so without
 * this Next.js renders it as a static route on first request; the API client
 * reads the request's headers (the reader's locale), which a static render may
 * not, and every card answered 500.
 */
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function Image({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<Response> {
  const { id } = await params;
  const host = new URL(siteUrl()).host;
  if (!UUID.test(id)) return drawCard(<PlainCard />);

  // The words on a card stay English (T-1309), and so do the names the API
  // answers for it (T-1506): a Persian name sent `next/og` for a font it could
  // not read, and the card answered 502.
  //
  // The forecast is the model's latest version computed before kick-off,
  // never one computed during or after the match (finding des-2026-11-02-01).
  const [match, forecasts] = await Promise.all([
    fetchMatchCentre(id, DEFAULT_LOCALE),
    fetchForecastSummaries([id]),
  ]);
  if (!match.ok) return drawCard(<PlainCard />);

  const header = match.data.fixture;
  const preKickoff = forecasts.ok
    ? (forecasts.data.fixtures.find((entry) => entry.fixture_id === id)?.pre_kickoff ?? null)
    : null;
  const [home, away] = await Promise.all([
    crestDataUrl(header.home.crest),
    crestDataUrl(header.away.crest),
  ]);
  return drawCard(
    <MatchCardImage text={matchCardText(header, preKickoff)} host={host} crests={{ home, away }} />,
  );
}
