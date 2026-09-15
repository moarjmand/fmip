import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AnalysisQueue } from '@/components/analysis-queue';
import { fetchAnalysisQueue, fetchMe } from '@/lib/api';
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
    path: '/admin/analysis-reviews',
    title: 'Analysis review queue',
    description: 'What is waiting to be read.',
    index: false,
  });
}

/**
 * The editorial queue (blueprint 10.3, T-262).
 *
 * The role is checked by the API, not here: a page that decided for itself who
 * may review would be a second gate, and the one in the browser is the one that
 * goes stale. A member without the role gets 403 and is told so.
 */
export default async function AnalysisReviewsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const cookie = await sessionCookieHeader();
  const me = await fetchMe(cookie);
  if (me === null) redirect(`/${locale}/login?next=/${locale}/admin/analysis-reviews`);

  const result = await fetchAnalysisQueue(cookie);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
      <p className="text-sm">
        <Link href={`/${locale}/admin`} className="underline">
          ← Admin
        </Link>
      </p>
      <h1 className="text-2xl font-semibold">Analysis waiting to be read</h1>

      {result.ok || result.status !== 403 ? (
        <AnalysisQueue
          locale={locale}
          submissions={result.ok ? result.data.submissions : []}
          authors={result.ok ? result.data.authors : []}
          reachable={result.ok}
        />
      ) : (
        // Said plainly rather than shown as an empty queue: "you may not read
        // this" and "nothing is waiting" are different facts.
        <p role="alert" data-testid="analysis-queue-forbidden">
          Reviewing analysis needs the editor or administrator role.
        </p>
      )}
    </main>
  );
}
