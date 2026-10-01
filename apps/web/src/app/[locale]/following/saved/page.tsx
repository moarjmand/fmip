import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { SavedArticle } from '@fmip/contracts';
import { SaveArticle } from '@/components/save-article';
import { Translated } from '@/components/translated';
import { formatDateTime } from '@/i18n/format';
import { DEFAULT_LOCALE, type Locale, isLocale } from '@/i18n/locales';
import { t } from '@/i18n/messages';
import { fetchMe, fetchSavedArticles } from '@/lib/api';
import { storyHref } from '@/lib/news';
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
  const resolved: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  return pageMetadata({
    locale,
    path: '/following/saved',
    title: `${t(resolved, 'saved.title')} · FMIP`,
    description: t(resolved, 'followingPage.savedDescription'),
    index: false,
  });
}

/**
 * Saved (blueprint 3.3 and 2.1, T-842), under Following: the stories the
 * member saved, newest first, as the publisher's headline and a link to
 * their original (D-061) -- nothing else of theirs. Private: the page asks
 * `/me` with the member's own session, and a guest is sent to sign in. A
 * saved story whose publisher was dropped says so instead of linking.
 */
export default async function SavedPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const cookie = await sessionCookieHeader();
  const me = await fetchMe(cookie);
  if (me === null) redirect(`/${locale}/login?next=/${locale}/following/saved`);
  const result = await fetchSavedArticles(cookie);
  const when = (iso: string): string => formatDateTime(locale, iso, me.timezone);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
      <p className="text-sm">
        <Link href={`/${locale}/following`} className="underline" data-testid="back-to-following">
          <Translated locale={locale} message="feed.title" />
        </Link>
      </p>
      <h1 className="border-s-4 border-s-accent ps-4 text-2xl font-semibold" data-testid="title">
        <Translated locale={locale} message="saved.title" />
      </h1>
      <p className="text-sm text-muted">
        <Translated locale={locale} message="saved.intro" />
      </p>

      {result === null || !result.ok ? (
        <Notice tone="danger" data-testid="saved-unreachable">
          <Translated locale={locale} message="saved.unreachable" />
        </Notice>
      ) : result.data.saved.length === 0 ? (
        <p data-testid="saved-empty">
          <Translated locale={locale} message="saved.empty" />{' '}
          <Link href={`/${locale}/news`} className="underline">
            <Translated locale={locale} message="saved.toNews" />
          </Link>
        </p>
      ) : (
        <ol className="flex flex-col gap-5" data-testid="saved-list">
          {result.data.saved.map((item) => (
            <li key={item.story_id} data-testid="saved-item" data-state={item.state}>
              <SavedItem item={item} locale={locale} when={when} />
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}

function SavedItem({
  item,
  locale,
  when,
}: {
  item: SavedArticle;
  locale: string;
  when: (iso: string) => string;
}) {
  const savedAt = (
    <>
      <Translated locale={locale} message="saved.savedAt" />{' '}
      <time dateTime={item.saved_at}>{when(item.saved_at)}</time>
    </>
  );
  if (item.state !== 'available' || item.headline === null || item.url === null) {
    return (
      <div className="flex flex-col gap-1 border-s-2 border-s-default ps-4">
        <p>
          <span className="font-medium">{item.source.name}</span>
          {' · '}
          <Translated
            locale={locale}
            message={
              item.state === 'source_dropped'
                ? 'saved.dropped'
                : item.state === 'other_language'
                  ? 'saved.otherLanguage'
                  : 'saved.unavailable'
            }
          />
        </p>
        <p className="text-sm text-muted">{savedAt}</p>
        <SaveArticle
          locale={locale}
          storyId={item.story_id}
          headline={item.source.name}
          language={locale}
          saved
        />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1 border-s-2 border-s-default ps-4">
      <h2 className="text-lg font-semibold" lang={item.language ?? undefined}>
        <a href={item.url} rel="noopener" className="underline" data-testid="saved-link-out">
          {item.headline}
        </a>
      </h2>
      <p className="text-sm text-muted">
        <Translated locale={locale} message="news.readAt" />{' '}
        {item.source.homepage_url === null ? (
          <bdi>{item.source.name}</bdi>
        ) : (
          <a href={item.source.homepage_url} rel="noopener" className="underline">
            <bdi>{item.source.name}</bdi>
          </a>
        )}
        {' · '}
        {savedAt}
      </p>
      <div className="flex flex-wrap items-baseline gap-4 text-sm">
        <Link href={storyHref(locale, item.story_id)} className="underline">
          <Translated locale={locale} message="news.storyPage" />
        </Link>
        <SaveArticle
          locale={locale}
          storyId={item.story_id}
          headline={item.headline}
          language={item.language ?? locale}
          saved
        />
      </div>
    </div>
  );
}
