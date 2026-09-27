import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PanelsAdmin } from '@/components/panels-admin';
import { fetchMe, fetchPanels } from '@/lib/api';
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
    path: '/admin/panels',
    title: 'Featured matches',
    description: 'Which matches have a public discussion.',
    index: false,
  });
}

/**
 * Featured matches on the web (T-613), over the audited API of T-253. The role
 * is the API's to check; a 403 is said rather than shown as an empty list.
 */
export default async function PanelsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const cookie = await sessionCookieHeader();
  const me = await fetchMe(cookie);
  if (me === null) redirect(`/${locale}/login?next=/${locale}/admin/panels`);

  const result = await fetchPanels(cookie);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
      <p className="text-sm">
        <Link href={`/${locale}/admin`} className="underline">
          ← Admin
        </Link>
      </p>
      <h1 className="text-2xl font-semibold">Featured matches</h1>

      {result.ok || result.status !== 403 ? (
        <PanelsAdmin
          locale={locale}
          panels={result.ok ? result.data.panels : []}
          reachable={result.ok}
        />
      ) : (
        <Notice tone="warning" data-testid="panels-forbidden">
          Featuring a match needs the moderator or administrator role.
        </Notice>
      )}
    </main>
  );
}
