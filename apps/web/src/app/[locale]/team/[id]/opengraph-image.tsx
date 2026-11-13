import { drawCard } from '@/components/draw-card';
import { PlainCard, TeamCardImage } from '@/components/share-card-image';
import { DEFAULT_LOCALE } from '@/i18n/locales';
import { fetchTeam } from '@/lib/api';
import { cardBandColours } from '@/lib/band-colour';
import { crestDataUrl } from '@/lib/crest-image';
import { siteUrl } from '@/lib/seo';
import { cardImageMetadata, teamCardText } from '@/lib/share-card';

/**
 * The card a chat app shows for a club link (T-1826, D-420; T1 "Club
 * band"): the club's colour band with its crest and name, its main
 * competition and standing, and its next match, from the same answer the
 * club page is built from. A club without a competition or a next match
 * says so; when the answer cannot be read the card says only the product's
 * name. No forecast is drawn (a kept picture of one goes stale).
 */

/** The alt text in the reader's language (T-1309); the picture itself stays English (D-419). */
export function generateImageMetadata({ params }: { params: { locale: string } }) {
  return cardImageMetadata('team', params);
}

/** Drawn per request (T-1505): the API client reads the request's headers. */
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Shared caches keep a club's card an hour: its standing and next match move (the spec, section 7). */
const TEAM_CARD_CACHE = 'public, max-age=3600';

export default async function Image({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<Response> {
  const { id } = await params;
  const host = new URL(siteUrl()).host;
  if (!UUID.test(id)) return drawCard(<PlainCard />, { cacheControl: TEAM_CARD_CACHE });

  // English names, as on every card (T-1309, T-1506).
  const page = await fetchTeam(id, DEFAULT_LOCALE);
  if (!page.ok) return drawCard(<PlainCard />, { cacheControl: TEAM_CARD_CACHE });
  const team = page.data.team;
  const crest = await crestDataUrl(team.crest);
  return drawCard(
    <TeamCardImage
      text={teamCardText(page.data, new Date())}
      host={host}
      crest={crest}
      paint={cardBandColours(team.colour)}
    />,
    { cacheControl: TEAM_CARD_CACHE },
  );
}
