import type { NewsEntity, NewsImage, NewsStoryCard } from '@fmip/contracts';
import { EntityImage, type EntityImageKind, type EntityImageSize } from '@/components/entity-image';
import { Pictured } from '@/components/lite-mode';
import { NewsImageCredit, drawableNewsImage } from '@/components/news-image';
import { cx } from '@/components/ui/cx';
import { panelMarks } from '@/lib/news';

/**
 * A story's picture on the news front page and the home page (T-1613, D-284).
 *
 * With a licensed photo (D-177) it is that photo, from our own server, its
 * width and height said so nothing moves, and its credit and licence beneath
 * it -- always beside the photo, in lite mode neither.
 *
 * Without one it is never a stock or stand-in photo (rule 3). It is a panel
 * drawn from what we own and is plainly a graphic: the Stadiomind pitch lines
 * on the brand's saffron edge, carrying the crests, logos and player photos
 * we hold of what the story is filed under (D-176), or, when we hold none,
 * the source's name set in type. Nothing in it could pass for a news
 * photograph, and it is decorative: the headline beside it names the story.
 * Lite mode draws none of it.
 *
 * The picture links to the original like the headline does, out of the tab
 * order and hidden from assistive technology so a keyboard or a screen
 * reader meets the story's link once; the credit stays outside the link.
 */

export type NewsVisualSize = 'lead' | 'card' | 'thumb';

/** How many marks a panel carries, and how large. */
const MARKS: Record<NewsVisualSize, number> = { lead: 3, card: 3, thumb: 2 };
const MARK_SIZE: Record<NewsVisualSize, EntityImageSize> = { lead: 96, card: 48, thumb: 40 };
/** The lead's marks shrink on a phone, so three still fit 328px. */
const MARK_CLASS: Record<NewsVisualSize, string | undefined> = {
  lead: 'max-sm:size-16',
  card: undefined,
  thumb: undefined,
};
const MEDALLION: Record<NewsVisualSize, string> = {
  lead: 'p-3 sm:p-4',
  card: 'p-2',
  thumb: '',
};
const KIND: Record<Exclude<NewsEntity['entity_type'], 'fixture'>, EntityImageKind> = {
  team: 'crest',
  competition: 'logo',
  person: 'photo',
};

/** The space to reserve when the photo's header gave no size: 16:9. */
const FALLBACK = { width: 1600, height: 900 };

function photoSize(image: NewsImage): { width: number; height: number } {
  return image.width !== null && image.height !== null && image.width > 0 && image.height > 0
    ? { width: image.width, height: image.height }
    : FALLBACK;
}

/** The box a picture fills: 16:9 everywhere, a 96px or 128px wide tile in a list row. */
function frame(size: NewsVisualSize): string {
  return size === 'thumb'
    ? 'aspect-video w-24 shrink-0 rounded-control sm:w-32'
    : 'aspect-video w-full rounded-tile';
}

export function NewsVisual({
  card,
  locale,
  size,
  eager = false,
}: {
  card: NewsStoryCard;
  locale: string;
  size: NewsVisualSize;
  /** The lead on the news page, above the fold: loaded at once rather than lazily. */
  eager?: boolean;
}) {
  const image = card.image;
  if (drawableNewsImage(image)) {
    const { width, height } = size === 'thumb' ? { width: 128, height: 72 } : photoSize(image);
    return (
      <Pictured>
        <div className={cx('flex flex-col gap-1', size === 'thumb' && 'shrink-0')}>
          <a href={card.url} rel="noopener" tabIndex={-1} aria-hidden="true" className="block">
            {/* A plain image on purpose: no optimiser route, no client JS (news-image.tsx). */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={image.url}
              width={width}
              height={height}
              alt=""
              loading={eager ? 'eager' : 'lazy'}
              decoding={eager ? 'auto' : 'async'}
              className={cx('h-auto bg-surface-raised object-cover', frame(size))}
              data-testid="news-image"
              data-variant={size}
            />
          </a>
          {/* A row's credit sits with its words (NewsStory); every other one is under the photo. */}
          {size !== 'thumb' && <NewsImageCredit image={image} locale={locale} />}
        </div>
      </Pictured>
    );
  }
  return (
    <a
      href={card.url}
      rel="noopener"
      tabIndex={-1}
      aria-hidden="true"
      className={cx('block lite:hidden', size === 'thumb' && 'shrink-0')}
    >
      <NewsPanel card={card} size={size} />
    </a>
  );
}

/** The designed panel of a story without a licensed photo (see above). */
export function NewsPanel({ card, size }: { card: NewsStoryCard; size: NewsVisualSize }) {
  const marks = panelMarks(card.entities, MARKS[size]);
  return (
    <div
      className={cx(
        'relative isolate flex items-center justify-center overflow-hidden border border-default bg-surface-raised',
        frame(size),
      )}
      data-testid="news-panel"
      data-kind={marks.length > 0 ? 'marks' : 'source'}
    >
      {/* The saffron light from the inline start, and the edge it comes from. */}
      <span className="absolute inset-0 -z-10 from-brand/25 via-transparent to-transparent ltr:bg-linear-to-br rtl:bg-linear-to-bl" />
      <span className="absolute inset-y-0 start-0 w-1 bg-brand" />
      <PitchLines />
      {marks.length > 0 ? (
        <span
          className={cx(
            'relative flex items-center justify-center',
            size === 'thumb' ? 'gap-1.5' : size === 'card' ? 'gap-2' : 'gap-3 sm:gap-6',
          )}
        >
          {marks.map((entity) => (
            <span
              key={`${entity.entity_type}:${entity.entity_id}`}
              className={cx(
                'inline-flex',
                size !== 'thumb' && 'rounded-full border border-default bg-surface shadow-sm',
                MEDALLION[size],
              )}
            >
              <EntityImage
                media={entity.media}
                kind={KIND[entity.entity_type as keyof typeof KIND]}
                name={entity.localised_name ?? entity.name ?? ''}
                size={MARK_SIZE[size]}
                className={MARK_CLASS[size]}
              />
            </span>
          ))}
        </span>
      ) : (
        <span
          className={cx(
            'relative mx-3 flex flex-col items-center border border-default bg-surface text-center shadow-sm',
            size === 'thumb' ? 'gap-1 rounded-sm px-1.5 py-1' : 'gap-2 rounded-control px-4 py-3',
          )}
        >
          <span className={cx('bg-brand', size === 'thumb' ? 'h-0.5 w-4' : 'h-1 w-8')} />
          <bdi
            className={cx(
              'line-clamp-2 font-serif leading-tight font-semibold text-fg',
              size === 'lead'
                ? 'text-3xl sm:text-display-2'
                : size === 'card'
                  ? 'text-xl'
                  : 'text-xs',
            )}
          >
            {card.source.name}
          </bdi>
        </span>
      )}
    </div>
  );
}

/**
 * A pitch's markings, the same both ways round so neither direction needs a
 * mirror: touchlines, halfway line, centre circle, both boxes.
 */
function PitchLines() {
  return (
    <svg
      viewBox="0 0 160 90"
      preserveAspectRatio="xMidYMid slice"
      className="absolute inset-0 -z-10 size-full stroke-caption/30"
      fill="none"
      strokeWidth={1}
      vectorEffect="non-scaling-stroke"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="6" y="6" width="148" height="78" vectorEffect="non-scaling-stroke" />
      <path d="M80 6v78" vectorEffect="non-scaling-stroke" />
      <circle cx="80" cy="45" r="13" vectorEffect="non-scaling-stroke" />
      <rect x="6" y="25" width="22" height="40" vectorEffect="non-scaling-stroke" />
      <rect x="132" y="25" width="22" height="40" vectorEffect="non-scaling-stroke" />
      <rect x="6" y="35" width="8" height="20" vectorEffect="non-scaling-stroke" />
      <rect x="146" y="35" width="8" height="20" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
