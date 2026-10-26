import type { Metadata } from 'next';
import { fetchHighlights, fetchMe, fetchTerritories } from '@/lib/api';
import { say } from '@/lib/competition';
import { highlightsApiQuery, readHighlightsQuery } from '@/lib/highlights';
import { pageTimeZone } from '@/lib/reader-time-zone-server';
import { pageMetadata } from '@/lib/seo';
import { sessionCookieHeader } from '@/lib/session';
import { HighlightsView } from './view';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return pageMetadata({
    locale,
    path: '/highlights',
    title: `${say(locale, 'highlights.title')} · Stadiomind`,
    description: say(locale, 'highlights.metaDescription'),
  });
}

/**
 * Highlights (T-1434, D-226; T-1614, D-285): the reads -- who is asking,
 * their zone, the API's page of clips for the address, and the territories a
 * guest may choose -- and `HighlightsView` draws them.
 */
export default async function HighlightsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  const cookie = await sessionCookieHeader();
  const me = await fetchMe(cookie);
  const q = readHighlightsQuery(query);
  const { timeZone } = await pageTimeZone(locale, me);
  const [answer, territories] = await Promise.all([
    fetchHighlights(highlightsApiQuery(q), cookie),
    me === null ? fetchTerritories() : Promise.resolve(null),
  ]);
  return (
    <HighlightsView
      locale={locale}
      q={q}
      data={answer.ok ? answer.data : null}
      timeZone={timeZone}
      signedIn={me !== null}
      territories={territories}
      now={new Date()}
    />
  );
}
