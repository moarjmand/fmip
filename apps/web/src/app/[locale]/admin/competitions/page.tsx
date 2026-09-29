import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CompetitionOrderAdmin } from '@/components/competition-order-admin';
import { fetchAdminCompetitions, fetchMe } from '@/lib/api';
import { pageMetadata } from '@/lib/seo';
import { sessionCookieHeader } from '@/lib/session';
import { Notice } from '@/components/ui';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return pageMetadata({
    locale,
    path: '/admin/competitions',
    title: 'Competition order',
    description: 'Where each competition sits on the scores page and the homepage.',
    index: false,
  });
}

/**
 * The competitions' order (T-1162, D-154), administrators only, over the
 * audited API. The role is the API's to check; a 403 is said rather than
 * shown as an empty list.
 */
export default async function CompetitionOrderPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const cookie = await sessionCookieHeader();
  const me = await fetchMe(cookie);
  if (me === null) redirect(`/${locale}/login?next=/${locale}/admin/competitions`);

  const result = await fetchAdminCompetitions(cookie);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
      <p className="text-sm">
        <Link href={`/${locale}/admin`} className="underline">
          ← Admin
        </Link>
      </p>
      <h1 className="text-2xl font-semibold">Competition order</h1>
      <p className="text-sm text-muted">
        After a member&rsquo;s own favourites, the scores page and the homepage list competitions by
        the place stated here, 1 first; a competition with no place comes after every stated one, by
        country and name. Two competitions may share a place.
      </p>

      {result.ok || result.status !== 403 ? (
        <CompetitionOrderAdmin
          locale={locale}
          competitions={result.ok ? result.data.competitions : []}
          reachable={result.ok}
        />
      ) : (
        <Notice tone="warning" data-testid="competition-order-forbidden">
          Setting the competitions&rsquo; order needs the administrator role.
        </Notice>
      )}
    </main>
  );
}
