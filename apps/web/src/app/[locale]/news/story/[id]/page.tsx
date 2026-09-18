import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { NewsEntity, NewsReport, StoryPage as StoryPageData } from '@fmip/contracts';
import { Translated } from '@/components/translated';
import { formatDateTime } from '@/i18n/format';
import { fetchMe, fetchStory } from '@/lib/api';
import {
  VERSION_STATUS_KEY,
  entityHref,
  feedsStale,
  readStoryQuery,
  storyHref,
  versionStatus,
} from '@/lib/news';
import { pageMetadata } from '@/lib/seo';
import { sessionCookieHeader } from '@/lib/session';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const [{ locale, id }, query] = await Promise.all([params, searchParams]);
  if (!UUID.test(id)) return { title: 'Story · FMIP', robots: { index: false, follow: false } };
  const result = await fetchStory(id, readStoryQuery(query).language, locale);
  if (!result.ok) return pageMetadata({ locale, path: `/news/story/${id}`, title: 'Story · FMIP' });
  const { story } = result.data;
  return pageMetadata({
    locale,
    path: `/news/story/${id}`,
    title: `${story.headline} · FMIP`,
    // The publisher's own summary, or their headline again: nothing is written for them.
    description: story.summary ?? `${story.headline} — reported by ${story.source.name}.`,
  });
}

/**
 * The story page (blueprint 3.3, T-144), built against D-061: the original's
 * words as the publisher wrote them, the way back to the publisher, the
 * languages it exists in, its corrections, the other publishers' reports of
 * the same event, and the match, teams and competition it is about.
 *
 * What the blueprint lists and a free feed cannot give is named, not filled
 * (rule 3): the body is `not_supplied` and the page sends the reader on; the
 * three prediction products live on the match page, where rule 6 keeps them
 * apart, and are linked, not copied; save and share are not built.
 */
export default async function StoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale, id }, query] = await Promise.all([params, searchParams]);
  if (!UUID.test(id)) notFound();
  const q = readStoryQuery(query);
  const cookie = await sessionCookieHeader();
  const [me, result] = await Promise.all([fetchMe(cookie), fetchStory(id, q.language, locale)]);
  if (!result.ok && result.status === 404) notFound();
  const timeZone = me?.timezone ?? 'UTC';

  if (!result.ok) {
    return (
      <main className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
        <p role="alert" data-testid="story-unreachable">
          <Translated locale={locale} message="news.unreachable" />
        </p>
      </main>
    );
  }

  const page: StoryPageData = result.data;
  const { story } = page;
  const match = story.entities.find((e) => e.entity_type === 'fixture') ?? null;
  const named = story.entities.filter((e) => e.entity_type !== 'fixture');
  const when = (iso: string): string => formatDateTime(locale, iso, timeZone);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-8" data-testid="story-page">
      <p className="text-sm">
        <Link href={`/${locale}/news`} className="underline" data-testid="back-to-news">
          <Translated locale={locale} message="news.title" />
        </Link>
      </p>

      <article className="flex flex-col gap-3" lang={story.language}>
        <h1 className="border-s-4 border-s-current ps-4 text-2xl font-semibold" data-testid="title">
          {story.headline}
        </h1>
        <p className="text-sm opacity-80" data-testid="story-source">
          <Translated locale={locale} message="news.readAt" />{' '}
          <a href={story.source.homepage_url} rel="noopener" className="underline">
            {story.source.name}
          </a>
          {story.byline !== null && <> · {story.byline}</>}
          {' · '}
          {story.published_at === null ? (
            <Translated locale={locale} message="news.noTime" />
          ) : (
            <time dateTime={story.published_at}>{when(story.published_at)}</time>
          )}
        </p>
        {story.summary !== null && (
          <p className="text-lg" data-testid="story-summary">
            {story.summary}
          </p>
        )}

        {page.body.data !== null ? (
          <div className="whitespace-pre-line" data-testid="story-body">
            {page.body.data}
          </div>
        ) : (
          // D-061: the free feed grants no body. The product is the way to the original.
          <p data-testid="story-body-not-supplied">
            <Translated locale={locale} message="story.bodyAtSource" />{' '}
            <a
              href={story.url}
              rel="noopener"
              className="font-medium underline"
              data-testid="story-link"
            >
              <Translated locale={locale} message="story.readOriginal" />
            </a>
          </p>
        )}

        <p className="text-sm opacity-80" data-testid="story-updated">
          <Translated locale={locale} message="story.updated" />{' '}
          <time dateTime={page.updated_at}>{when(page.updated_at)}</time>
        </p>
      </article>

      <section aria-labelledby="languages" className="flex flex-col gap-2 text-sm">
        <h2 id="languages" className="font-semibold">
          <Translated locale={locale} message="story.languages" />
        </h2>
        <ul className="flex flex-wrap gap-2" data-testid="story-languages">
          {page.versions.map((v) => (
            <li key={v.language}>
              <Link
                href={storyHref(locale, id, v.language)}
                aria-current={v.language === story.language ? 'true' : undefined}
                className={`rounded px-2 py-1 ${v.language === story.language ? 'bg-current/10 font-semibold' : 'underline'}`}
                lang={v.language}
                data-origin={v.origin}
                data-review-state={v.review_state ?? ''}
              >
                {v.language}
                {' · '}
                <Translated locale={locale} message={VERSION_STATUS_KEY[versionStatus(v)]} />
              </Link>
            </li>
          ))}
        </ul>
        {/* Blueprint 3.3: language and translation status, per version (T-304). Nothing here is machine-translated. */}
        <p className="opacity-80">
          <Translated locale={locale} message="story.translationStatus" />
        </p>
      </section>

      <section aria-labelledby="corrections" className="flex flex-col gap-2 text-sm">
        <h2 id="corrections" className="font-semibold">
          <Translated locale={locale} message="story.corrections" />
        </h2>
        {page.corrections.length === 0 ? (
          <p className="opacity-80" data-testid="story-no-corrections">
            <Translated locale={locale} message="story.noCorrections" />
          </p>
        ) : (
          <ol className="flex flex-col gap-1" data-testid="story-corrections">
            {page.corrections.map((c) => (
              <li key={c.noted_at}>
                <time dateTime={c.noted_at}>{when(c.noted_at)}</time>: {c.note}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section aria-labelledby="about" className="flex flex-col gap-2 text-sm">
        <h2 id="about" className="font-semibold">
          <Translated locale={locale} message="story.about" />
        </h2>
        {named.length === 0 && match === null ? (
          <p className="opacity-80" data-testid="story-no-entities">
            <Translated locale={locale} message="story.noEntities" />
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2" data-testid="story-entities">
            {named.map((entity) => (
              <li key={`${entity.entity_type}:${entity.entity_id}`}>
                <EntityChip entity={entity} locale={locale} />
              </li>
            ))}
          </ul>
        )}
        {match !== null && (
          <p data-testid="story-match">
            <Link href={entityHref(locale, match)} className="underline">
              <Translated locale={locale} message="story.matchCentre" />
            </Link>{' '}
            <span className="opacity-80">
              <Translated locale={locale} message="story.matchProducts" />
            </span>
          </p>
        )}
      </section>

      <section aria-labelledby="reports" className="flex flex-col gap-2 text-sm">
        <h2 id="reports" className="font-semibold">
          <Translated locale={locale} message="story.otherReports" />
        </h2>
        {page.reports.length === 0 ? (
          <p className="opacity-80" data-testid="story-no-reports">
            <Translated locale={locale} message="story.noOtherReports" />
          </p>
        ) : (
          <ol className="flex flex-col gap-3" data-testid="story-reports">
            {page.reports.map((report) => (
              <li key={report.article_id}>
                <Report report={report} locale={locale} when={when} />
              </li>
            ))}
          </ol>
        )}
      </section>

      <p className="text-sm opacity-80" data-testid="story-not-yet">
        <Translated locale={locale} message="story.notYet" />
      </p>

      <p
        className="text-sm opacity-80"
        data-testid="story-freshness"
        data-stale={feedsStale(page.last_updated_at) ? 'true' : 'false'}
      >
        {page.last_updated_at === null ? (
          <Translated locale={locale} message="news.neverRead" />
        ) : (
          <>
            <Translated locale={locale} message="news.updated" />{' '}
            <time dateTime={page.last_updated_at}>{when(page.last_updated_at)}</time>
          </>
        )}
      </p>
    </main>
  );
}

function EntityChip({ entity, locale }: { entity: NewsEntity; locale: string }) {
  return (
    <Link href={entityHref(locale, entity)} className="rounded bg-current/10 px-2 py-0.5">
      {entity.localised_name ?? entity.name}
    </Link>
  );
}

/** Another publisher's report: their headline, their name, and the way to them. */
function Report({
  report,
  locale,
  when,
}: {
  report: NewsReport;
  locale: string;
  when: (iso: string) => string;
}) {
  return (
    <article
      className="flex flex-col gap-1 border-s-2 border-s-current/30 ps-3"
      lang={report.language}
    >
      <h3 className="font-semibold">
        <a href={report.url} rel="noopener" className="underline">
          {report.headline}
        </a>
      </h3>
      <p className="opacity-80">
        <Translated locale={locale} message="news.readAt" />{' '}
        <a href={report.source.homepage_url} rel="noopener" className="underline">
          {report.source.name}
        </a>
        {report.byline !== null && <> · {report.byline}</>}
        {' · '}
        {report.published_at === null ? (
          <Translated locale={locale} message="news.noTime" />
        ) : (
          <time dateTime={report.published_at}>{when(report.published_at)}</time>
        )}
      </p>
      {report.summary !== null && <p>{report.summary}</p>}
    </article>
  );
}
