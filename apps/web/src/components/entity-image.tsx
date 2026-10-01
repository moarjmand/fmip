import { MEDIA_PATH_PREFIX, type EntityMedia } from '@fmip/contracts';
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
 */

export type EntityImageKind = 'crest' | 'logo' | 'photo';

/** The sizes the pages use, in CSS pixels. */
export type EntityImageSize = 20 | 22 | 40 | 48 | 96;

const BOX: Record<EntityImageSize, string> = {
  20: 'size-5',
  22: 'size-[22px]',
  40: 'size-10',
  48: 'size-12',
  96: 'size-24',
};

const LETTERS: Record<EntityImageSize, string> = {
  20: 'text-[9px]',
  22: 'text-[9px]',
  40: 'text-sm',
  48: 'text-base',
  96: 'text-3xl',
};

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
  const round = kind === 'photo';
  const shape = round ? 'rounded-full' : 'rounded-sm';
  if (drawable(media)) {
    return (
      // A plain image on purpose: no optimiser route, no client JS (see above).
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={media.url}
        width={size}
        height={size}
        alt={decorative ? '' : name}
        loading={aboveFold ? 'eager' : 'lazy'}
        decoding={aboveFold ? 'auto' : 'async'}
        className={cx(
          'shrink-0 bg-surface-raised',
          BOX[size],
          shape,
          round ? 'object-cover' : 'object-contain p-px',
          className,
        )}
        data-testid="entity-image"
        data-kind={kind}
        data-coverage="available"
      />
    );
  }
  return (
    <span
      {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': name })}
      className={cx(
        'inline-flex shrink-0 items-center justify-center overflow-hidden border border-default bg-surface-raised leading-none font-semibold text-muted select-none before:content-[attr(data-letters)]',
        BOX[size],
        LETTERS[size],
        shape,
        className,
      )}
      data-testid="entity-image"
      data-kind={kind}
      data-coverage="not_supplied"
      data-letters={initials(name, kind)}
    />
  );
}
