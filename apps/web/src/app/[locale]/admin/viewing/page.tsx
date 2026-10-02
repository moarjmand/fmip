import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ViewingConsole, type UpcomingView } from '@/components/viewing-console';
import { Notice } from '@/components/ui';
import { failureSentence } from '@/lib/action-failure';
import {
  fetchBroadcasters,
  fetchMe,
  fetchViewingCompetitions,
  fetchViewingUpcoming,
} from '@/lib/api';
import { pageMetadata } from '@/lib/seo';
import { sessionCookieHeader } from '@/lib/session';
import { readConsoleQuery } from '@/lib/viewing-console';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return pageMetadata({
    locale,
    path: '/admin/viewing',
    title: 'Watch listings',
    description:
      'Viewing coverage, broadcasters, standing defaults and bulk listing per territory.',
    index: false,
  });
}

/**
 * Watch listings (T-1361): the desk's console for where matches can be
 * watched, editors and administrators. The role is the API's to check: the
 * competitions list answers or refuses, and a refusal is said rather than
 * shown as an empty console (T-904).
 */
export default async function ViewingConsolePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    territory?: string | string[];
    competition?: string | string[];
    days?: string | string[];
  }>;
}) {
  const { locale } = await params;
  const query = readConsoleQuery(await searchParams);
  const cookie = await sessionCookieHeader();
  const me = await fetchMe(cookie);
  if (me === null) redirect(`/${locale}/login?next=/${locale}/admin/viewing`);

  const header = (
    <>
      <p className="text-sm">
        <Link href={`/${locale}/admin`} className="underline">
          ← Admin
        </Link>
      </p>
      <h1 className="text-2xl font-semibold">Watch listings</h1>
    </>
  );

  const competitions = await fetchViewingCompetitions(query.territory, cookie);
  if (!competitions.ok) {
    return (
      <main className="mx-auto flex max-w-5xl flex-col gap-6 p-8">
        {header}
        {competitions.status === 403 ? (
          <Notice tone="warning" data-testid="viewing-console-forbidden">
            Watch listings need the editor or administrator role.
          </Notice>
        ) : (
          <Notice tone="danger" data-testid="viewing-console-unreachable">
            Watch listings cannot be shown right now: {await failureSentence(competitions)}
          </Notice>
        )}
      </main>
    );
  }

  const chosen =
    query.competition === null
      ? null
      : (competitions.data.competitions.find((c) => c.id === query.competition) ?? null);
  const [broadcasters, upcoming] = await Promise.all([
    fetchBroadcasters(cookie),
    chosen === null ? null : fetchViewingUpcoming(chosen.id, query.territory, query.days, cookie),
  ]);

  let view: UpcomingView;
  if (query.competition === null) view = { state: 'none' };
  else if (upcoming === null) view = { state: 'unknown' };
  else if (!upcoming.ok) view = { state: 'failed', message: await failureSentence(upcoming) };
  else view = { state: 'shown', data: upcoming.data };

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 p-8">
      {header}
      <p className="text-sm text-muted">
        Where matches can be watched, per territory. Coverage comes first: a default or a bulk
        listing is accepted only for a season declared covered. Every change is recorded with who
        made it. Times are in UTC.
      </p>
      <ViewingConsole
        locale={locale}
        query={query}
        competitions={competitions.data.competitions}
        broadcasters={broadcasters.ok ? broadcasters.data.broadcasters : null}
        upcoming={view}
      />
    </main>
  );
}
