import type { NewsEntity, NewsStoryCard } from '@fmip/contracts';
import Link from '@/components/ui/link';
import { EntityImage, type EntityImageKind } from '@/components/entity-image';
import { Pictured } from '@/components/lite-mode';
import { NewsImageCredit, drawableNewsImage } from '@/components/news-image';
import { NewsVisual } from '@/components/news-visual';
import { StoryTypeTag } from '@/components/story-type';
import { Translated } from '@/components/translated';
import { cx } from '@/components/ui/cx';
import { inlineTargetClasses } from '@/components/ui';
import { formatAgo, formatDate, formatDateTime, formatNumber } from '@/i18n/format';
import { STORY_TYPE_KEY, entityHref, orderedEntities, recentAge, storyHref } from '@/lib/news';

/**
 * One story on the news front page (T-1570; T-1613, D-284): the publisher's
 * words, their name and time, the way back to them, and what the story is
 * filed under. Three shapes over the same card:
 *
 * - `lead`: the first story, its picture beside its words on a desktop;
 * - `card`: the row under it, the picture above the headline;
 * - `row`: the compact list, a small picture on the inline start.
 *
 * The picture is the licensed photo with its credit, or the designed panel
 * of the story's crests or its source's name (`NewsVisual`), never a stand-in
 * photo (rule 3). The publisher's headline and summary carry the story's
 * language and their own direction; the reader's words around them stay the
 * page's.
 */
export type NewsStoryVariant = 'lead' | 'card' | 'row';

export function NewsStory({
  card,
  locale,
  timeZone,
  now,
  variant = 'row',
  headingLevel,
}: {
  card: NewsStoryCard;
  locale: string;
  timeZone: string;
  /** The page's clock, for "3 hr ago" (ISO). */
  now: string;
  variant?: NewsStoryVariant;
  /** The headline's level: 2 for the lead, 3 under a section heading (the default). */
  headingLevel?: 2 | 3;
}) {
  const H = (headingLevel ?? (variant === 'lead' ? 2 : 3)) === 2 ? 'h2' : 'h3';
  const lead = variant === 'lead';
  const row = variant === 'row';
  const photo = drawableNewsImage(card.image) ? card.image : null;
  return (
    <article
      className={cx(
        'min-w-0',
        lead && 'grid items-center gap-5 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-8',
        variant === 'card' && 'flex flex-col gap-2.5',
        row && 'flex items-start gap-3 sm:gap-4',
      )}
      data-testid="story"
      data-variant={variant}
    >
      <NewsVisual
        card={card}
        locale={locale}
        size={lead ? 'lead' : row ? 'thumb' : 'card'}
        eager={lead}
      />
      <div className={cx('flex min-w-0 flex-col', lead ? 'gap-3' : 'gap-1.5')}>
        {lead ? (
          <StoryTypeTag locale={locale} type={card.type} />
        ) : (
          <StoryKicker card={card} locale={locale} />
        )}
        {/* The heading's block takes the headline's direction, so an English one on /fa sits flush left like its summary. */}
        <H
          dir="auto"
          className={cx(
            'font-semibold',
            lead && 'font-serif text-3xl leading-tight sm:text-display-2',
            variant === 'card' && 'font-serif text-xl leading-snug',
            row && 'text-base leading-snug sm:text-lg',
          )}
        >
          {/*
            The publisher's words carry their own language and direction (T-1570):
            an English headline on /fa reads left to right, its full stop at its
            end, while the reader's own words around it stay the page's.
          */}
          <a
            href={card.url}
            rel="noopener"
            className="decoration-accent decoration-2 underline-offset-4 hover:underline"
            lang={card.language}
            dir="auto"
            data-testid="story-link"
          >
            {card.headline}
          </a>
        </H>
        {card.summary !== null && variant !== 'card' && (
          <p
            className={cx('text-muted', lead ? 'text-base' : 'line-clamp-2 text-sm max-sm:hidden')}
            lang={card.language}
            dir="auto"
            data-testid="story-summary"
          >
            {card.summary}
          </p>
        )}
        <Meta card={card} locale={locale} timeZone={timeZone} now={now} lead={lead} />
        {row && photo !== null && (
          <Pictured>
            <NewsImageCredit image={photo} locale={locale} />
          </Pictured>
        )}
        {card.breaking !== null && (
          <p className="border-s-2 border-s-brand ps-2 text-sm" data-testid="story-breaking">
            <span className="font-semibold">
              <Translated locale={locale} message="news.breaking.badge" />
            </span>{' '}
            {card.breaking.note}
          </p>
        )}
        <NewsTags entities={card.entities} locale={locale} />
        <p className="flex flex-wrap items-center gap-x-2 text-sm" data-testid="story-more">
          {variant !== 'card' && (
            <Link
              href={storyHref(locale, card.story_id)}
              className="inline-flex min-h-touch items-center font-medium underline md:min-h-6"
            >
              <Translated locale={locale} message="news.storyPage" />
            </Link>
          )}
          {card.other_reports > 0 &&
            (variant === 'card' ? (
              <Link
                href={storyHref(locale, card.story_id)}
                className="inline-flex min-h-touch items-center text-muted underline md:min-h-6"
                data-testid="story-others"
              >
                <Translated
                  locale={locale}
                  message="news.otherReports"
                  count={card.other_reports}
                />
              </Link>
            ) : (
              <span className="text-muted" data-testid="story-others">
                <Translated
                  locale={locale}
                  message="news.otherReports"
                  count={card.other_reports}
                />
              </span>
            ))}
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
            <span className="font-semibold">
              <Translated locale={locale} message="news.debateNote" />
            </span>{' '}
            {card.debate.note}
          </p>
        )}
      </div>
    </article>
  );
}

/** A card's type above its headline, in saffron capitals; nothing when it has none (D-123). */
export function StoryKicker({ card, locale }: { card: NewsStoryCard; locale: string }) {
  if (card.type.data === null || card.type.coverage === 'not_supplied') return null;
  return (
    <p
      className="text-xs font-bold tracking-widest text-accent uppercase"
      data-testid="story-type"
      data-type={card.type.data.type}
    >
      <Translated locale={locale} message={STORY_TYPE_KEY[card.type.data.type]} />
    </p>
  );
}

/** The source and the time, on every card; the lead also says the byline and links the source. */
function Meta({
  card,
  locale,
  timeZone,
  now,
  lead,
}: {
  card: NewsStoryCard;
  locale: string;
  timeZone: string;
  now: string;
  lead: boolean;
}) {
  return (
    <p
      className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted sm:text-sm"
      data-testid="story-source"
    >
      {lead ? (
        <span>
          <Translated locale={locale} message="news.readAt" />{' '}
          <a
            href={card.source.homepage_url}
            rel="noopener"
            className={inlineTargetClasses('font-semibold text-fg underline')}
          >
            <bdi>{card.source.name}</bdi>
          </a>
        </span>
      ) : (
        <span className="font-semibold text-fg">
          <bdi>{card.source.name}</bdi>
        </span>
      )}
      {lead && card.byline !== null && (
        <>
          <span aria-hidden="true">·</span>
          <bdi>{card.byline}</bdi>
        </>
      )}
      <span aria-hidden="true">·</span>
      <StoryTime card={card} locale={locale} timeZone={timeZone} now={now} />
    </p>
  );
}

/** "3 hr ago" within a day, else the date; the full time on hover; never the fetch time. */
export function StoryTime({
  card,
  locale,
  timeZone,
  now,
}: {
  card: NewsStoryCard;
  locale: string;
  timeZone: string;
  now: string;
}) {
  if (card.published_at === null) return <Translated locale={locale} message="news.noTime" />;
  const age = recentAge(card.published_at, new Date(now));
  return (
    <time dateTime={card.published_at} title={formatDateTime(locale, card.published_at, timeZone)}>
      {age !== null
        ? formatAgo(locale, age)
        : formatDate(locale, card.published_at, timeZone, { day: 'numeric', month: 'short' })}
    </time>
  );
}

const TAG_KIND: Record<Exclude<NewsEntity['entity_type'], 'fixture'>, EntityImageKind> = {
  team: 'crest',
  competition: 'logo',
  person: 'photo',
};

/**
 * What a story is filed under, each a link to its page by id (rule 1): the
 * clubs and the competition with their crest or logo, the people with their
 * photo, the match by name. A 44px target on a phone around a smaller chip.
 */
export function NewsTags({
  entities,
  locale,
  className,
}: {
  entities: readonly NewsEntity[];
  locale: string;
  className?: string;
}) {
  if (entities.length === 0) return null;
  return (
    <ul className={cx('flex flex-wrap gap-x-1.5', className)} data-testid="story-entities">
      {orderedEntities(entities).map((entity) => (
        <li key={`${entity.entity_type}:${entity.entity_id}`}>
          <Link
            href={entityHref(locale, entity)}
            className="group/tag inline-flex min-h-touch items-center md:min-h-8"
            data-testid="story-tag"
            data-type={entity.entity_type}
          >
            <span
              className={cx(
                'inline-flex h-7 items-center gap-1.5 rounded-pill border border-default bg-surface pe-2.5 text-xs font-semibold group-hover/tag:border-strong',
                entity.entity_type === 'fixture' ? 'ps-2.5' : 'ps-1',
              )}
            >
              {entity.entity_type !== 'fixture' && (
                <EntityImage
                  media={entity.media}
                  kind={TAG_KIND[entity.entity_type]}
                  name={entity.localised_name ?? entity.name ?? ''}
                  size={20}
                />
              )}
              {entity.entity_type === 'fixture' ? (
                <Translated locale={locale} message="news.match" />
              ) : (
                <bdi>{entity.localised_name ?? entity.name}</bdi>
              )}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
