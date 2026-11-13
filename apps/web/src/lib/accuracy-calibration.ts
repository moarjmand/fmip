import type { AccuracyCalibration, CalibrationBin, PublicVersionSeries } from '@fmip/contracts';
import { edgeOverGuess, type Edge } from '@/lib/accuracy-edge';

/**
 * The accuracy page's calibration and version cards (T-1751, D-370, D-408),
 * pure: where the calibration chart's points go and which are thin, and what
 * each version's card may claim. Every figure is the API's; the API reads
 * them from the stored forecasts and their evaluations alone (rule 8).
 */

/**
 * What the calibration section may show. `drawn`: at least one step has the
 * minimum, so the chart is drawn, the thin steps hollow. `thin`: forecasts
 * were scored but no step has the minimum, so there is no chart, only a
 * sentence (rule 3: points from a handful of forecasts are not a curve).
 * `empty`: nothing scored.
 */
export type CalibrationState = 'drawn' | 'thin' | 'empty';

export function calibrationState(calibration: AccuracyCalibration): CalibrationState {
  const scored = calibration.bins.some((bin) => bin.forecasts > 0);
  if (!scored || calibration.coverage === 'not_supplied') return 'empty';
  const any = calibration.bins.some((bin) => bin.forecasts >= calibration.minimum_forecasts);
  return any ? 'drawn' : 'thin';
}

/** Every probability the calibration is over: three a match. */
export const calibrationForecasts = (calibration: AccuracyCalibration): number =>
  calibration.bins.reduce((sum, bin) => sum + bin.forecasts, 0);

/**
 * The calibration chart's fixed measures, in CSS pixels; widths are
 * percentages of the plot. The SVG is the plot alone, 0% to 100% edge to
 * edge; the gridline labels and the halves of the end labels sit in the
 * padding its box keeps on each inline side (`padStart`, `padEnd`, applied
 * as logical padding by the component), so on a 375px phone no label is
 * clipped and none crosses the axis (review of the T-1751 screenshots).
 */
export const CALIBRATION_CHART = {
  /** Room above the plot for the top gridline's label. */
  top: 16,
  /** The plot's height, from 100% to 0%. */
  plot: 220,
  /** The gap under the plot and the row of the axis labels. */
  under: 18,
  labels: 14,
  /** The padding at the inline start, for the gridline labels ("100%" and a gap). */
  padStart: 40,
  /** The padding at the inline end, for half of the "100%" under the plot. */
  padEnd: 20,
  /** A point's radius, and its stroke around it. */
  radius: 6,
  /** The narrowest plot the chart is drawn at (a 320px phone): labels are placed for it. */
  narrowest: 230,
} as const;

/** Where a hollow dot's count goes, relative to the dot, in the reading direction. */
export type CountSide = 'end' | 'start' | 'above' | 'below';

/** The gridlines and axis labels: every twenty points. */
export const CALIBRATION_TICKS = [0, 0.2, 0.4, 0.6, 0.8, 1] as const;

export interface CalibrationPoint extends CalibrationBin {
  /** The mean probability the step's forecasts gave. */
  said: number;
  /** The share of them that happened. */
  share: number;
  /** Under the minimum: drawn hollow, with its count beside it. */
  thin: boolean;
  /** Where the count goes: clear of every other dot (only read when `thin`). */
  countSide: CountSide;
  /** The point's centre: across in percent of the width, down in pixels. */
  x: number;
  y: number;
}

export interface CalibrationGeometry {
  height: number;
  /** The plot's bottom and top, in pixels. */
  bottom: number;
  topY: number;
  /** Where a probability or a share sits across, in percent of the width. */
  xOf: (value: number) => number;
  /** Where a share sits down, in pixels. */
  yOf: (value: number) => number;
  /** The baseline of the axis labels under the plot. */
  labelY: number;
  points: CalibrationPoint[];
}

/**
 * Where the chart's marks go. "What the model said" runs from the inline
 * start, so on a right-to-left page 0% is on the right: the positions are
 * mirrored, the text is not. A point sits at the mean probability of its
 * step, not the step's middle: the top step's forecasts may average 0.92,
 * and drawing them at 0.95 would move them off the truth. A step with no
 * forecast has no point (and no zero).
 */
export function calibrationGeometry(
  calibration: AccuracyCalibration,
  direction: 'ltr' | 'rtl',
): CalibrationGeometry {
  const { top, plot, under, labels } = CALIBRATION_CHART;
  const xOf = (value: number): number => (direction === 'rtl' ? 100 - value * 100 : value * 100);
  const yOf = (value: number): number => top + (1 - value) * plot;
  const points: CalibrationPoint[] = [];
  for (const bin of calibration.bins) {
    if (bin.forecasts <= 0 || bin.said === null) continue;
    const share = bin.happened / bin.forecasts;
    points.push({
      ...bin,
      said: bin.said,
      share,
      thin: bin.forecasts < calibration.minimum_forecasts,
      countSide: 'end',
      x: xOf(bin.said),
      y: yOf(share),
    });
  }
  for (const point of points) {
    if (point.thin) point.countSide = countSide(point, points);
  }
  const bottom = top + plot;
  return {
    height: bottom + under + labels,
    bottom,
    topY: top,
    xOf,
    yOf,
    labelY: bottom + under + 6,
    points,
  };
}

/** A box in pixels, measured from the inline start (mirroring changes no distance). */
interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

const overlaps = (a: Box, b: Box): boolean =>
  a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/**
 * Where a hollow dot's count goes: beside it towards the inline end, else
 * towards the inline start, else above, else below -- the first place whose
 * box touches no other dot and stays inside the drawing and its padding.
 * Worked out on the narrowest plot (`narrowest`), where the dots are
 * closest: across, they only move apart on a wider one, and the heights are
 * fixed, so a place clear there is clear everywhere. The count's box is
 * estimated from its digits (11px tabular figures, about 7px each).
 */
export function countSide(
  point: Pick<CalibrationPoint, 'said' | 'y' | 'forecasts'>,
  points: readonly Pick<CalibrationPoint, 'said' | 'y'>[],
): CountSide {
  const { radius, narrowest, padEnd, top, plot } = CALIBRATION_CHART;
  const ring = radius + 2;
  const gap = 4;
  const width = String(point.forecasts).length * 7 + 2;
  const height = 11;
  const cx = point.said * narrowest;
  const others: Box[] = points
    .filter((other) => other !== point)
    .map((other) => ({
      x0: other.said * narrowest - ring,
      x1: other.said * narrowest + ring,
      y0: other.y - ring,
      y1: other.y + ring,
    }));
  const middle = { y0: point.y - height / 2, y1: point.y + height / 2 };
  const candidates: [CountSide, Box][] = [
    ['end', { x0: cx + ring + gap, x1: cx + ring + gap + width, ...middle }],
    ['start', { x0: cx - ring - gap - width, x1: cx - ring - gap, ...middle }],
    [
      'above',
      {
        x0: cx - width / 2,
        x1: cx + width / 2,
        y0: point.y - ring - gap - height,
        y1: point.y - ring - gap,
      },
    ],
    [
      'below',
      {
        x0: cx - width / 2,
        x1: cx + width / 2,
        y0: point.y + ring + gap,
        y1: point.y + ring + gap + height,
      },
    ],
  ];
  for (const [side, box] of candidates) {
    const inside =
      box.x0 >= 0 && box.x1 <= narrowest + padEnd && box.y0 >= 0 && box.y1 <= top + plot;
    if (inside && !others.some((other) => overlaps(box, other))) return side;
  }
  return 'above';
}

// ---------------------------------------------------------------------------
// Each version on its own
// ---------------------------------------------------------------------------

export interface VersionCard {
  series: PublicVersionSeries;
  /**
   * The version's own edge over a guess, only when its record is `available`:
   * under the sample rule a version makes no claim (rule 3).
   */
  edge: Edge | null;
  /** The first and last weeks or months its counted matches kicked off in. */
  first: string | null;
  last: string | null;
}

export function versionCards(versions: readonly PublicVersionSeries[]): VersionCard[] {
  return versions.map((series) => {
    const total = series.total;
    const edge =
      total.coverage === 'available' ? edgeOverGuess(total.rps, total.uniform_rps) : null;
    return {
      series,
      edge,
      first: series.points[0]?.period_start ?? null,
      last: series.points.at(-1)?.period_start ?? null,
    };
  });
}
