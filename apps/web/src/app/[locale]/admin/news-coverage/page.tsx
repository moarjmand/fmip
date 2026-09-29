import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { NewsCoverageReport } from '@/components/news-coverage-report';
import { fetchMe, fetchNewsCoverage } from '@/lib/api';
import { pageMetadata } from '@/lib/seo';
import { sessionCookieHeader } from '@/lib/session';
import { Notice } from '@/components/ui';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return pageMetadata({
    locale,
    path: '/admin/news-coverage',
    title: 'News coverage',
    description: 'Which competitions the carried news sources cover, and the gaps.',
    index: false,
  });
}

/**
 * News coverage per competition (T-1010, D-129). The role is the API's to
 * check (editors and administrators); a refusal is said, not shown as an
 * empty report.
 */
export default async function NewsCoveragePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const cookie = await sessionCookieHeader();
  const me = await fetchMe(cookie);
  if (me === null) redirect(`/${locale}/login?next=/${locale}/admin/news-coverage`);
  const result = await fetchNewsCoverage(cookie);

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 p-8">
      <p className="text-sm">
        <Link href={`/${locale}/admin`} className="underline">
          ← Admin
        </Link>
      </p>
      <h1 className="text-2xl font-semibold">News coverage</h1>
      {result.ok ? (
        <NewsCoverageReport locale={locale} report={result.data} />
      ) : result.status === 403 ? (
        <Notice tone="warning" data-testid="news-coverage-forbidden">
          News coverage needs the editor or administrator role.
        </Notice>
      ) : (
        <Notice tone="danger" data-testid="news-coverage-unreachable">
          News coverage cannot be shown right now.
        </Notice>
      )}
    </main>
  );
}
