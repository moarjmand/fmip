import type { NewsStoryCard } from '@fmip/contracts';
import Link from '@/components/ui/link';
import { RuleHeading } from '@/components/home-front';
import { Pictured } from '@/components/lite-mode';
import { NewsImageCredit, drawableNewsImage } from '@/components/news-image';
import { NewsTags, StoryKicker, StoryTime } from '@/components/news-story';
import { NewsVisual, type NewsVisualSize } from '@/components/news-visual';
import { Translated } from '@/components/translated';
import { cx } from '@/components/ui/cx';
import { inlineTargetClasses } from '@/components/ui';
import { VERSION_STATUS_KEY, storyHref, versionStatus } from '@/lib/news';

/**
 * The home page's news (blueprint 2.3 and 3; T-1613, D-284): the newest
 * stories as a small front page -- the lead with its picture, two cards,
 * then three rows -- with the same pictures as the news page: the licensed
 * photo with its credit (D-177), or the designed panel of the crests and
 * logos we hold or the source's name, never a stand-in photo (rule 3).
 * Everything here is below the fold, so every picture is lazy.
 *
 * Each headline opens the story's page here, which links to the original
 * (D-061); the source and the time are on every story, and a line says
 * when the feeds are behind (rule 4).
 */
export function HomeNews({
  stories,
  stale,
  locale,
  timeZone,
  now,
}: {
  stories: NewsStoryCard[];
  stale: boolean;
  locale: string;
  timeZone: string;
  /** The page's clock (ISO), for "3 hr ago". */
  now: string;
}) {
  const [lead, ...others] = stories;
  if (lead === undefined) return null;
  const cards = others.slice(0, 2);
  const rows = others.slice(2);
  return (
    <section aria-labelledby="home-news-title" data-testid="home-news">
      <RuleHeading
        id="home-news-title"
        size="lg"
        title={<Translated locale={locale} message="home.news.title" />}
        aside={
          <>
            <Translated locale={locale} message="home.news.credited" />
            {' · '}
            <Link
              href={`/${locale}/news`}
              className={inlineTargetClasses('font-semibold text-fg underline')}
              data-testid="home-news-all"
            >
              <Translated locale={locale} message="home.news.all" />
            </Link>
          </>
        }
      />
      {stale && (
        <p className="mb-3 text-sm text-warning" data-testid="home-news-stale">
          <Translated locale={locale} message="news.stale" />
        </p>
      )}
      <ul className="grid gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
        <HomeStory
          card={lead}
          size="lead"
          className="sm:col-span-2 lg:row-span-2"
          locale={locale}
          timeZone={timeZone}
          now={now}
        />
        {cards.map((card) => (
          <HomeStory
            key={card.story_id}
            card={card}
            size="card"
            locale={locale}
            timeZone={timeZone}
            now={now}
          />
        ))}
        {rows.map((card) => (
          <HomeStory
            key={card.story_id}
            card={card}
            size="thumb"
            locale={locale}
            timeZone={timeZone}
            now={now}
          />
        ))}
      </ul>
    </section>
  );
}

function HomeStory({
  card,
  size,
  className,
  locale,
  timeZone,
  now,
}: {
  card: NewsStoryCard;
  size: NewsVisualSize;
  className?: string;
  locale: string;
  timeZone: string;
  now: string;
}) {
  const row = size === 'thumb';
  const lead = size === 'lead';
  const href = storyHref(locale, card.story_id);
  return (
    <li
      className={cx('min-w-0', row ? 'flex items-start gap-3' : 'flex flex-col gap-2.5', className)}
      data-testid="home-story"
      data-variant={size}
    >
      <NewsVisual card={card} locale={locale} size={size} href={href} />
      <div className="flex min-w-0 flex-col gap-1.5">
        <StoryKicker card={card} locale={locale} />
        <h3
          dir="auto"
          className={cx(
            'font-semibold',
            lead && 'font-serif text-3xl leading-tight',
            size === 'card' && 'font-serif text-xl leading-snug',
            row && 'text-base leading-snug',
          )}
        >
          <Link
            href={href}
            className="decoration-accent decoration-2 underline-offset-4 hover:underline"
            lang={card.language}
            dir="auto"
            data-testid="home-story-link"
          >
            {card.headline}
          </Link>
        </h3>
        {lead && card.summary !== null && (
          <p
            className="line-clamp-3 text-muted"
            lang={card.language}
            dir="auto"
            data-testid="home-story-summary"
          >
            {card.summary}
          </p>
        )}
        <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted sm:text-sm">
          <span className="font-semibold text-fg">
            <bdi>{card.source.name}</bdi>
          </span>
          <span aria-hidden="true">·</span>
          <StoryTime card={card} locale={locale} timeZone={timeZone} now={now} />
          {card.origin !== 'publisher' && (
            <>
              <span aria-hidden="true">·</span>
              <Translated locale={locale} message={VERSION_STATUS_KEY[versionStatus(card)]} />
            </>
          )}
        </p>
        {row && drawableNewsImage(card.image) && (
          <Pictured>
            <NewsImageCredit image={card.image} locale={locale} />
          </Pictured>
        )}
        {lead && <NewsTags entities={card.entities} locale={locale} />}
      </div>
    </li>
  );
}
