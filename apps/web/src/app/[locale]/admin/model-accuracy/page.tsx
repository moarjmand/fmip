import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ModelAccuracyReport } from '@/components/model-accuracy-report';
import { fetchAdminModelAccuracy, fetchMe } from '@/lib/api';
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
    path: '/admin/model-accuracy',
    title: 'Model accuracy',
    description: 'Each model version’s pre-kick-off accuracy by week or month.',
    index: false,
  });
}

/**
 * Accuracy over time (T-1369, D-187): every model version, published and in
 * shadow, by ISO week or month. Read-only; the role is the API's to check
 * (administrators), and a refusal is said, not shown as an empty report.
 */
export default async function ModelAccuracyPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ period?: string }>;
}) {
  const { locale } = await params;
  const { period: asked } = await searchParams;
  const period = asked === 'month' ? 'month' : 'week';
  const cookie = await sessionCookieHeader();
  const me = await fetchMe(cookie);
  if (me === null) redirect(`/${locale}/login?next=/${locale}/admin/model-accuracy`);
  const result = await fetchAdminModelAccuracy(cookie, period);

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 p-8">
      <p className="flex gap-4 text-sm">
        <Link href={`/${locale}/admin`} className="underline">
          ← Admin
        </Link>
        <Link href={`/${locale}/admin/model-candidates`} className="underline">
          Model candidates
        </Link>
        <Link href={`/${locale}/model-accuracy`} className="underline">
          The public page
        </Link>
      </p>
      <h1 className="text-2xl font-semibold">Model accuracy</h1>
      {result.ok ? (
        <ModelAccuracyReport locale={locale} report={result.data} />
      ) : result.status === 403 ? (
        <Notice tone="warning" data-testid="model-accuracy-forbidden">
          Model accuracy needs the administrator role.
        </Notice>
      ) : (
        <Notice tone="danger" data-testid="model-accuracy-unreachable">
          Model accuracy cannot be shown right now.
        </Notice>
      )}
    </main>
  );
}
