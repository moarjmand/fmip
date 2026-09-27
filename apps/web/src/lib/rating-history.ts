import type { CompetitionRating, RatingHistoryPoint } from '@fmip/contracts';

/**
 * The rating-over-time chart's pure half (blueprint 9.3, T-640): where each
 * point sits, and how the numbers beside it read. No fetching and no JSX, so
 * the geometry -- including which way time runs -- is unit-tested.
 *
 * **Time runs from inline-start to inline-end.** SVG coordinates are physical,
 * so logical CSS cannot mirror them; the x position is computed along the
 * inline axis and flipped here for a right-to-left page, which keeps the text
 * around the chart unmirrored (a CSS `scaleX(-1)` would mirror it too).
 *
 * **The vertical scale is the rating's own, 0 to 100.** Zooming to the data's
 * range would make a move of half a point look like a collapse.
 */

export const CHART = { width: 600, height: 160, pad: 8 } as const;

export interface ChartPoint {
  x: number;
  y: number;
  point: RatingHistoryPoint;
}

export interface ChartGeometry {
  points: ChartPoint[];
  /** An SVG path through the points, oldest first; empty for a single point. */
  path: string;
  /** Horizontal guides at these ratings, with their y. */
  guides: { rating: number; y: number }[];
}

const round1 = (v: number): number => Math.round(v * 10) / 10;

function dayMs(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

/** Positions on a `CHART.width` × `CHART.height` canvas; x proportional to the date. */
export function chartGeometry(
  points: readonly RatingHistoryPoint[],
  direction: 'ltr' | 'rtl',
): ChartGeometry {
  const { width, height, pad } = CHART;
  const innerWidth = width - 2 * pad;
  const innerHeight = height - 2 * pad;
  const yOf = (rating: number): number =>
    round1(pad + innerHeight * (1 - Math.min(100, Math.max(0, rating)) / 100));

  const first = points[0];
  const last = points.at(-1);
  const span = first !== undefined && last !== undefined ? dayMs(last.date) - dayMs(first.date) : 0;
  const placed = points.map((point): ChartPoint => {
    // One day, or every point on one day: the middle, not the start edge.
    const along =
      span === 0 || first === undefined ? 0.5 : (dayMs(point.date) - dayMs(first.date)) / span;
    const inline = pad + innerWidth * along;
    return {
      x: round1(direction === 'rtl' ? width - inline : inline),
      y: yOf(point.rating),
      point,
    };
  });

  return {
    points: placed,
    path:
      placed.length < 2
        ? ''
        : placed.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' '),
    guides: [0, 50, 100].map((rating) => ({ rating, y: yOf(rating) })),
  };
}

/** "7 of 12 correct (58%)": the accuracy the blueprint asks for, with its sample. */
export function accuracyLabel(
  entry: Pick<CompetitionRating, 'settled_count' | 'outcome_correct'>,
): string {
  if (entry.settled_count === 0) return 'Nothing settled';
  const share = Math.round((entry.outcome_correct / entry.settled_count) * 100);
  return `${entry.outcome_correct} of ${entry.settled_count} correct (${share}%)`;
}

/** The ISO instant a UTC day label is formatted from. */
export function dayInstant(date: string): string {
  return `${date}T00:00:00.000Z`;
}

/** What the chart says to a reader who cannot see it. */
export function chartSummary(
  points: readonly RatingHistoryPoint[],
  formatDay: (date: string) => string,
): string {
  const first = points[0];
  const last = points.at(-1);
  if (first === undefined || last === undefined) return 'No rating yet.';
  if (points.length === 1)
    return `Rating ${last.rating.toFixed(1)} on ${formatDay(last.date)}, the only day with a settled prediction.`;
  return `Rating from ${first.rating.toFixed(1)} on ${formatDay(first.date)} to ${last.rating.toFixed(1)} on ${formatDay(last.date)}, over ${points.length} days with settled predictions.`;
}
