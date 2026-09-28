import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { DataQualityAdmin } from '@/components/data-quality-admin';
import { Notice } from '@/components/ui';
import { fetchDataQuality, fetchMe } from '@/lib/api';
import { pageMetadata } from '@/lib/seo';
import { sessionCookieHeader } from '@/lib/session';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return pageMetadata({
    locale,
    path: '/admin/data-quality',
    title: 'Data quality',
    description: 'Where the stored feed contradicts itself.',
    index: false,
  });
}

/**
 * Data-quality findings on the web (T-821), over `GET /admin/data-quality`.
 * The role is the API's to check; a 403 is said rather than shown as an
 * empty list, and an outage is not "no findings".
 */
export default async function DataQualityPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const cookie = await sessionCookieHeader();
  const me = await fetchMe(cookie);
  if (me === null) redirect(`/${locale}/login?next=/${locale}/admin/data-quality`);

  const result = await fetchDataQuality(cookie);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
      <p className="text-sm">
        <Link href={`/${locale}/admin`} className="underline">
          ← Admin
        </Link>
      </p>
      <h1 className="text-2xl font-semibold">Data quality</h1>
      <p className="text-sm text-muted">
        What the stored feed says that contradicts itself. Nothing here is corrected automatically;
        a finding closes when the data stops disagreeing.
      </p>

      {result.ok || result.status !== 403 ? (
        <DataQualityAdmin locale={locale} report={result.ok ? result.data : null} />
      ) : (
        <Notice tone="warning" data-testid="data-quality-forbidden">
          The data-quality findings need the administrator role.
        </Notice>
      )}
    </main>
  );
}
