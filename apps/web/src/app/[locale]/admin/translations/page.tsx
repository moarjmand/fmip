import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { TranslationQueueItem } from '@fmip/contracts';
import { UNFINISHED_LOCALES } from '@/i18n/locales';
import { fetchMe, fetchTranslationQueue } from '@/lib/api';
import { pageMetadata } from '@/lib/seo';
import { sessionCookieHeader } from '@/lib/session';
import { Card, Notice } from '@/components/ui';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return pageMetadata({
    locale,
    path: '/admin/translations',
    title: "Translator's desk",
    description: 'Articles to translate and translations to review, by language.',
    index: false,
  });
}

const BUCKETS = [
  ['to_translate', 'To translate', 'Nothing new waits to be translated into this language.'],
  ['awaiting_review', 'Awaiting review', 'No translation waits for a second speaker.'],
  ['reviewed', 'Reviewed', 'No translation into this language has been reviewed yet.'],
] as const;

function Item({
  locale,
  language,
  item,
}: {
  locale: string;
  language: string;
  item: TranslationQueueItem;
}) {
  return (
    <li className="flex flex-col gap-1 text-sm" data-testid="desk-queue-item">
      <Link
        href={`/${locale}/admin/translations/${item.article_id}/${language}`}
        className="font-medium underline"
        lang={item.source_language}
        dir="auto"
      >
        {item.headline}
      </Link>
      <span className="text-xs text-muted">
        {item.source_name} · {item.source_language}
        {item.rights === 'headline' && ' · headline only'}
        {item.translation !== null &&
          ` · version ${item.translation.version_number} by ${item.translation.written_by.username}`}
        {item.translation?.reviewed_by != null &&
          `, reviewed by ${item.translation.reviewed_by.username}`}
      </span>
    </li>
  );
}

/**
 * The translator's desk (T-1013): per language, the articles to translate,
 * the translations awaiting a second speaker and the ones reviewed. The role
 * is the API's to check (editors and administrators, T-304); a member
 * without it is told so rather than shown an empty desk.
 */
export default async function TranslationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ language?: string }>;
}) {
  const { locale } = await params;
  const { language: asked } = await searchParams;
  const cookie = await sessionCookieHeader();
  const me = await fetchMe(cookie);
  if (me === null) redirect(`/${locale}/login?next=/${locale}/admin/translations`);

  const languages: readonly string[] = UNFINISHED_LOCALES;
  const language =
    asked !== undefined && languages.includes(asked)
      ? asked
      : languages.includes(locale)
        ? locale
        : languages[0]!;
  const result = await fetchTranslationQueue(language, cookie);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
      <p className="text-sm">
        <Link href={`/${locale}/admin`} className="underline">
          ← Admin
        </Link>
      </p>
      <h1 className="text-2xl font-semibold">Translator&apos;s desk</h1>

      {!result.ok && result.status === 403 ? (
        <Notice tone="warning" data-testid="translations-forbidden">
          The translator&apos;s desk needs the editor or administrator role.
        </Notice>
      ) : (
        <>
          <nav aria-label="Language" className="flex flex-wrap gap-3 text-sm">
            {languages.map((tag) => (
              <Link
                key={tag}
                href={`/${locale}/admin/translations?language=${tag}`}
                aria-current={tag === language ? 'page' : undefined}
                className={tag === language ? 'font-semibold underline' : 'underline'}
                data-testid={`desk-language-${tag}`}
              >
                {tag}
              </Link>
            ))}
          </nav>
          {!result.ok ? (
            <Notice tone="danger" data-testid="translations-unreachable">
              The desk cannot be shown right now.
            </Notice>
          ) : (
            BUCKETS.map(([bucket, heading, none]) => (
              <Card key={bucket} heading={heading} data-testid={`desk-queue-${bucket}`}>
                {result.data[bucket].length === 0 ? (
                  <p className="text-sm text-muted">{none}</p>
                ) : (
                  <ul className="flex flex-col gap-3">
                    {result.data[bucket].map((item) => (
                      <Item key={item.article_id} locale={locale} language={language} item={item} />
                    ))}
                  </ul>
                )}
              </Card>
            ))
          )}
        </>
      )}
    </main>
  );
}
