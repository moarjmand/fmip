import { cx } from './cx';

/** The four bands, lowest first: each differs in lightness as well as colour. */
const BANDS = {
  low: 'bg-rating-low text-on-rating-low',
  mid: 'border border-default bg-surface-raised text-fg',
  good: 'bg-rating-good text-on-rating-good',
  top: 'bg-brand text-on-brand',
} as const;

export type RatingBand = keyof typeof BANDS;

/** Under 6, 6 to 6.9, 7 to 7.9, 8 and up (the Design System's bands). */
export function ratingBand(value: number): RatingBand {
  return value >= 8 ? 'top' : value >= 7 ? 'good' : value >= 6 ? 'mid' : 'low';
}

/**
 * A player's match rating (the Design System's `RatingChip`, T-1510, D-263):
 * the figure to one decimal, already formatted for the reader's locale, on a
 * chip coloured by band. Ratings come from the licensed feed; a player
 * without one gets no chip, never a zero (rule 3) -- the caller draws none.
 * The bands differ in lightness too, so the scale reads without colour, and
 * the figure is always written. Server-component safe.
 */
export function RatingChip({
  value,
  text,
  className,
}: {
  /** The rating itself, which picks the band. */
  value: number;
  /** The rating as the reader reads it ("7.4", "۷٫۴"). */
  text: string;
  className?: string;
}) {
  const band = ratingBand(value);
  return (
    <span
      data-rating-band={band}
      className={cx(
        'inline-block min-w-10 rounded-sm px-1.5 py-0.5 text-center text-sm font-extrabold tabular-nums font-stretch-condensed',
        BANDS[band],
        className,
      )}
    >
      {text}
    </span>
  );
}
