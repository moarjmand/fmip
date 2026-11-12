import { cx } from './cx';

/**
 * The three bands, lowest first (T-1801, D-399): grey, an outline, ink. Each
 * differs in lightness and edge as well as colour, and none is a product
 * colour: teal is the model's and saffron the brand's (rule 6).
 */
const BANDS = {
  low: 'bg-rating-low text-on-rating-low',
  mid: 'border border-fg bg-surface-raised text-fg',
  high: 'bg-fg text-canvas',
} as const;

export type RatingBand = keyof typeof BANDS;

/** Under 6, 6 to 6.9, 7 and up (D-399; the thresholds are ours, not the provider's). */
export function ratingBand(value: number): RatingBand {
  return value >= 7 ? 'high' : value >= 6 ? 'mid' : 'low';
}

/**
 * A player's match rating (the Design System's `RatingChip`, T-1510, D-263;
 * neutral since T-1801, D-399): the figure to one decimal, already formatted
 * for the reader's locale, on a chip shaded by band. Ratings come from the
 * licensed feed; a player without one gets no chip, never a zero (rule 3) --
 * the caller draws none. The figure is always written, so the scale never
 * rests on colour. Server-component safe.
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
