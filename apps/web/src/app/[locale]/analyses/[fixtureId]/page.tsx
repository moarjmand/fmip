import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AnalysisEditor } from '@/components/analysis-editor';
import { fetchMatchCentre, fetchMe, fetchMyAnalysis } from '@/lib/api';
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
    path: '/analyses',
    title: 'Write an analysis',
    description: 'Your draft, what you sent, and what an editor said about it.',
    // Somebody's unpublished draft is not a page for a search engine.
    index: false,
  });
}

/** The analyst's editor for one match (blueprint 10.3, T-262). */
export default async function AnalysisEditorPage({
  params,
}: {
  params: Promise<{ locale: string; fixtureId: string }>;
}) {
  const { locale, fixtureId } = await params;
  const cookie = await sessionCookieHeader();
  const me = await fetchMe(cookie);
  if (me === null) redirect(`/${locale}/login?next=/${locale}/analyses/${fixtureId}`);

  const [match, mine] = await Promise.all([
    fetchMatchCentre(fixtureId),
    fetchMyAnalysis(fixtureId, cookie),
  ]);

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-8">
      <p className="text-sm">
        <Link href={`/${locale}/match/${fixtureId}`} className="underline">
          ← Back to the match
        </Link>
      </p>
      <h1 className="text-2xl font-semibold">
        {match.ok
          ? `${match.data.fixture.home.name} v ${match.data.fixture.away.name}`
          : 'Write an analysis'}
      </h1>

      <AnalysisEditor
        locale={locale}
        fixtureId={fixtureId}
        // 404 means they have not written anything yet, which is a starting
        // point rather than an error: the form renders empty.
        workspace={mine.ok ? mine.data : null}
      />
    </main>
  );
}
