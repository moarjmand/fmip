import type { Metadata } from 'next';
import Link from '@/components/ui/link';
import { notFound } from 'next/navigation';
import type { NewsEntity, NewsReport, StoryPage as StoryPageData } from '@fmip/contracts';
import { StoryTypeTag } from '@/components/story-type';
import { FilledMessage } from '@/components/filled-message';
import { Translated } from '@/components/translated';
import { formatDateTime, intlLocale } from '@/i18n/format';
import { languageName } from '@/lib/group-about';
import { DEFAULT_LOCALE, type Locale, isLocale } from '@/i18n/locales';
import { interpolate, message, t } from '@/i18n/messages';
import {
  fetchEvaluations,
  fetchFollowing,
  fetchForecastSummaries,
  fetchMatchCentre,
  fetchMe,
  fetchSavedArticles,
  fetchStory,
} from '@/lib/api';
import { ModelExpected } from '@/components/forecast-panel';
import { NewsImageCredit, NewsPhoto, NewsThumb, drawableNewsImage } from '@/components/news-image';
import { SaveArticle } from '@/components/save-article';
import { ShareLink } from '@/components/share-link';
import {
  StoryFollowControls,
  StoryPredictionLinks,
  followableEntities,
} from '@/components/story-links';
import {
  VERSION_STATUS_KEY,
  entityHref,
  feedsStale,
  readStoryQuery,
  storyHref,
  versionStatus,
} from '@/lib/news';
import { canonicalUrl, pageMetadata } from '@/lib/seo';
import { sessionCookieHeader } from '@/lib/session';
import { LinkOut, Notice } from '@/components/ui';
import { pageTimeZone } from '@/lib/reader-time-zone-server';
import { ModelVersion } from '@/components/model-version';

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
  const resolved: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const storyTitle = `${t(resolved, 'storyPage.title')} · Stadiomind`;
  if (!UUID.test(id)) return { title: storyTitle, robots: { index: false, follow: false } };
  const result = await fetchStory(id, readStoryQuery(query).language, locale);
  if (!result.ok) return pageMetadata({ locale, path: `/news/story/${id}`, title: storyTitle });
  const { story } = result.data;
  return pageMetadata({
    locale,
    path: `/news/story/${id}`,
    title: `${story.headline} · Stadiomind`,
    // The publisher's own summary, or their headline again: nothing is written for them.
    description:
      story.summary ??
      interpolate(t(resolved, 'storyPage.description'), {
        headline: story.headline,
        source: story.source.name,
      }),
  });
}

/**
 * The story page (blueprint 3.3, T-144), built against D-061: the original's
 * words as the publisher wrote them, the way back to the publisher, the
 * languages it exists in, its corrections, the other publishers' reports of
 * the same event, and the match, teams and competition it is about.
 *
 * What the blueprint lists and a free feed cannot give is named, not filled
 * (rule 3): the body is `not_supplied` and the page sends the reader on.
 *
 * T-842 added saving. T-941 adds a share control (the page's canonical
 * address and nothing about the sharer, T-521), follow controls for the teams
 * and competitions the story links, and for a match story the three
 * prediction products as three links, each with its own name, to their own
 * sections of the match centre: linked, never copied or combined (rule 6).
 *
 * T-1383 (D-201) set it in the Hybrid design's editorial mode: the headline
 * in the serif display, the words at the 680px measure, the rest beside
 * them. A match report carries "What the model expected": the model's
 * pre-match forecast, with its version and time, beside the result, in the
 * model's lane only. The publisher's credit, the photo credit and the link
 * out naming the publisher stay.
 *
 * T-1621 (D-291) takes it off editorial paper: it follows the theme like
 * every other page. The reading stays a reading: the headline in the
 * editorial face, as the news front page sets its lead (D-284), and the
 * publisher's words in the article face at the 680px measure (Newsreader on
 * a Latin page, Vazirmatn on /fa). Everything beside the words is a card on
 * the surface, and every control in it a 44px target on a phone.
 */
const CARD = 'flex flex-col gap-2.5 rounded-tile border border-default bg-surface p-4 text-sm';
const CARD_HEADING = 'text-sm font-extrabold';
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
  const [me, result, savedList, following] = await Promise.all([
    fetchMe(cookie),
    fetchStory(id, q.language, locale),
    fetchSavedArticles(cookie),
    fetchFollowing(cookie),
  ]);
  if (!result.ok && result.status === 404) notFound();
  const { timeZone } = await pageTimeZone(locale, me);

  if (!result.ok) {
    return (
      <main>
        <div className="page-frame py-8">
          <Notice tone="danger" data-testid="story-unreachable">
            <Translated locale={locale} message="news.unreachable" />
          </Notice>
        </div>
      </main>
    );
  }

  const page: StoryPageData = result.data;
  const { story } = page;
  const match = story.entities.find((e) => e.entity_type === 'fixture') ?? null;
  const named = story.entities.filter((e) => e.entity_type !== 'fixture');
  const when = (iso: string): string => formatDateTime(locale, iso, timeZone);
  const expected =
    match !== null && story.type.data?.type === 'match_report'
      ? await modelExpected(match.entity_id, locale)
      : null;

  return (
    <main className="pb-16" data-testid="story-page">
      <div className="page-frame flex flex-col gap-4 pt-3 md:gap-6 md:pt-6">
        <p className="text-sm">
          <Link
            href={`/${locale}/news`}
            className="-ms-1 inline-flex min-h-touch items-center gap-1 px-1 font-bold text-accent hover:underline focus-visible:underline"
            data-testid="back-to-news"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              aria-hidden="true"
              focusable="false"
              className="shrink-0 rtl:-scale-x-100"
            >
              <path
                d="m14.5 6-6 6 6 6"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <Translated locale={locale} message="news.title" />
          </Link>
        </p>

        <div className="grid gap-10 lg:grid-cols-[minmax(0,42.5rem)_minmax(0,1fr)] lg:gap-14">
          <article className="flex max-w-measure min-w-0 flex-col gap-5" lang={story.language}>
            <header className="flex flex-col gap-3">
              <StoryTypeTag locale={locale} type={story.type} sayNone />
              <h1
                className="font-serif text-display-1 font-semibold break-words sm:text-display-2 md:text-display-3"
                data-testid="title"
              >
                {story.headline}
              </h1>
              {story.summary !== null && (
                <p className="font-article text-xl text-muted" data-testid="story-summary">
                  {story.summary}
                </p>
              )}
              <p
                className="border-y border-default py-2.5 text-sm text-caption"
                data-testid="story-source"
              >
                <Translated locale={locale} message="news.readAt" />{' '}
                <a href={story.source.homepage_url} rel="noopener" className="underline">
                  <bdi>{story.source.name}</bdi>
                </a>
                {story.byline !== null && (
                  <>
                    {' · '}
                    <bdi>{story.byline}</bdi>
                  </>
                )}
                {' · '}
                {story.published_at === null ? (
                  <Translated locale={locale} message="news.noTime" />
                ) : (
                  <time dateTime={story.published_at}>{when(story.published_at)}</time>
                )}
              </p>
            </header>
            <NewsPhoto image={story.image} headline={story.headline} locale={locale} />

            {page.body.data !== null ? (
              <div
                className="font-article text-article whitespace-pre-line"
                data-testid="story-body"
              >
                {page.body.data}
              </div>
            ) : (
              // D-061: the free feed grants no body. The product is the way to the original.
              <div
                className="flex flex-col items-start gap-3"
                data-testid="story-body-not-supplied"
              >
                <p className="font-article text-article">
                  <Translated locale={locale} message="story.bodyAtSource" />
                </p>
                <LinkOut
                  href={story.url}
                  host={story.source.name}
                  look="button"
                  testId="story-link"
                >
                  <Translated locale={locale} message="story.readOriginal" />
                </LinkOut>
              </div>
            )}

            {expected !== null && (
              <div lang={locale}>
                <ModelExpected {...expected} timeZone={timeZone} locale={locale} />
              </div>
            )}

            <section
              aria-labelledby="sources"
              className="flex flex-col gap-2 border-t-2 border-fg pt-2.5 text-sm"
              lang={locale}
              data-testid="story-sources"
            >
              <h2 id="sources" className="text-xs font-extrabold tracking-wide uppercase">
                <Translated locale={locale} message="story.sources" />
              </h2>
              <ul className="flex flex-col gap-1 text-muted">
                <li>
                  <FilledMessage
                    message={message(
                      isLocale(locale) ? locale : DEFAULT_LOCALE,
                      'story.sources.words',
                    )}
                    params={{
                      source: (
                        <a href={story.source.homepage_url} rel="noopener" className="underline">
                          <bdi>{story.source.name}</bdi>
                        </a>
                      ),
                    }}
                  />
                </li>
                {drawableNewsImage(story.image) && (
                  <li>
                    <NewsImageCredit image={story.image} locale={locale} className="text-sm" />
                  </li>
                )}
                {expected !== null &&
                  expected.summary !== null &&
                  expected.summary !== 'unreachable' && (
                    <li data-testid="story-sources-forecast">
                      <FilledMessage
                        message={message(
                          isLocale(locale) ? locale : DEFAULT_LOCALE,
                          'story.sources.forecast',
                        )}
                        params={{
                          version: (
                            <span dir="ltr" className="font-mono text-xs">
                              <ModelVersion version={expected.summary.model_version} />
                            </span>
                          ),
                        }}
                      />
                    </li>
                  )}
              </ul>
            </section>

            <p className="text-sm text-muted" data-testid="story-updated">
              <Translated locale={locale} message="story.updated" />{' '}
              <time dateTime={page.updated_at}>{when(page.updated_at)}</time>
            </p>
          </article>

          <aside className="flex min-w-0 flex-col gap-4">
            <section aria-labelledby="languages" className={CARD}>
              <h2 id="languages" className={CARD_HEADING}>
                <Translated locale={locale} message="story.languages" />
              </h2>
              <ul className="flex flex-wrap gap-2" data-testid="story-languages">
                {page.versions.map((v) => (
                  <li key={v.language}>
                    <Link
                      href={storyHref(locale, id, v.language)}
                      aria-current={v.language === story.language ? 'true' : undefined}
                      className={`inline-flex min-h-touch items-center rounded-pill border px-3.5 ${v.language === story.language ? 'border-accent bg-brand/14 font-extrabold' : 'border-default hover:border-strong'}`}
                      hrefLang={v.language}
                      data-language={v.language}
                      data-origin={v.origin}
                      data-review-state={v.review_state ?? ''}
                    >
                      {/* The language's name in the reader's words ("American English"), not its tag (T-1395). */}
                      {languageName(intlLocale(locale), v.language)}
                      {' · '}
                      <Translated locale={locale} message={VERSION_STATUS_KEY[versionStatus(v)]} />
                    </Link>
                  </li>
                ))}
              </ul>
              {/* Blueprint 3.3: language and translation status, per version (T-304). Nothing here is machine-translated. */}
              <p className="text-muted">
                <Translated locale={locale} message="story.translationStatus" />
              </p>
            </section>

            <section aria-labelledby="corrections" className={CARD}>
              <h2 id="corrections" className={CARD_HEADING}>
                <Translated locale={locale} message="story.corrections" />
              </h2>
              {page.corrections.length === 0 ? (
                <p className="text-muted" data-testid="story-no-corrections">
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

            <section aria-labelledby="about" className={CARD}>
              <h2 id="about" className={CARD_HEADING}>
                <Translated locale={locale} message="story.about" />
              </h2>
              {named.length === 0 && match === null ? (
                <p className="text-muted" data-testid="story-no-entities">
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
                  <Link
                    href={entityHref(locale, match)}
                    className="inline-flex min-h-touch items-center font-bold text-accent hover:underline focus-visible:underline"
                  >
                    <Translated locale={locale} message="story.matchCentre" />
                  </Link>
                </p>
              )}
            </section>

            {match !== null && (
              <div className={CARD}>
                <StoryPredictionLinks locale={locale} fixtureId={match.entity_id} />
              </div>
            )}

            <div className={CARD}>
              <StoryFollowControls
                locale={locale}
                storyId={story.story_id}
                entities={followableEntities(named)}
                signedIn={me !== null}
                following={following}
              />
            </div>

            <section aria-labelledby="reports" className={CARD}>
              <h2 id="reports" className={CARD_HEADING}>
                <Translated locale={locale} message="story.otherReports" />
              </h2>
              {page.reports.length === 0 ? (
                <p className="text-muted" data-testid="story-no-reports">
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

            <div className={CARD}>
              {me !== null && savedList !== null && savedList.ok ? (
                <div data-testid="story-save">
                  <SaveArticle
                    locale={locale}
                    storyId={story.story_id}
                    headline={story.headline}
                    language={story.language}
                    saved={savedList.data.saved.some((s) => s.story_id === story.story_id)}
                  />
                </div>
              ) : me === null ? (
                <p className="text-sm text-muted" data-testid="story-save-sign-in">
                  <Link
                    href={`/${locale}/login`}
                    className="inline-flex min-h-touch items-center underline"
                  >
                    <Translated locale={locale} message="saved.signIn" />
                  </Link>
                </p>
              ) : null}

              <p className="text-sm" data-testid="story-share">
                <ShareLink
                  url={canonicalUrl(locale, `/news/story/${id}`)}
                  title={story.headline}
                  label={<Translated locale={locale} message="story.share" />}
                  messages={{
                    copied: message(isLocale(locale) ? locale : DEFAULT_LOCALE, 'share.copied'),
                    manual: message(isLocale(locale) ? locale : DEFAULT_LOCALE, 'share.manual'),
                  }}
                />
              </p>

              <p
                className="text-sm text-muted"
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
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}

/**
 * What a match report's model box needs (T-1383): the match's names and
 * full-time score, the version computed before kick-off, and that version's
 * evaluation. Three reads, only for a match report.
 */
async function modelExpected(
  fixtureId: string,
  locale: string,
): Promise<Omit<Parameters<typeof ModelExpected>[0], 'timeZone' | 'locale'>> {
  const [centre, summaries, evaluations] = await Promise.all([
    fetchMatchCentre(fixtureId),
    fetchForecastSummaries([fixtureId]),
    fetchEvaluations(fixtureId),
  ]);
  const l: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const summary = !summaries.ok
    ? ('unreachable' as const)
    : (summaries.data.fixtures.find((f) => f.fixture_id === fixtureId)?.pre_kickoff ?? null);
  const evaluation =
    summary === null || summary === 'unreachable' || !evaluations.ok
      ? null
      : (evaluations.data.evaluations
          .filter((e) => e.pre_kickoff && e.version_number === summary.version_number)
          .at(-1) ?? null);
  return {
    summary,
    evaluation,
    result: centre.ok ? centre.data.fixture.scores.full_time : null,
    home: centre.ok ? centre.data.fixture.home.name : t(l, 'matchCentre.home'),
    away: centre.ok ? centre.data.fixture.away.name : t(l, 'matchCentre.away'),
  };
}

function EntityChip({ entity, locale }: { entity: NewsEntity; locale: string }) {
  return (
    <Link
      href={entityHref(locale, entity)}
      className="inline-flex min-h-touch items-center rounded-pill border border-default bg-surface-raised px-3.5 font-semibold hover:border-strong"
    >
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
      className="flex gap-3 border-s-2 border-s-default ps-3"
      lang={report.language}
      data-testid="story-report"
    >
      <NewsThumb image={report.image} />
      <div className="flex min-w-0 flex-col gap-1">
        <h3 className="font-semibold">
          <a href={report.url} rel="noopener" className="underline">
            {report.headline}
          </a>
        </h3>
        <p className="text-muted">
          <Translated locale={locale} message="news.readAt" />{' '}
          <a href={report.source.homepage_url} rel="noopener" className="underline">
            <bdi>{report.source.name}</bdi>
          </a>
          {report.byline !== null && (
            <>
              {' · '}
              <bdi>{report.byline}</bdi>
            </>
          )}
          {' · '}
          {report.published_at === null ? (
            <Translated locale={locale} message="news.noTime" />
          ) : (
            <time dateTime={report.published_at}>{when(report.published_at)}</time>
          )}
        </p>
        {report.summary !== null && <p>{report.summary}</p>}
        {drawableNewsImage(report.image) && (
          <NewsImageCredit image={report.image} locale={locale} />
        )}
      </div>
    </article>
  );
}
