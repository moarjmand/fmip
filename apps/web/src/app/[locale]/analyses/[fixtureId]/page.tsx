import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AnalysisEditor } from '@/components/analysis-editor';
import { Translated } from '@/components/translated';
import { t } from '@/i18n/messages';
import { analysisEditorWords } from '@/lib/analysis-text';
import { fetchMatchCentre, fetchMe, fetchMyAnalysis } from '@/lib/api';
import { asLocale, matchTitle } from '@/lib/prediction-text';
import { pageMetadata } from '@/lib/seo';
import { sessionCookieHeader } from '@/lib/session';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const l = asLocale(locale);
  return pageMetadata({
    locale,
    path: '/analyses',
    title: t(l, 'analysis.editor.title'),
    description: t(l, 'analysis.editor.description'),
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
  const l = asLocale(locale);
  const cookie = await sessionCookieHeader();
  const me = await fetchMe(cookie);
  if (me === null) redirect(`/${locale}/login?next=/${locale}/analyses/${fixtureId}`);

  const [match, mine] = await Promise.all([
    fetchMatchCentre(fixtureId),
    fetchMyAnalysis(fixtureId, cookie),
  ]);
  const workspace = mine.ok ? mine.data : null;

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-8">
      <p className="text-sm">
        <Link href={`/${locale}/match/${fixtureId}`} className="underline">
          <Translated locale={l} message="analysis.editor.back" />
        </Link>
      </p>
      <h1 className="text-2xl font-semibold">
        {match.ok ? (
          matchTitle(l, match.data.fixture.home.name, match.data.fixture.away.name)
        ) : (
          <Translated locale={l} message="analysis.editor.title" />
        )}
      </h1>

      <AnalysisEditor
        locale={locale}
        fixtureId={fixtureId}
        // 404 means they have not written anything yet, which is a starting
        // point rather than an error: the form renders empty.
        workspace={mine.ok ? mine.data : null}
        words={analysisEditorWords(l, workspace)}
      />
    </main>
  );
}
