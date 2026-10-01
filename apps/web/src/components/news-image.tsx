import { NEWS_IMAGE_LICENCES, type NewsImage } from '@fmip/contracts';
import { FilledMessage } from '@/components/filled-message';
import { cx } from '@/components/ui/cx';
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locales';
import { message } from '@/i18n/messages';

/**
 * A news photo and its credit (T-1323, D-177).
 *
 * Only a photo the API accepted under its source's licence ever reaches a
 * card, and it is ours: `/media/news/<file>`, served from this origin, so a
 * reader's browser asks nothing of the agency. Any other address is treated
 * as no photo at all. Wherever one is drawn, its credit and the licence's
 * name linked to the licence go with it -- that is the licence's condition,
 * not a decoration (docs/13-policy.md section 6).
 *
 * A plain `<img>` for the same reasons as `EntityImage` (T-1321): no
 * optimiser route, no client JS, the width and height said so nothing moves.
 * A story without a photo draws nothing here -- never a stand-in.
 *
 * The alternative text: empty on a card or a list row, where the headline
 * beside it already names it; the headline on the story page, where the
 * photo is a figure of its own.
 */

/** Where the API serves the photos it stored (D-177). */
export const NEWS_MEDIA_PREFIX = '/media/news/';

/** True when `image` is a photo we can draw from our own origin. */
export function drawableNewsImage(image: NewsImage | null | undefined): image is NewsImage {
  return (
    image !== null &&
    image !== undefined &&
    typeof image.url === 'string' &&
    image.url.startsWith(NEWS_MEDIA_PREFIX) &&
    !image.url.includes('..')
  );
}

/** The space to reserve when the file's header gave no size: 16:9. */
const FALLBACK = { width: 1600, height: 900 };

function size(image: NewsImage): { width: number; height: number } {
  return image.width !== null && image.height !== null && image.width > 0 && image.height > 0
    ? { width: image.width, height: image.height }
    : FALLBACK;
}

/** "Photo: {credit} · {licence}", the licence's name linked to the licence. */
export function NewsImageCredit({
  image,
  locale,
  className,
}: {
  image: NewsImage;
  locale: string;
  className?: string;
}) {
  const licence = NEWS_IMAGE_LICENCES[image.licence]?.name ?? image.licence;
  return (
    <p
      className={cx('text-xs text-muted', className)}
      lang={locale}
      data-testid="news-image-credit"
    >
      <FilledMessage
        message={message(isLocale(locale) ? locale : DEFAULT_LOCALE, 'news.photo.credit')}
        params={{
          credit: <bdi>{image.credit}</bdi>,
          licence: (
            <a
              href={image.licence_url}
              rel="license noopener"
              className="underline"
              dir="ltr"
              data-testid="news-image-licence"
            >
              {licence}
            </a>
          ),
        }}
      />
    </p>
  );
}

/**
 * The story page's photo, at the top: loaded at once, its own size reserved,
 * named by the headline, the credit beneath it.
 */
export function NewsPhoto({
  image,
  headline,
  locale,
}: {
  image: NewsImage | null | undefined;
  headline: string;
  locale: string;
}) {
  if (!drawableNewsImage(image)) return null;
  const { width, height } = size(image);
  return (
    <figure className="flex flex-col gap-1" data-testid="news-photo">
      {/* A plain image on purpose: no optimiser route, no client JS (see above). */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={image.url}
        width={width}
        height={height}
        alt={headline}
        loading="eager"
        decoding="auto"
        className={cx(
          'h-auto w-full rounded-sm bg-surface-raised',
          image.width === null || image.height === null ? 'aspect-video object-cover' : null,
        )}
        data-testid="news-image"
      />
      <figcaption>
        <NewsImageCredit image={image} locale={locale} />
      </figcaption>
    </figure>
  );
}

/** A card on the news page: the full width, 16:9, above the headline; lazy. */
export function NewsCardImage({ image }: { image: NewsImage | null | undefined }) {
  if (!drawableNewsImage(image)) return null;
  const { width, height } = size(image);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={image.url}
      width={width}
      height={height}
      alt=""
      loading="lazy"
      decoding="async"
      className="aspect-video h-auto w-full rounded-sm bg-surface-raised object-cover"
      data-testid="news-image"
      data-variant="card"
    />
  );
}

/** A dense list's row: a 72px square on the inline start; lazy. */
export function NewsThumb({ image }: { image: NewsImage | null | undefined }) {
  if (!drawableNewsImage(image)) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={image.url}
      width={72}
      height={72}
      alt=""
      loading="lazy"
      decoding="async"
      className="size-[72px] shrink-0 rounded-sm bg-surface-raised object-cover"
      data-testid="news-image"
      data-variant="thumb"
    />
  );
}
