import { MEDIA_PATH_PREFIX, mediaSized, type EntityMedia } from '@fmip/contracts';
import { Pictured } from '@/components/lite-mode';
import { cx } from '@/components/ui/cx';

/**
 * A team's crest, a competition's logo or a person's photo (T-1321, D-176).
 *
 * A plain `<img>` with its width and height said, so nothing moves when it
 * arrives, lazy and decoded off the main thread unless it is above the fold.
 * No `next/image`: the files are already small, stored on our own origin and
 * cached for a year, and the optimiser would add a route and client JS for
 * nothing. Only our own `/api/media/...` address is ever drawn, so a reader's
 * browser asks nothing of anyone but this site; any other address is treated
 * as no image at all.
 *
 * Without an image (`not_supplied`, or a surface the API attached no media
 * to) it draws a neutral lettered mark, never a stand-in that could pass for
 * a crest or a photo (rule 3): the first letter(s) of the name in a plain
 * token-coloured square for a team or a competition, in a circle for a person.
 *
 * The letters are drawn by CSS from `data-letters`, not written into the
 * page, so the text of a heading or a link stays the name alone.
 *
 * Beside a name, as almost everywhere, the image is decorative (`alt=""`, the
 * mark hidden from assistive technology); alone, it carries the name.
 *
 * Readable on either ground (T-1609, D-280): a competition logo is drawn on
 * a white tile in both themes, rounded and padded by size, with a hairline
 * on Night, since the logos are made for paper and many are dark; a crest
 * has no ground of its own, only a one-pixel light halo round its outline
 * on Night (`crest-halo`), so a navy or black crest keeps its edge.
 */

export type EntityImageKind = 'crest' | 'logo' | 'photo';

/** The sizes the pages use, in CSS pixels. */
export type EntityImageSize = 14 | 18 | 20 | 22 | 28 | 32 | 40 | 48 | 96;

const BOX: Record<EntityImageSize, string> = {
  // The moments rail's competition logo and crests, and its hover card's crests (T-1642).
  14: 'size-3.5',
  18: 'size-[18px]',
  20: 'size-5',
  22: 'size-[22px]',
  28: 'size-7',
  // The line-ups' bench and list rows (T-1616).
  32: 'size-8',
  40: 'size-10',
  48: 'size-12',
  96: 'size-24',
};

const LETTERS: Record<EntityImageSize, string> = {
  14: 'text-[7px]',
  18: 'text-[8px]',
  20: 'text-[9px]',
  22: 'text-[9px]',
  28: 'text-[11px]',
  32: 'text-xs',
  40: 'text-sm',
  48: 'text-base',
  96: 'text-3xl',
};

/** A logo tile's inner padding and corner, by size (T-1609). */
const TILE: Record<EntityImageSize, string> = {
  14: 'rounded-xs p-px',
  18: 'rounded-sm p-px',
  20: 'rounded-sm p-0.5',
  22: 'rounded-sm p-0.5',
  28: 'rounded-sm p-0.5',
  32: 'rounded-md p-1',
  40: 'rounded-md p-1',
  48: 'rounded-md p-1',
  96: 'rounded-lg p-2',
};

/**
 * The classes of a drawn image, by kind (T-1609, D-280): a photo round and
 * cropped on the raised surface; a logo whole on its white tile with the
 * Night hairline; a crest whole on nothing, with the Night halo -- no
 * background, so the halo follows the crest and not a square.
 */
export function imageClasses(kind: EntityImageKind, size: EntityImageSize): string {
  if (kind === 'photo') return 'rounded-full bg-surface-raised object-cover';
  if (kind === 'logo') return cx('bg-logo-tile object-contain ring-1 ring-logo-edge', TILE[size]);
  return 'crest-halo rounded-sm object-contain p-px';
}

/** True when `media` is an image we can draw from our own origin. */
export function drawable(media: EntityMedia | undefined): media is {
  coverage: 'available';
  url: string;
} {
  return (
    media !== undefined &&
    media.coverage === 'available' &&
    typeof media.url === 'string' &&
    media.url.startsWith(`${MEDIA_PATH_PREFIX}/`)
  );
}

/**
 * The letters of the neutral mark: the first letter of the first and the last
 * word for a person, of the first two words for a team or a competition
 * ("Manchester United" MU, "Liverpool" L). Whole code points, so a name in
 * another script is cut at a letter, not inside one.
 */
export function initials(name: string, kind: EntityImageKind): string {
  const words = name
    .trim()
    .split(/[\s\-–.]+/u)
    .filter((word) => /\p{L}|\p{N}/u.test(word));
  if (words.length === 0) return '';
  const first = (word: string) => Array.from(word.replace(/^[^\p{L}\p{N}]+/u, ''))[0] ?? '';
  const picked =
    words.length === 1
      ? [words[0]!]
      : kind === 'photo'
        ? [words[0]!, words[words.length - 1]!]
        : [words[0]!, words[1]!];
  return picked.map(first).join('').toLocaleUpperCase();
}

export function EntityImage({
  media,
  kind,
  name,
  size,
  decorative = true,
  aboveFold = false,
  className,
}: {
  /** The API's media field; absent where a surface carries none. */
  media: EntityMedia | undefined;
  kind: EntityImageKind;
  /** The entity's name: the mark's letters, and the alternative text when not decorative. */
  name: string;
  size: EntityImageSize;
  /** The name is already beside it (the default): `alt=""`. */
  decorative?: boolean;
  /** A page header's image: loaded at once rather than lazily. */
  aboveFold?: boolean;
  className?: string;
}) {
  if (drawable(media)) {
    const image = (
      // A plain image on purpose: no optimiser route, no client JS (see above).
      // eslint-disable-next-line @next/next/no-img-element
      <img
        // T-1462: the WebP made for twice this box, not the provider's file.
        src={mediaSized(media.url, size)}
        width={size}
        height={size}
        alt={decorative ? '' : name}
        loading={aboveFold ? 'eager' : 'lazy'}
        decoding={aboveFold ? 'auto' : 'async'}
        className={cx('shrink-0', BOX[size], imageClasses(kind, size), className)}
        data-testid="entity-image"
        data-kind={kind}
        data-coverage="available"
      />
    );
    // Lite mode (T-1387): no <img> at all, so nothing is fetched; the lettered
    // mark stands in, still saying the image exists and was left out.
    return (
      <Pictured fallback={mark({ kind, name, size, decorative, className, omitted: true })}>
        {image}
      </Pictured>
    );
  }
  return mark({ kind, name, size, decorative, className, omitted: false });
}

/** The neutral lettered mark: no image held, or one lite mode left out. */
function mark({
  kind,
  name,
  size,
  decorative,
  className,
  omitted,
}: {
  kind: EntityImageKind;
  name: string;
  size: EntityImageSize;
  decorative: boolean;
  className: string | undefined;
  omitted: boolean;
}) {
  return (
    <span
      {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': name })}
      className={cx(
        'inline-flex shrink-0 items-center justify-center overflow-hidden border border-default bg-surface-raised leading-none font-semibold text-muted select-none before:content-[attr(data-letters)]',
        BOX[size],
        LETTERS[size],
        kind === 'photo' ? 'rounded-full' : 'rounded-sm',
        className,
      )}
      data-testid="entity-image"
      data-kind={kind}
      data-coverage={omitted ? 'available' : 'not_supplied'}
      data-omitted={omitted ? 'lite' : undefined}
      data-letters={initials(name, kind)}
    />
  );
}
