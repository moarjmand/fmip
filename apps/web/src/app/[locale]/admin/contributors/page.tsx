import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ContributorsAdmin } from '@/components/contributors-admin';
import { fetchContributors, fetchMe } from '@/lib/api';
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
    path: '/admin/contributors',
    title: 'Contributors',
    description: 'Who may post on match panels, and why.',
    index: false,
  });
}

/**
 * Contributors on the web (T-612), over the audited API of T-250. The role is
 * the API's to check; a 403 is said rather than shown as an empty list.
 */
export default async function ContributorsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const cookie = await sessionCookieHeader();
  const me = await fetchMe(cookie);
  if (me === null) redirect(`/${locale}/login?next=/${locale}/admin/contributors`);

  const result = await fetchContributors(cookie);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
      <p className="text-sm">
        <Link href={`/${locale}/admin`} className="underline">
          ← Admin
        </Link>
      </p>
      <h1 className="text-2xl font-semibold">Contributors</h1>

      {result.ok || result.status !== 403 ? (
        <ContributorsAdmin
          locale={locale}
          entries={result.ok ? result.data.entries : []}
          reachable={result.ok}
        />
      ) : (
        <Notice tone="warning" data-testid="contributors-forbidden">
          Deciding on contributors needs the moderator or administrator role.
        </Notice>
      )}
    </main>
  );
}
