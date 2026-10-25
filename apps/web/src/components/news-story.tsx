import type { NewsStoryCard } from '@fmip/contracts';
import Link from '@/components/ui/link';
import { NewsCardImage, NewsImageCredit, drawableNewsImage } from '@/components/news-image';
import { StoryTypeTag } from '@/components/story-type';
import { Translated } from '@/components/translated';
import { formatDateTime, formatNumber } from '@/i18n/format';
import { entityHref, storyHref } from '@/lib/news';

/** One story: the publisher's words, their name, and the way back to them. */
export function NewsStory({
  card,
  locale,
  timeZone,
}: {
  card: NewsStoryCard;
  locale: string;
  timeZone: string;
}) {
  return (
    <article className="flex flex-col gap-1 border-s-2 border-s-default ps-4" data-testid="story">
      {drawableNewsImage(card.image) && (
        <div className="flex flex-col gap-1">
          <NewsCardImage image={card.image} />
          <NewsImageCredit image={card.image} locale={locale} />
        </div>
      )}
      <h2 className="text-lg font-semibold">
        {/*
          The publisher's words carry their own language and direction (T-1570):
          an English headline on /fa reads left to right, its full stop at its
          end, while the reader's own words around it stay the page's.
        */}
        <a
          href={card.url}
          rel="noopener"
          className="underline"
          lang={card.language}
          dir="auto"
          data-testid="story-link"
        >
          {card.headline}
        </a>
      </h2>
      <StoryTypeTag locale={locale} type={card.type} />
      {card.breaking !== null && (
        <p className="text-sm" data-testid="story-breaking">
          <span className="font-medium">
            <Translated locale={locale} message="news.breaking.badge" />
          </span>{' '}
          {card.breaking.note}
        </p>
      )}
      <p className="text-sm text-muted" data-testid="story-source">
        <Translated locale={locale} message="news.readAt" />{' '}
        <a href={card.source.homepage_url} rel="noopener" className="underline">
          <bdi>{card.source.name}</bdi>
        </a>
        {card.byline !== null && (
          <>
            {' · '}
            <bdi>{card.byline}</bdi>
          </>
        )}
        {' · '}
        {card.published_at === null ? (
          <Translated locale={locale} message="news.noTime" />
        ) : (
          <time dateTime={card.published_at}>
            {formatDateTime(locale, card.published_at, timeZone)}
          </time>
        )}
      </p>
      {card.summary !== null && (
        <p lang={card.language} dir="auto" data-testid="story-summary">
          {card.summary}
        </p>
      )}
      {card.entities.length > 0 && (
        <ul className="flex flex-wrap gap-2 text-sm" data-testid="story-entities">
          {card.entities.map((entity) => (
            <li key={`${entity.entity_type}:${entity.entity_id}`}>
              <Link
                href={entityHref(locale, entity)}
                className="inline-flex min-h-touch items-center rounded bg-surface-raised px-2 md:min-h-6"
              >
                {entity.entity_type === 'fixture' ? (
                  <Translated locale={locale} message="news.match" />
                ) : (
                  (entity.localised_name ?? entity.name)
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="flex flex-wrap items-center gap-x-1 text-sm" data-testid="story-more">
        <Link
          href={storyHref(locale, card.story_id)}
          className="inline-flex min-h-touch items-center underline md:min-h-6"
        >
          <Translated locale={locale} message="news.storyPage" />
        </Link>
        {card.other_reports > 0 && (
          <>
            {' · '}
            <span className="text-muted" data-testid="story-others">
              <Translated locale={locale} message="news.otherReports" count={card.other_reports} />
            </span>
          </>
        )}
      </p>
      {card.discussion !== null && (
        <p className="text-sm" data-testid="story-discussion">
          <Translated
            locale={locale}
            message="news.discussion"
            count={card.discussion.participants}
            params={{ hours: formatNumber(locale, card.discussion.window_hours) }}
          />
          {' · '}
          <Translated
            locale={locale}
            message="news.savers"
            count={card.discussion.savers}
            params={{ hours: formatNumber(locale, card.discussion.window_hours) }}
          />
        </p>
      )}
      {card.debate !== null && (
        <p className="text-sm" data-testid="story-debate">
          <span className="font-medium">
            <Translated locale={locale} message="news.debateNote" />
          </span>{' '}
          {card.debate.note}
        </p>
      )}
    </article>
  );
}
