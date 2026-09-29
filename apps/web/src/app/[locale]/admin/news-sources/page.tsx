import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { NewsSourcesAdmin } from '@/components/news-sources-admin';
import { fetchMe, fetchNewsSources } from '@/lib/api';
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
    path: '/admin/news-sources',
    title: 'News sources',
    description: "The publishers' feeds the product reads, and adding, editing or dropping one.",
    index: false,
  });
}

/**
 * News sources (T-1015). The role is the API's to check (administrators
 * only); a refusal is said rather than shown as an empty list.
 */
export default async function NewsSourcesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const cookie = await sessionCookieHeader();
  const me = await fetchMe(cookie);
  if (me === null) redirect(`/${locale}/login?next=/${locale}/admin/news-sources`);
  const result = await fetchNewsSources(cookie);

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 p-8">
      <p className="text-sm">
        <Link href={`/${locale}/admin`} className="underline">
          ← Admin
        </Link>
      </p>
      <h1 className="text-2xl font-semibold">News sources</h1>
      {result.ok ? (
        <NewsSourcesAdmin locale={locale} sources={result.data.sources} />
      ) : result.status === 403 ? (
        <Notice tone="warning" data-testid="news-sources-forbidden">
          News sources need the administrator role.
        </Notice>
      ) : (
        <Notice tone="danger" data-testid="news-sources-unreachable">
          The news sources cannot be shown right now.
        </Notice>
      )}
    </main>
  );
}
