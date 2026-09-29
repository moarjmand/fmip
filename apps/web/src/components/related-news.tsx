import Link from 'next/link';
import type { EntityNewsResponse, FixtureNewsResponse, NewsStoryCard } from '@fmip/contracts';
import { Translated } from '@/components/translated';
import { formatDateTime } from '@/i18n/format';
import { feedsStale, storyHref } from '@/lib/news';
import { Notice } from '@/components/ui';

/**
 * Related news on the match centre (blueprint 4.2, T-145): the stories the
 * news page would show, filtered to this match and its sides inside the
 * window around kick-off, under the same rights -- headline and link to the
 * publisher, never the body (D-061).
 *
 * Three honest states and never an empty box: the feeds have never been read
 * (`not_supplied`, which is not the same as no news), the feeds were read and
 * nothing links the match (`nothing_linked`), or the list. The freshness
 * line is the news page's own (rule 4), so a reader can see when the last
 * read was and whether the list may be behind.
 */
export function RelatedNews({
  locale,
  timeZone,
  news,
}: {
  locale: string;
  timeZone: string;
  /** `null` when the news service could not be reached. */
  news: FixtureNewsResponse | null;
}) {
  if (news === null) {
    return (
      <section className="flex flex-col gap-2" data-testid="related-news" data-state="unreachable">
        <h2 className="text-lg font-semibold">
          <Translated locale={locale} message="news.related.title" />
        </h2>
        <Notice tone="danger">
          <Translated locale={locale} message="news.unreachable" />
        </Notice>
      </section>
    );
  }
  const read = news.stories.last_updated_at;
  const state =
    news.stories.coverage === 'not_supplied' || news.stories.data === null
      ? 'not_supplied'
      : news.stories.data.length === 0
        ? 'nothing_linked'
        : 'listed';
  return (
    <section className="flex flex-col gap-3" data-testid="related-news" data-state={state}>
      <h2 className="text-lg font-semibold">
        <Translated locale={locale} message="news.related.title" />
      </h2>
      <p className="text-xs text-muted" data-testid="related-news-freshness">
        {read === null ? (
          <Translated locale={locale} message="news.neverRead" />
        ) : (
          <>
            <Translated locale={locale} message="news.updated" />{' '}
            <time dateTime={read}>{formatDateTime(locale, read, timeZone)}</time>
            {feedsStale(read) && (
              <>
                {' · '}
                <Translated locale={locale} message="news.stale" />
              </>
            )}
            {' · '}
            <Translated locale={locale} message="news.related.window" />{' '}
            <time dateTime={news.period.since}>
              {formatDateTime(locale, news.period.since, timeZone)}
            </time>
            {' – '}
            <time dateTime={news.period.until}>
              {formatDateTime(locale, news.period.until, timeZone)}
            </time>
          </>
        )}
      </p>
      {state === 'nothing_linked' && (
        <p className="text-sm text-muted" data-testid="related-news-nothing">
          <Translated locale={locale} message="news.related.nothing" />
        </p>
      )}
      {state === 'listed' && news.stories.data !== null && (
        <StoryList locale={locale} timeZone={timeZone} cards={news.stories.data} />
      )}
    </section>
  );
}

/** The news page's cards as the related lists show them: headline to the publisher, then where and when. */
function StoryList({
  locale,
  timeZone,
  cards,
}: {
  locale: string;
  timeZone: string;
  cards: NewsStoryCard[];
}) {
  return (
    <ul className="flex flex-col gap-3" data-testid="related-news-list">
      {cards.map((card) => (
        <li
          key={card.story_id}
          className="flex flex-col gap-0.5 border-s-2 border-s-default ps-3"
          lang={card.language}
          data-testid="related-story"
        >
          <a href={card.url} rel="noopener" className="font-medium underline">
            {card.headline}
          </a>
          <p className="text-xs text-muted">
            <Translated locale={locale} message="news.readAt" />{' '}
            <a href={card.source.homepage_url} rel="noopener" className="underline">
              {card.source.name}
            </a>
            {' · '}
            {card.published_at === null ? (
              <Translated locale={locale} message="news.noTime" />
            ) : (
              <time dateTime={card.published_at}>
                {formatDateTime(locale, card.published_at, timeZone)}
              </time>
            )}
            {' · '}
            <Link href={storyHref(locale, card.story_id)} className="underline">
              <Translated locale={locale} message="news.storyPage" />
            </Link>
          </p>
        </li>
      ))}
    </ul>
  );
}

/**
 * News on a team or competition page (T-944, D-119): the stories the news
 * boundary linked to it, newest first, in the match centre's three honest
 * states -- the feeds never read, nothing linked, or the list -- with the
 * news page's freshness line, and never an empty box.
 */
export function EntityNews({
  locale,
  timeZone,
  news,
}: {
  locale: string;
  timeZone: string;
  /** `null` when the news service could not be reached. */
  news: EntityNewsResponse | null;
}) {
  const heading = (
    <h2 className="text-lg font-semibold">
      <Translated locale={locale} message="news.related.title" />
    </h2>
  );
  if (news === null) {
    return (
      <section className="flex flex-col gap-2" data-testid="entity-news" data-state="unreachable">
        {heading}
        <Notice tone="danger">
          <Translated locale={locale} message="news.unreachable" />
        </Notice>
      </section>
    );
  }
  const read = news.stories.last_updated_at;
  const state =
    news.stories.coverage === 'not_supplied' || news.stories.data === null
      ? 'not_supplied'
      : news.stories.data.length === 0
        ? 'nothing_linked'
        : 'listed';
  return (
    <section className="flex flex-col gap-3" data-testid="entity-news" data-state={state}>
      {heading}
      <p className="text-xs text-muted" data-testid="entity-news-freshness">
        {read === null ? (
          <Translated locale={locale} message="news.neverRead" />
        ) : (
          <>
            <Translated locale={locale} message="news.updated" />{' '}
            <time dateTime={read}>{formatDateTime(locale, read, timeZone)}</time>
            {feedsStale(read) && (
              <>
                {' · '}
                <Translated locale={locale} message="news.stale" />
              </>
            )}
          </>
        )}
      </p>
      {state === 'nothing_linked' && (
        <p className="text-sm text-muted" data-testid="entity-news-nothing">
          <Translated
            locale={locale}
            message={
              news.entity.type === 'team'
                ? 'news.entity.nothingTeam'
                : 'news.entity.nothingCompetition'
            }
          />
        </p>
      )}
      {state === 'listed' && news.stories.data !== null && (
        <StoryList locale={locale} timeZone={timeZone} cards={news.stories.data} />
      )}
    </section>
  );
}
