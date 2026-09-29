import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { TranslationDesk } from '@/components/translation-desk';
import { fetchMe, fetchTranslationDesk } from '@/lib/api';
import { pageMetadata } from '@/lib/seo';
import { sessionCookieHeader } from '@/lib/session';
import { Notice } from '@/components/ui';

type Params = Promise<{ locale: string; articleId: string; language: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale, articleId, language } = await params;
  return pageMetadata({
    locale,
    path: `/admin/translations/${articleId}/${language}`,
    title: "Translator's desk",
    description: 'One article, its translation, the checks and the glossary terms.',
    index: false,
  });
}

/** One article at the translator's desk (T-1013). The role is the API's to check. */
export default async function TranslationDeskPage({ params }: { params: Params }) {
  const { locale, articleId, language } = await params;
  const path = `/${locale}/admin/translations/${articleId}/${language}`;
  const cookie = await sessionCookieHeader();
  const me = await fetchMe(cookie);
  if (me === null) redirect(`/${locale}/login?next=${path}`);

  const result = await fetchTranslationDesk(articleId, language, cookie);
  if (!result.ok && result.status === 404) notFound();

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
      <p className="text-sm">
        <Link href={`/${locale}/admin/translations?language=${language}`} className="underline">
          ← Translator&apos;s desk
        </Link>
      </p>
      <h1 className="text-2xl font-semibold">Translation into {language}</h1>
      {result.ok ? (
        <TranslationDesk locale={locale} desk={result.data} />
      ) : result.status === 403 ? (
        <Notice tone="warning" data-testid="translations-forbidden">
          The translator&apos;s desk needs the editor or administrator role.
        </Notice>
      ) : (
        <Notice tone="danger" data-testid="translations-unreachable">
          The desk cannot be shown right now.
        </Notice>
      )}
    </main>
  );
}
