import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CandidateRecordsReport } from '@/components/candidate-records-report';
import { fetchCandidateRecords, fetchMe } from '@/lib/api';
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
    path: '/admin/model-candidates',
    title: 'Model candidates',
    description: 'Each candidate model version in shadow and its pre-kick-off record.',
    index: false,
  });
}

/**
 * The candidates in shadow and their records (T-1103, D-140). Read-only; the
 * role is the API's to check (administrators), and a refusal is said, not
 * shown as an empty report.
 */
export default async function ModelCandidatesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const cookie = await sessionCookieHeader();
  const me = await fetchMe(cookie);
  if (me === null) redirect(`/${locale}/login?next=/${locale}/admin/model-candidates`);
  const result = await fetchCandidateRecords(cookie);

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 p-8">
      <p className="text-sm">
        <Link href={`/${locale}/admin`} className="underline">
          ← Admin
        </Link>
      </p>
      <h1 className="text-2xl font-semibold">Model candidates</h1>
      {result.ok ? (
        <CandidateRecordsReport locale={locale} report={result.data} />
      ) : result.status === 403 ? (
        <Notice tone="warning" data-testid="model-candidates-forbidden">
          The model candidates need the administrator role.
        </Notice>
      ) : (
        <Notice tone="danger" data-testid="model-candidates-unreachable">
          The model candidates cannot be shown right now.
        </Notice>
      )}
    </main>
  );
}
